// Ports src/posting/templates/templateService.js
//
// Each account's post templates, one net.anisota.feed.template/{tid} record
// each in its own repo. The shapes and rules are PostTemplates; this only
// reads, writes and remembers them.
//
// Every call names the account (`TemplateAccount`: a DID and its agent, or
// a function that resolves the agent, as the session's agentFor does), and
// memory holds each account's templates apart, because the composer can
// write as any signed-in account and its library follows the one it writes
// as. Nothing is signed in for an account until it is read or written.
//
// The cache (`virga:templates:<did>`) is filed under the DID the data came
// from, in the web's JSON (its record values with their keys sorted), so a
// cache written by either app primes the other. A failed write is thrown
// for the editor to show beside the form.
//
// The web's service is one object on one thread; this one is a main-actor
// class. A load in flight is a Task every caller asking meanwhile shares.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

// MARK: - The repo calls

/// The account's repo calls the service makes (the web's
/// `agent.com.atproto.repo`). Each answers the response body (`res.data`).
/// VirgaNetwork's XRPCAgent conforms (the session's agentFor gives one).
public protocol TemplateRepoAgent: Sendable {
  /// The account the agent is signed in as (`agent.did`), when known.
  var did: String? { get }
  func listRecords(repo: String, collection: String, limit: Int, cursor: String?) async throws -> JSONValue
  func createRecord(repo: String, collection: String, record: JSONValue) async throws -> JSONValue
  func putRecord(repo: String, collection: String, rkey: String, record: JSONValue) async throws -> JSONValue
  func deleteRecord(repo: String, collection: String, rkey: String) async throws -> JSONValue
}

extension XRPCAgent: TemplateRepoAgent {
  public func listRecords(repo: String, collection: String, limit: Int, cursor: String?) async throws -> JSONValue {
    let params: XRPCParams = [
      "repo": .string(repo), "collection": .string(collection), "limit": .integer(limit),
      "cursor": cursor.map(XRPCParamValue.string),
    ]
    return try await query("com.atproto.repo.listRecords", params).data
  }

  public func createRecord(repo: String, collection: String, record: JSONValue) async throws -> JSONValue {
    let input: JSONValue = ["repo": .string(repo), "collection": .string(collection), "record": record]
    return try await procedure("com.atproto.repo.createRecord", input: .json(input)).data
  }

  public func putRecord(repo: String, collection: String, rkey: String, record: JSONValue) async throws -> JSONValue {
    let input: JSONValue = ["repo": .string(repo), "collection": .string(collection), "rkey": .string(rkey), "record": record]
    return try await procedure("com.atproto.repo.putRecord", input: .json(input)).data
  }

  public func deleteRecord(repo: String, collection: String, rkey: String) async throws -> JSONValue {
    let input: JSONValue = ["repo": .string(repo), "collection": .string(collection), "rkey": .string(rkey)]
    return try await procedure("com.atproto.repo.deleteRecord", input: .json(input)).data
  }
}

/// The account a call is for: `{ did, agent }`, where the agent is the agent
/// itself or a function that resolves to it (nil for none).
public struct TemplateAccount: Sendable {
  public enum Agent: Sendable {
    case agent(any TemplateRepoAgent)
    case resolve(@MainActor @Sendable (String) async throws -> (any TemplateRepoAgent)?)
  }

  public var did: String?
  public var agent: Agent?

  public init(did: String?, agent: (any TemplateRepoAgent)?) {
    self.did = did
    self.agent = agent.map(Agent.agent)
  }

  public init(did: String?, agentFor: @escaping @MainActor @Sendable (String) async throws -> (any TemplateRepoAgent)?) {
    self.did = did
    self.agent = .resolve(agentFor)
  }
}

// MARK: - Errors

/// A failure the service throws: the web's `new Error(message)`, with
/// `fieldErrors` for a template refused before any request, and
/// `permission` for a write refused for a permission the sign-in didn't
/// grant (`cause` is the refusal, whose other fields it keeps).
public struct TemplateServiceError: Error, LocalizedError, JSErrorConvertible, CustomStringConvertible {
  public var message: String
  public var fieldErrors: TemplateFieldErrors?
  public var permission: Bool
  public var cause: (any Error)?

  public init(_ message: String, fieldErrors: TemplateFieldErrors? = nil, permission: Bool = false, cause: (any Error)? = nil) {
    self.message = message
    self.fieldErrors = fieldErrors
    self.permission = permission
    self.cause = cause
  }

  public var errorDescription: String? { message }
  public var description: String { message }

  public var jsFields: JSErrorFields {
    var fields = cause.flatMap { JSErrorFields($0) } ?? JSErrorFields()
    fields.message = message
    return fields
  }
}

// MARK: - The service

@MainActor
public final class TemplateService {
  nonisolated public static let templatesCachePrefix = "virga:templates:"

  nonisolated public static func templatesCacheKey(_ did: String) -> String {
    "\(templatesCachePrefix)\(did)"
  }

  nonisolated public static let templatePermissionMessage =
    "Virga needs permission to save templates in your repo. Sign in again to grant it."

  nonisolated static let pageLimit = 100

  /// The app's template service. The app gives it its store at launch
  /// (`TemplateService.shared = TemplateService(store: UserDefaultsKeyValueStore())`);
  /// until then it caches nothing.
  public static var shared = TemplateService(store: nil)

  public let collection = PostTemplates.templateCollection
  public let store: (any KeyValueStore)?
  /// Where `virga:templates-changed` is dispatched (nil: nowhere).
  public let target: PostingEventBus?
  /// The clock for createdAt and updatedAt (the web's `new Date()`).
  let now: @MainActor () -> Date
  /// The collation's locale for list order (nil: the active one; the web
  /// uses the runtime's).
  public let locale: String?

  public init(
    store: (any KeyValueStore)?, target: PostingEventBus? = .shared, locale: String? = nil,
    now: @escaping @MainActor () -> Date = { Date() }
  ) {
    self.store = store
    self.target = target
    self.locale = locale
    self.now = now
  }

  // MARK: State

  struct Entry: Sendable {
    var uri: JSONValue
    var cid: JSONValue
    var value: JSONValue

    var json: JSONValue { ["uri": uri, "cid": cid, "value": value] }
  }

  struct Account {
    var byRkey: JSObjectMap<Entry>
    /// True once a load has read what memory holds; memory filled from the
    /// cache is not, so it is read again.
    var confirmed: Bool
  }

  struct Inflight {
    let id: Int
    let run: Task<[PostTemplate], any Error>
    /// The writes adopted while it was out (rkey → entry, or nil for a
    /// delete), in the order a Map keeps, laid over its pages.
    var writes: [(rkey: String, entry: Entry?)] = []
  }

  var accounts: [JSKey: Account] = [:]
  var accountOrder: [JSKey] = []
  var inflight: [JSKey: Inflight] = [:]
  var listeners: [(id: Int, fn: @MainActor (String?, [PostTemplate]) -> Void)] = []
  var nextId = 0
  // Bumped by reset() (for everyone) and reset(did) (for one account); a
  // load or write that started before lands nowhere.
  var generation = 0
  var accountGenerations: [JSKey: Int] = [:]

  func generationOf(_ did: String) -> String {
    "\(generation):\(accountGenerations[JSKey(did)] ?? 0)"
  }

  func setAccount(_ did: String, _ account: Account) {
    let key = JSKey(did)
    if accounts[key] == nil { accountOrder.append(key) }
    accounts[key] = account
  }

  // MARK: Cache

  func readCache(_ did: String) -> JSObjectMap<Entry> {
    var out = JSObjectMap<Entry>()
    guard !did.isEmpty, let store, let raw = store.getItem(Self.templatesCacheKey(did)), !raw.isEmpty,
      let parsed = try? OrderedJSON.parse(raw), case .object(let members) = parsed
    else { return out }
    for member in members {
      guard member.value.isObjectLike else { continue }
      let entry = member.value.value
      guard let value = entry.templateField("value"), value.isTruthy, value.templateObject != nil else { continue }
      guard let uri = entry.templateField("uri")?.stringValue, TemplateJS.rkeyOf(.string(uri)).jsEquals(member.key) else { continue }
      let cid = entry.templateField("cid")?.stringValue.map(JSONValue.string) ?? .null
      out[member.key] = Entry(uri: .string(uri), cid: cid, value: value)
    }
    return out
  }

  func writeCache(_ did: String) {
    guard !did.isEmpty, let store else { return }
    let entries = accounts[JSKey(did)]?.byRkey.entries ?? []
    let text = "{" + entries.map { "\($0.key.jsJSONQuoted):\(JSONStringify.stringify($0.value.json))" }.joined(separator: ",") + "}"
    // The cache only primes the next visit; templates load regardless.
    try? store.setItem(Self.templatesCacheKey(did), text)
  }

  @discardableResult
  func accountFor(_ did: String) -> Account {
    if let account = accounts[JSKey(did)] { return account }
    let account = Account(byRkey: readCache(did), confirmed: false)
    setAccount(did, account)
    return account
  }

  // MARK: Reading

  /// `did`'s templates as memory holds them, by group (ungrouped last), then
  /// by name.
  public func list(_ did: String?) -> [PostTemplate] {
    guard let did, !did.isEmpty, let account = accounts[JSKey(did)] else { return [] }
    let templates = account.byRkey.values.map { PostTemplates.normalizeTemplateRecord($0.json) }
    return JSSort.sort(templates) { Double(Self.compareTemplates($0, $1, locale: self.locale)) }
  }

  nonisolated static func compareTemplates(_ a: PostTemplate, _ b: PostTemplate, locale: String?) -> Int {
    let ga = a.group.jsTrimmed()
    let gb = b.group.jsTrimmed()
    if !ga.jsEquals(gb) {
      // Ungrouped templates sit after every group.
      if ga.isEmpty { return 1 }
      if gb.isEmpty { return -1 }
      let byName = LocaleCompare.compare(ga, gb, locale: locale, sensitivity: .base)
      return byName != 0 ? byName : (LocaleCompare.codeUnitLess(ga, gb) ? -1 : 1)
    }
    let names = LocaleCompare.compare(a.name, b.name, locale: locale, sensitivity: .base)
    return names != 0 ? names : LocaleCompare.compare(a.rkey, b.rkey, locale: locale)
  }

  /// Hear of every change to any account's templates: `(did, templates)`.
  /// Returns the function that stops listening.
  @discardableResult
  public func subscribe(_ listener: @escaping @MainActor (String?, [PostTemplate]) -> Void) -> @MainActor () -> Void {
    let id = nextId
    nextId += 1
    listeners.append((id, listener))
    return { [weak self] in self?.listeners.removeAll { $0.id == id } }
  }

  func emitChanged(_ did: String?) {
    let templates = list(did)
    let heard = listeners
    for listener in heard where listeners.contains(where: { $0.id == listener.id }) {
      listener.fn(did, templates)
    }
    if let did, !did.isEmpty {
      let detail: JSONValue = ["did": .string(did), "templates": .array(templates.map(\.json))]
      _ = try? PostingEvents.emitPostingEvent(PostingEvents.templatesChangedEvent, detail, target: target)
    }
  }

  func agentOf(_ account: TemplateAccount?) async throws -> any TemplateRepoAgent {
    guard let did = account?.did, !did.isEmpty else { throw TemplateServiceError("Not signed in") }
    var agent: (any TemplateRepoAgent)?
    switch account?.agent {
    case .agent(let given)?: agent = given
    case .resolve(let resolve)?: agent = try await resolve(did)
    case nil: agent = nil
    }
    guard let agent else { throw TemplateServiceError("Not signed in") }
    // Never write one account's templates with another's session.
    if let signedIn = agent.did, !signedIn.isEmpty, !signedIn.jsEquals(did) {
      throw TemplateServiceError("That account isn’t the one signed in here.")
    }
    return agent
  }

  func fetchAll(_ agent: any TemplateRepoAgent, _ did: String) async throws -> JSObjectMap<Entry> {
    var fresh = JSObjectMap<Entry>()
    var seenCursors = Set<JSKey>()
    var cursor: String?
    repeat {
      let data = try await agent.listRecords(repo: did, collection: collection, limit: Self.pageLimit, cursor: cursor)
      for item in data.templateField("records")?.arrayValue ?? [] {
        guard let uri = item.templateField("uri"), uri.isTruthy,
          let value = item.templateField("value"), value.isTruthy, value.templateObject != nil
        else { continue }
        let rkey = TemplateJS.rkeyOf(uri)
        if rkey.isEmpty { continue }
        fresh[rkey] = Entry(uri: uri, cid: item.templateField("cid")?.truthy ?? .null, value: value)
      }
      cursor = TemplateJS.text(data.templateField("cursor"))
      // A PDS that hands back the same cursor would otherwise page forever.
      if let cursor, seenCursors.contains(JSKey(cursor)) { break }
      if let cursor { seenCursors.insert(JSKey(cursor)) }
    } while cursor != nil
    return fresh
  }

  /// Every template in `account.did`'s repo. Replaces memory and the cache,
  /// keeping any write made while the pages came in, tells the listeners
  /// and gives list(did). On failure the cached copy stays and the error is
  /// thrown, so a failed read is never mistaken for "no templates". A load
  /// already in flight for the account is shared.
  @discardableResult
  public func load(_ account: TemplateAccount?) async throws -> [PostTemplate] {
    try await loadTask(account).value
  }

  /// The load `load(account)` waits on: the one in flight for the account,
  /// or a new one.
  public func loadTask(_ account: TemplateAccount?) -> Task<[PostTemplate], any Error> {
    guard let did = account?.did, !did.isEmpty, account?.agent != nil else {
      let templates = list(account?.did)
      return Task { templates }
    }
    if let shared = inflight[JSKey(did)] { return shared.run }

    let startedIn = generationOf(did)
    let id = nextId
    nextId += 1
    let run = Task { @MainActor [self] () throws -> [PostTemplate] in
      defer { if inflight[JSKey(did)]?.id == id { inflight[JSKey(did)] = nil } }
      do {
        let agent = try await agentOf(account)
        var fresh = try await fetchAll(agent, did)
        if startedIn != generationOf(did) { return list(did) }
        if let mine = inflight[JSKey(did)], mine.id == id {
          for (rkey, written) in mine.writes { fresh[rkey] = written }
        }
        setAccount(did, Account(byRkey: fresh, confirmed: true))
        writeCache(did)
        emitChanged(did)
        return list(did)
      } catch {
        if startedIn == generationOf(did) {
          accountFor(did)
          emitChanged(did)
        }
        throw error
      }
    }
    inflight[JSKey(did)] = Inflight(id: id, run: run)
    return run
  }

  /// Whether memory holds `did`'s templates as a load confirmed them.
  public func isLoaded(_ did: String?) -> Bool {
    guard let did, !did.isEmpty else { return false }
    return accounts[JSKey(did)]?.confirmed ?? false
  }

  /// Fills memory from the cache when it holds nothing for `did`; gives list(did).
  @discardableResult
  public func primeFromCache(_ did: String?) -> [PostTemplate] {
    guard let did, !did.isEmpty else { return [] }
    if let account = accounts[JSKey(did)] {
      if !account.confirmed && account.byRkey.isEmpty {
        var primed = account
        primed.byRkey = readCache(did)
        accounts[JSKey(did)] = primed
      }
    } else {
      accountFor(did)
    }
    return list(did)
  }

  // MARK: Writing

  /// Files a written record locally, unless a reset happened while the
  /// write was out. A load in flight for the account hears of it too, so its
  /// older pages can't bring back a deleted template or drop a new one.
  func adopt(_ did: String, _ startedIn: String, _ rkey: String, _ entry: Entry?) {
    if startedIn != generationOf(did) { return }
    var account = accountFor(did)
    if var running = inflight[JSKey(did)] {
      if let index = running.writes.firstIndex(where: { $0.rkey.jsEquals(rkey) }) {
        running.writes[index].entry = entry
      } else {
        running.writes.append((rkey, entry))
      }
      inflight[JSKey(did)] = running
    }
    account.byRkey[rkey] = entry
    accounts[JSKey(did)] = account
    writeCache(did)
    emitChanged(did)
  }

  // A blank's pre-filled answer has the choices' limit.
  nonisolated static let defaultGraphemes = PostTemplates.templateLimits.choiceGraphemes

  // The lexicon caps most strings twice: in graphemes, and in UTF-8 bytes
  // (`maxLength`). A PDS stores a record of a collection it has no lexicon
  // for as given, so these are held here, against the record as it will be
  // written.
  enum RecordBytes {
    static let name = 640
    static let text = 3000
    static let group = 640
    static let label = 640
    static let hint = 2000
    static let choice = 3000
    static let defaultValue = 3000
  }

  nonisolated static func utf8Length(_ value: JSONValue?) -> Int { TemplateJS.orEmpty(value).utf8.count }

  nonisolated static func fits(_ value: JSONValue?, _ graphemes: Int, _ bytes: Int) -> Bool {
    Graphemes.countGraphemes(TemplateJS.orEmpty(value)) <= graphemes && utf8Length(value) <= bytes
  }

  nonisolated static func clampText(_ text: String, _ graphemes: Int, _ bytes: Int) -> String {
    var out = Graphemes.truncateGraphemes(text, graphemes)
    while !out.isEmpty && out.utf8.count > bytes {
      out = Graphemes.truncateGraphemes(out, Graphemes.countGraphemes(out) - 1)
    }
    return out
  }

  /// Cuts each blank's pre-filled answer to the lexicon's limit. The editor
  /// has no field for it (one only arrives on a record written elsewhere),
  /// so refusing the save would leave nothing to fix.
  nonisolated static func clampDefaults(_ record: JSONValue) -> JSONValue {
    guard case .object(var members) = record, let variables = members["variables"]?.arrayValue else { return record }
    members["variables"] = .array(variables.map { v in
      guard case .object(var fields) = v, let value = fields["default"], value.isTruthy,
        !fits(value, defaultGraphemes, RecordBytes.defaultValue)
      else { return v }
      let cut = clampText(TemplateJS.orEmpty(value), defaultGraphemes, RecordBytes.defaultValue).jsTrimmed()
      fields["default"] = cut.isEmpty ? nil : .string(cut)
      return .object(fields)
    })
    return .object(members)
  }

  /// The record's breaches of the lexicon that validateTemplate doesn't look
  /// for: a blank's question, hint and choices, byte lengths, and keywords
  /// as written (lower-cased).
  nonisolated static func recordLimitErrors(_ record: JSONValue?) -> TemplateFieldErrors {
    var errors = TemplateFieldErrors()
    guard let record, record.isTruthy else { return errors }
    let limits = PostTemplates.templateLimits
    if utf8Length(record.templateField("name")) > RecordBytes.name {
      errors["name"] = "The name is too long to save."
    }
    if utf8Length(record.templateField("text")) > RecordBytes.text {
      errors["text"] = "The text is longer than a post can be."
    }
    if let group = record.templateField("group"), group.isTruthy, utf8Length(group) > RecordBytes.group {
      errors["group"] = "The group name is too long to save."
    }
    for v in TemplateJS.list(record.templateField("variables")) {
      let blank = "“\(TemplateJS.string(v.templateField("key")))”"
      var problem: String?
      if let label = v.templateField("label"), label.isTruthy, !fits(label, limits.labelGraphemes, RecordBytes.label) {
        problem = "Keep the question for \(blank) under \(limits.labelGraphemes) characters."
      } else if let hint = v.templateField("hint"), hint.isTruthy, !fits(hint, limits.hintGraphemes, RecordBytes.hint) {
        problem = "Keep the hint for \(blank) under \(limits.hintGraphemes) characters."
      } else if TemplateJS.list(v.templateField("choices")).contains(where: { !fits($0, limits.choiceGraphemes, RecordBytes.choice) }) {
        problem = "Keep each choice for \(blank) under \(limits.choiceGraphemes) characters."
      }
      if let problem {
        errors["variables"] = problem
        break
      }
    }
    // Keywords are capped in UTF-8 bytes only, which is fewer characters
    // for a word with accents, so the message names no number.
    if TemplateJS.list(record.templateField("keywords")).contains(where: { utf8Length($0) > limits.keywordLength }) {
      errors["keywords"] = "One of the words is too long."
    }
    return errors
  }

  func problemsWith(_ did: String, _ template: some TemplateFields, _ record: JSONValue?) -> TemplateFieldErrors {
    var errors = PostTemplates.validateTemplate(template, list(did))
    for entry in Self.recordLimitErrors(record).entries where errors[entry.field] == nil {
      errors[entry.field] = entry.message
    }
    return errors
  }

  nonisolated static func validationError(_ fieldErrors: TemplateFieldErrors) -> TemplateServiceError {
    TemplateServiceError(fieldErrors.firstMessage ?? "This template can’t be saved yet.", fieldErrors: fieldErrors)
  }

  // ATProto record-key charset. An rkey goes into request bodies and
  // at-uris, where a slash would address another record.
  nonisolated static func isRecordKey(_ rkey: String) -> Bool {
    let units = Array(rkey.utf16)
    guard (1...512).contains(units.count) else { return false }
    func alnum(_ u: UInt16) -> Bool { (0x30...0x39).contains(u) || (0x41...0x5A).contains(u) || (0x61...0x7A).contains(u) }
    return alnum(units[0]) && units.dropFirst().allSatisfy { alnum($0) || [0x2E, 0x5F, 0x7E, 0x3A, 0x2D].contains($0) }
  }

  nonisolated static func requireRkey(_ rkey: String?) throws -> String {
    guard let rkey, isRecordKey(rkey) else { throw TemplateServiceError("Template not found") }
    return rkey
  }

  /// Whether a record read or delete failed because the record isn't
  /// there, rather than for any other reason (offline, a 5xx, a refused
  /// permission).
  public nonisolated static func isRecordNotFound(_ error: (any Error)?) -> Bool {
    guard let fields = JSErrorFields(error) else { return false }
    if fields.error == "RecordNotFound" || fields.codeString == "RecordNotFound" { return true }
    let message = fields.message
    if message.jsIndexOf("RecordNotFound") >= 0 { return true }
    if couldNotLocate.test(message) { return true }
    if recordNotFound.test(message) { return true }
    return false
  }

  nonisolated static let couldNotLocate = JSRegex("[cC][oO][uU][lL][dD] [nN][oO][tT] (?:[lL][oO][cC][aA][tT][eE]|[fF][iI][nN][dD]) [rR][eE][cC][oO][rR][dD]")
  nonisolated static let recordNotFound = JSRegex("[rR][eE][cC][oO][rR][dD][\(JSRegex.space)]+[nN][oO][tT][\(JSRegex.space)]+[fF][oO][uU][nN][dD]")

  /// Whether a write was refused for a permission the sign-in didn't grant.
  public nonisolated static func isPermissionError(_ error: (any Error)?) -> Bool {
    let fields = JSErrorFields(error)
    let code = fields?.code.flatMap { $0.isTruthy ? Optional($0.jsString) : nil } ?? ""
    let text = "\(fields?.error ?? "") \(code) \(fields?.message ?? "")".jsLowercased()
    return ["scope", "permission", "not authorized", "unauthorized", "forbidden"].contains { text.jsIndexOf($0) >= 0 }
  }

  nonisolated static func asWriteError(_ error: any Error) -> any Error {
    guard isPermissionError(error) else { return error }
    return TemplateServiceError(templatePermissionMessage, permission: true, cause: error)
  }

  /// Save a new template. The PDS mints the TID; the result carries the uri
  /// and cid it answered with. A template that doesn't validate is refused
  /// before any request, with the problems on `fieldErrors`.
  @discardableResult
  public func create(_ template: some TemplateFields, _ account: TemplateAccount?) async throws -> PostTemplate {
    guard let did = account?.did, !did.isEmpty else { throw TemplateServiceError("Not signed in") }
    accountFor(did)
    let isTemplate = template.templateIsPresent && template.templateObject != nil
    let record: JSONValue? =
      isTemplate ? Self.clampDefaults(PostTemplates.templateToRecord(template, now: now())) : Optional<JSONValue>.none
    let fieldErrors = problemsWith(did, template, record)
    if !fieldErrors.isEmpty { throw Self.validationError(fieldErrors) }

    let startedIn = generationOf(did)
    let agent = try await agentOf(account)
    let data: JSONValue
    do {
      data = try await agent.createRecord(repo: did, collection: collection, record: record ?? .null)
    } catch {
      throw Self.asWriteError(error)
    }
    // The answer is the response body.
    let uri = data.templateField("uri")
    let rkey = TemplateJS.rkeyOf(uri)
    if rkey.isEmpty {
      throw TemplateServiceError("The template was sent, but the reply didn’t say where it was saved.")
    }
    let entry = Entry(uri: uri ?? .null, cid: data.templateField("cid")?.truthy ?? .null, value: record ?? .null)
    adopt(did, startedIn, rkey, entry)
    return PostTemplates.normalizeTemplateRecord(entry.json)
  }

  /// Save an edit in place, on the same rkey, keeping the record's createdAt.
  @discardableResult
  public func update(_ rkey: String?, _ template: some TemplateFields, _ account: TemplateAccount?) async throws -> PostTemplate {
    guard let did = account?.did, !did.isEmpty else { throw TemplateServiceError("Not signed in") }
    let rkey = try Self.requireRkey(rkey)
    let existing = accountFor(did).byRkey[rkey]
    var edited = template.templateObject ?? [:]
    edited["rkey"] = .string(rkey)
    let createdAt = existing?.value.templateField("createdAt")?.truthy ?? template.templateField("createdAt")?.truthy
    var stamped = edited
    stamped["createdAt"] = createdAt
    let record = Self.clampDefaults(PostTemplates.templateToRecord(JSONValue.object(stamped), now: now(), isUpdate: true))
    let fieldErrors = problemsWith(did, JSONValue.object(edited), record)
    if !fieldErrors.isEmpty { throw Self.validationError(fieldErrors) }

    let startedIn = generationOf(did)
    let agent = try await agentOf(account)
    let data: JSONValue
    do {
      data = try await agent.putRecord(repo: did, collection: collection, rkey: rkey, record: record)
    } catch {
      throw Self.asWriteError(error)
    }
    let uri = data.templateField("uri")?.truthy ?? existing?.uri.truthy
      ?? .string("at://\(did)/\(collection)/\(rkey)")
    let entry = Entry(uri: uri, cid: data.templateField("cid")?.truthy ?? .null, value: record)
    adopt(did, startedIn, rkey, entry)
    return PostTemplates.normalizeTemplateRecord(entry.json)
  }

  /// Delete a template. One already gone counts as deleted.
  public func remove(_ rkey: String?, _ account: TemplateAccount?) async throws {
    guard let did = account?.did, !did.isEmpty else { throw TemplateServiceError("Not signed in") }
    let rkey = try Self.requireRkey(rkey)
    let startedIn = generationOf(did)
    let agent = try await agentOf(account)
    do {
      _ = try await agent.deleteRecord(repo: did, collection: collection, rkey: rkey)
    } catch {
      // Anything but "already gone" must surface, or the template would
      // leave the library while staying public in the repo.
      if !Self.isRecordNotFound(error) { throw Self.asWriteError(error) }
    }
    adopt(did, startedIn, rkey, nil)
  }

  /// Forget what memory holds: for `did`, or for every account. Reads and
  /// writes in flight then land nowhere. The cache stays (it is the
  /// account's own data); removing the account from the device clears it.
  public func reset(_ did: String? = nil) {
    let dids: [String]
    if let did, !did.isEmpty {
      dids = [did]
      accountGenerations[JSKey(did), default: 0] += 1
      accounts[JSKey(did)] = nil
      accountOrder.removeAll { $0 == JSKey(did) }
      inflight[JSKey(did)] = nil
    } else {
      dids = accountOrder.map(\.value)
      generation += 1
      accounts = [:]
      accountOrder = []
      inflight = [:]
    }
    for d in dids { emitChanged(d) }
  }
}
