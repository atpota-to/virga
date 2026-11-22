// Ports src/posting/composer/Composer.jsx (its state beside the post, opening, what's kept, post as)
//
// What Composer.jsx holds beside the post itself (ComposerStateModel holds
// the post, its reducer and its autosave): who it goes out as, the
// notices, the error, the busy line, what an intent asked to load, images
// being prepared, links being read, the dialogs, and the last split that
// can be taken back. Its functions keep the web's names (startFromIntent,
// restoreFor, changeAsDid, loadState, …); the view only binds to it.
//
// Scheduling (Schedule, Add to queue, a scheduled post opened to edit) is
// ComposerController+Schedule.swift, its state `scheduling`; the lines that
// reach it from here are marked SCHEDULE.
//
// Not here yet: the timer's editor in the composer (LifespanDialog) and its
// default (defaultTimerFor). Its button says so.

#if canImport(UIKit)
import Foundation
import Observation
import VirgaArchive
import VirgaCore
import VirgaNetwork
import VirgaPosting
import VirgaSession

/// A notice over the post: `{ key, tone, text, action }`.
struct ComposerNotice: Identifiable {
  enum Tone { case info, warn }
  var key: String
  var tone: Tone
  var text: String
  var actionLabel: String?
  var action: (() -> Void)?
  var id: String { key }
}

/// The error under the post: `{ text, permission?, reauth? }`.
struct ComposerErrorLine: Equatable {
  var text: String
  var permission = false
  var reauth = false
}

/// The busy row: `{ action, line, slow, cancel }`.
struct ComposerBusy: Equatable {
  var action: String
  var line: String?
  var slow = false
  var cancellable = false
  /// ADVISER: the adviser is reading, so its line stands in for this one.
  var adviser = false
}

/// A yes-or-no question (ConfirmDialog): its choices are its buttons.
struct ComposerAsk: Identifiable {
  struct Choice: Identifiable {
    var value: String
    var label: String
    var primary = false
    var danger = false
    var id: String { value }
  }
  var title: String
  var body: String
  var choices: [Choice]
  var id: String { title }
}

/// What an intent is still reading: 'loading', or `{ error, soft }`.
enum ComposerLoad: Equatable {
  case loading
  case softLoading
  case failed(String, soft: Bool)
}

/// Which small dialog is up.
enum ComposerDialog: Identifiable, Equatable {
  case alt(postId: String, imageId: String)
  case videoAlt(postId: String)
  case card(postId: String)
  case meta
  case gates
  case timer
  case continueThread
  case library(LibraryRequest)
  case saveTemplate
  var id: String {
    switch self {
    case .alt(let p, let i): return "alt-\(p)-\(i)"
    case .videoAlt(let p): return "video-\(p)"
    case .card(let p): return "card-\(p)"
    case .meta: return "meta"
    case .gates: return "gates"
    case .timer: return "timer"
    case .continueThread: return "continue"
    case .library: return "library"
    case .saveTemplate: return "save-template"
    }
  }

  /// The library and the template editor take the whole height.
  var isTall: Bool {
    switch self {
    case .library, .saveTemplate: return true
    default: return false
    }
  }
}

@MainActor
@Observable
public final class ComposerController {
  let model: ComposerStateModel
  @ObservationIgnored let autosaver: Autosaver
  @ObservationIgnored let session: SessionModel
  @ObservationIgnored let store: (any KeyValueStore)?
  @ObservationIgnored let transport: any HTTPTransport
  @ObservationIgnored let publisher: any ComposerPublisher
  /// The app's file store, where a draft's media are kept on this device.
  @ObservationIgnored let files: any FileStore
  @ObservationIgnored let toasts: ToastCenter
  @ObservationIgnored let closeSheet: () -> Void
  /// The account's archive, read for Continue a thread.
  @ObservationIgnored let openArchive: OpenArchiveStore
  /// The account's templates, for the "/" shortcuts (useTemplates).
  let templates: TemplatesModel
  /// ADVISER: the post adviser (useAdviserGate; ComposerController+Adviser.swift).
  let adviser: AdviserGateModel
  /// SCHEDULE: the when panel, the queue's next slot, the limits, the row a
  /// scheduled post was opened from (ComposerController+Schedule.swift).
  let scheduling = ComposerScheduling()
  /// The account the autosaver may still write for (its `currentDid`).
  @ObservationIgnored let currentDid: Locked<String?>

  var notices: [ComposerNotice] = []
  var error: ComposerErrorLine?
  var permissionForced = false
  var busy: ComposerBusy?
  var loads: [String: ComposerLoad] = [:]
  /// postId → images being prepared.
  var processing: [String: Int] = [:]
  var cardLoading: Set<String> = []
  var recordLoading: Set<String> = []
  var mediaNote = ""
  var showTags = false
  var dialog: ComposerDialog?
  var ask: ComposerAsk?
  var threadUndo: JSONValue?
  var activeIndex = 0
  var splitDismissed = false
  var postNow = false
  var generation = 0
  var gatesInfo: (did: String, status: String, source: String?, notice: String?)?
  /// The editor that should take the caret, by post id, once it's drawn.
  var focusPostId: String?
  /// Continue a thread's list: `{ status, items, error }`.
  var continueState: (status: String, items: [JSONValue], error: String) = (status: "idle", items: [], error: "")
  /// What Save as a template starts the editor from.
  var templateSeed: TemplateSeed?
  /// A caret the controller put into a post's text (a split, a mention).
  var pendingCaret: [String: Int] = [:]

  @ObservationIgnored var loadToken = 0
  @ObservationIgnored var attempt = 0
  @ObservationIgnored var seed: JSONValue?
  @ObservationIgnored var replyRefPending: JSONValue?
  @ObservationIgnored var dismissedLinks: [String: Set<JSKey>] = [:]
  @ObservationIgnored var askResolve: CheckedContinuation<String?, Never>?
  @ObservationIgnored var publishTask: Task<Void, Never>?
  @ObservationIgnored var videoJobs: [String: (file: ComposerFile, did: String, task: Task<Void, Never>)] = [:]
  @ObservationIgnored var seenAccounts: Set<JSKey> = []
  @ObservationIgnored var settingsCache: [JSKey: PostingSettings] = [:]

  init(
    session: SessionModel, store: (any KeyValueStore)?, transport: any HTTPTransport,
    publisher: any ComposerPublisher, files: any FileStore, toasts: ToastCenter, openArchive: @escaping OpenArchiveStore,
    close: @escaping () -> Void
  ) {
    self.files = files
    self.openArchive = openArchive
    self.session = session
    self.store = store
    self.transport = transport
    self.publisher = publisher
    self.toasts = toasts
    self.closeSheet = close
    let did = session.did ?? ""
    let box = Locked<String?>(did)
    currentDid = box
    let autosaver = Autosaver(store: store, currentDid: { box.withLock { $0 } })
    self.autosaver = autosaver
    let defaults = PostingSettingsStore.readPostingSettings(did, store: store, language: Self.language).json
    model = ComposerStateModel(asDid: did, defaults: defaults, autosaver: autosaver)
    templates = TemplatesModel(session: session, did: did.isEmpty ? nil : did)
    adviser = AdviserGateModel(store: store, transport: transport)  // ADVISER
    seenAccounts = Set(session.accounts.map { JSKey($0.did) })
    templates.start()
  }

  // MARK: Reading

  static var language: JSONValue? { Locale.preferredLanguages.first.map(JSONValue.string) }

  var now: Double { Date().timeIntervalSince1970 * 1000 }
  var state: ComposerState { model.state }
  var activeDid: String { session.did ?? "" }
  var asDid: String { state.asDid.isEmpty ? activeDid : state.asDid }

  /// The account's posting settings, read once per account until the
  /// composer opens again (Settings can change them meanwhile).
  func settingsFor(_ did: String) -> PostingSettings {
    if let held = settingsCache[JSKey(did)] { return held }
    let read = PostingSettingsStore.readPostingSettings(did, store: store, language: Self.language)
    settingsCache[JSKey(did)] = read
    return read
  }

  var settings: PostingSettings { settingsFor(asDid) }

  var caps: AccountCapabilities { session.capabilitiesFor(asDid.isEmpty ? nil : asDid) }

  var account: SessionAccount? { session.accounts.first { $0.did.jsEquals(asDid) } }

  var signedOut: Bool { account?.status == .needsSignIn }

  var accountsJSON: [JSONValue] { session.accounts.compactMap { try? JSONValue(encoding: $0) } }

  func accountJSON(_ did: String) -> JSONValue? {
    session.accounts.first { $0.did.jsEquals(did) }.flatMap { try? JSONValue(encoding: $0) }
  }

  func baseState(_ did: String) -> ComposerState {
    ComposerModel.emptyComposerState(asDid: .string(did), defaults: settingsFor(did).json)
  }

  func indexOfPost(_ postId: String?) -> Int {
    guard let postId else { return -1 }
    return state.posts.firstIndex { $0.id.jsEquals(postId) } ?? -1
  }

  func dispatch(_ action: ComposerAction) {
    model.dispatch(action)
    followAccount()
  }

  /// The autosave and the templates follow the account the post goes out as.
  func followAccount() {
    let did = model.state.asDid
    currentDid.withLock { $0 = did }
    templates.setAccount(did.isEmpty ? nil : did)
  }

  /// The autosave written at once (Close, or the app going to the background).
  func flush() {
    autosaver.flush()
  }

  // MARK: Loading a state

  /// `loadState(next, { touched })`.
  func loadState(_ next: ComposerState, touched: Bool = false) {
    seed = nil
    postNow = false
    model.load(next, touched: touched)
    followAccount()
    generation += 1
    processing = [:]
    cardLoading = []
    recordLoading = []
    mediaNote = ""
    dismissedLinks = [:]
    threadUndo = nil
    resolveGates()
  }

  // MARK: Opening (§6.3)

  func startFromIntent(_ raw: JSONValue) {
    settingsCache = [:]
    let plan = ComposerIntent.normalizeIntent(raw, activeDid: activeDid)
    let cur = state
    forgetGoneAccounts()

    // Reopened with nothing new: what was being written is still here.
    if !plan.hasContent && !ComposerModel.isEmptyComposer(cur) {
      error = nil
      reopenScheduling(plan.mode)  // SCHEDULE
      return
    }

    loadToken += 1
    let token = loadToken
    error = nil
    permissionForced = false
    scheduling.row = nil  // SCHEDULE
    scheduling.sourceWarning = ""
    let base = baseState(plan.asDid)

    if !plan.hasContent {
      loads = [:]
      if restoreFor(plan.asDid, base: base, token: token) { return }
      loadState(ComposerIntent.seedFromIntent(base, plan))
      notices = elsewhereNotices(plan.asDid)
      if plan.mode == "schedule" { openWhen() }  // SCHEDULE
      return
    }

    // An intent with words of its own: the post in progress is set aside,
    // never written over. So is one kept for this account from before.
    var notes: [ComposerNotice] = []
    var aside: (did: String, id: String)?
    if ComposerRestore.worthSettingAside(cur.json, seed) {
      if let id = ComposerRestore.setAsideState(
        cur.asDid, cur.json, touched: model.lifespanTouched, store: store, now: now)
      {
        aside = (did: cur.asDid, id: id)
      }
    } else if !ComposerModel.isEmptyComposer(cur) {
      ComposerRestore.clearKept(cur.asDid, store: store, now: now)
    }
    let keptId = ComposerRestore.setAsideKept(plan.asDid, base: base.json, store: store, now: now)
    if aside == nil, let keptId { aside = (did: plan.asDid, id: keptId) }
    if let aside { notes.append(asideNotice(aside.did, aside.id, "The post you were writing is set aside.")) }
    let seeded = ComposerIntent.seedFromIntent(base, plan)
    loadState(seeded)
    seed = .object(["texts": .array(plan.texts.map(JSONValue.string))])
    for n in plan.notes { notes.append(ComposerNotice(key: "mode-\(n)", tone: .info, text: n)) }
    if plan.fromLink {
      notes.append(ComposerNotice(key: "link", tone: .info, text: "From a link. Nothing is posted until you send it."))
    }
    notices = notes
    // SCHEDULE: an intent that asks for a time opens the when panel at the next hour.
    scheduling.whenOpen = plan.mode == "schedule"
    if plan.mode == "schedule" { dispatch(.setSchedule(.at(Self.nextHour()))) }
    if !plan.images.isEmpty, let postId = seeded.posts.first?.id {
      Task { await addDescribedImages(postId, plan.images) }
    }
    runLoads(plan, token: token)
  }

  // MARK: What's kept, and what's set aside

  func restoredNotice(_ left: Double, key: String = "restored", lead: String = "Picked up where you left off")
    -> ComposerNotice
  {
    let n = Int(left)
    let tail =
      n > 0
      ? ". \(n == 1 ? "One image or video" : "\(n) images or videos") couldn’t be kept after the page closed; add \(n == 1 ? "it" : "them") again"
      : ""
    return ComposerNotice(
      key: key, tone: n > 0 ? .warn : .info, text: "\(lead)\(tail).", actionLabel: "Start over",
      action: { [weak self] in self?.startOver(confirm: false) })
  }

  func asideNotice(_ did: String, _ id: String, _ text: String) -> ComposerNotice {
    ComposerNotice(
      key: "aside-\(id)", tone: .info,
      text: "\(text) It’s offered again the next time the composer opens with nothing in it.",
      actionLabel: "Open it instead", action: { [weak self] in self?.openAside(did, id) })
  }

  /// Where an unsent post went, when the composer opens empty for one
  /// account and another has one kept.
  func elsewhereNotices(_ did: String) -> [ComposerNotice] {
    guard let other = ComposerRestore.otherKeptAccount(accountsJSON, did, store: store, now: now) else { return [] }
    let label = ComposerSubmit.accountLabel(other.account, other.did)
    return [
      ComposerNotice(
        key: "elsewhere-\(other.did)", tone: .info, text: "You have an unsent post as \(label).", actionLabel: "Open it",
        action: { [weak self] in self?.changeAsDid(other.did) })
    ]
  }

  func loadKept(_ state: ComposerState, touched: Bool, notes: [ComposerNotice]) {
    loads = [:]
    scheduling.whenOpen = false  // SCHEDULE
    loadState(state, touched: touched)
    notices = notes
    fillMedia(state, token: loadToken)
  }

  static func touchedJSON(_ aside: TakenAside) -> JSONValue {
    var kept: [String: JSONValue] = ["state": aside.state]
    if let touched = aside.lifespanTouched { kept["lifespanTouched"] = .bool(touched) }
    return .object(kept)
  }

  /// What was kept for `did`: the post being written, else the newest set
  /// aside. False when there's nothing.
  func restoreFor(_ did: String, base: ComposerState, token: Int) -> Bool {
    if let kept = ComposerRestore.keptPostFor(did, base: base.json, store: store, now: now) {
      loadKept(
        ComposerState(json: kept.state), touched: kept.touched,
        notes: kept.from == "session" ? [] : [restoredNotice(kept.mediaLeftOut)])
      return true
    }
    if let aside = Autosave.takeSetAside(did, store: store, now: now, base: base.json) {
      let restored = aside.inMemory ? ComposerState(json: aside.state) : ComposerModel.normalizeComposerState(aside.state)
      loadKept(
        restored, touched: ComposerRestore.restoredTouched(Self.touchedJSON(aside)),
        notes: [restoredNotice(aside.mediaLeftOut, key: "restored-aside", lead: "Here’s the post you set aside")])
      return true
    }
    return false
  }

  /// A set-aside post back on screen; the one it replaces is set aside in turn.
  func openAside(_ did: String, _ id: String) {
    let cur = state
    autosaver.cancel()
    guard let item = Autosave.takeSetAside(did, id: id, store: store, now: now, base: baseState(did).json) else {
      notices.removeAll { $0.key == "aside-\(id)" }
      toasts.push("That post isn’t kept in this browser any more.", danger: true)
      return
    }
    loadToken += 1
    var swapped: String?
    if ComposerRestore.worthSettingAside(cur.json, seed) {
      swapped = ComposerRestore.setAsideState(cur.asDid, cur.json, touched: model.lifespanTouched, store: store, now: now)
    } else if !ComposerModel.isEmptyComposer(cur) {
      ComposerRestore.clearKept(cur.asDid, store: store, now: now)
    }
    error = nil
    permissionForced = false
    scheduling.row = nil  // SCHEDULE
    scheduling.sourceWarning = ""
    let restored = item.inMemory ? ComposerState(json: item.state) : ComposerModel.normalizeComposerState(item.state)
    loadKept(
      restored, touched: ComposerRestore.restoredTouched(Self.touchedJSON(item)),
      notes: swapped.map { [asideNotice(cur.asDid, $0, "The post you were writing is set aside.")] } ?? [])
  }

  // MARK: What the intent asks to read

  func runLoads(_ plan: ComposerIntentPlan, token: Int) {
    let kinds = ComposerIntent.intentLoads(plan)
    guard !kinds.isEmpty else {
      loads = [:]
      return
    }
    var next: [String: ComposerLoad] = [:]
    for kind in kinds { next[kind] = .loading }
    loads = next
    if let scheduledId = plan.scheduledId {
      loadScheduled(scheduledId, asDid: plan.asDid, token: token)  // SCHEDULE
      return
    }
    if plan.draftId != nil {
      openDraft(plan, token: token)
      return
    }
    // A template by its rkey waits for the library's own reading of it; an
    // attachment (the Library page's Use in a new post) is a plan, put in
    // the intent's first post once it's on screen.
    loads["template"] = nil
    loads["attach"] = nil
    if let attach = plan.attach, let libraryPlan = try? attach.decode(LibraryPlan.self),
      let postId = state.posts.first?.id
    {
      Task {
        await self.applyPlan(libraryPlan, postId, range: nil)
        guard self.loadToken == token else { return }
        // What the plan put in is still the intent's, not the writer's.
        self.seed = .object(["texts": .array(self.state.posts.map { .string($0.text) })])
      }
    }
    if let reply = plan.reply {
      replyRefPending = reply.json
      loadReply(reply.json, token: token)
    }
    if let quote = plan.quote {
      let reads = ComposerReads.network(transport: transport)
      Task {
        do {
          let record = try await ComposerLoaders.loadRecordTarget(quote.json, reads: reads)
          guard self.loadToken == token else { return }
          self.dispatch(.setRecord(index: 0, record: ComposerRecord(json: record)))
          self.loads["quote"] = nil
        } catch {
          guard self.loadToken == token else { return }
          self.loads["quote"] = .failed(Self.message(error), soft: false)
        }
      }
    }
  }

  /// `ref.soft`: the state already holds the reply's uri, cid and root.
  func loadReply(_ ref: JSONValue, token: Int? = nil) {
    let token = token ?? loadToken
    let soft = ref["soft"]?.isTruthy ?? false
    let scheduled = ref["scheduled"]?.isTruthy ?? false
    loads["reply"] = soft ? .softLoading : .loading
    let reads = ComposerReads.network(transport: transport)
    Task {
      do {
        let reply = try await ComposerLoaders.loadReplyTarget(ref, reads: reads)
        guard self.loadToken == token, self.replyRefPending == ref else { return }
        self.dispatch(.setReply(ComposerReply(json: reply)))
        self.replyRefPending = nil
        self.loads["reply"] = nil
      } catch {
        guard self.loadToken == token, self.replyRefPending == ref else { return }
        let message = Self.message(error)
        let text =
          soft
          ? "\(message) \(scheduled ? "Virga’s server looks again when it’s due, and holds the reply back if the post is gone." : "It still goes out as a reply to that post.")"
          : "\(message) Until it can, this would go out as a new post."
        self.loads["reply"] = .failed(text, soft: soft)
      }
    }
  }

  func retryReply() {
    if let ref = replyRefPending { loadReply(ref) }
  }

  func dropReply() {
    replyRefPending = nil
    loads["reply"] = nil
    dispatch(.setReply(nil))
  }

  nonisolated static func message(_ error: any Error) -> String {
    JSErrorFields(error)?.message ?? (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
  }

  // MARK: Post as

  func changeAsDid(_ did: String) {
    let cur = state
    let old = cur.asDid
    guard !did.isEmpty, !did.jsEquals(old) else { return }
    autosaver.cancel()
    error = nil
    permissionForced = false
    scheduling.preview = QueuePreview()  // SCHEDULE
    let base = baseState(did)
    let label = ComposerSubmit.accountLabel(accountJSON(did), did)

    // Nothing written: what was kept for that account comes back instead.
    if ComposerModel.isEmptyComposer(cur) {
      loadToken += 1
      if restoreFor(did, base: base, token: loadToken) { return }
      dispatch(.setAsDid(did))
      notices.removeAll { $0.key.hasPrefix("elsewhere-") }
      resolveGates()
      return
    }

    // The post goes with the writer to the new account. One already kept
    // there is set aside rather than written over.
    let asideId = ComposerRestore.setAsideKept(did, base: base.json, store: store, now: now)
    ComposerRestore.clearKept(old, store: store, now: now)
    var next = ComposerModel.composerReducer(cur, .setAsDid(did))
    let fitted = next.gates.custom ? GatesModel.gatesForAccount(next.gates.json, did) : nil
    if let fitted, fitted.dropped > 0, let gates = fitted.gates { next.json["gates"] = gates }
    dispatch(.load(next))
    var notes: [ComposerNotice] = []
    if let asideId {
      notes.append(asideNotice(did, asideId, "You already had a post in progress as \(label). It’s set aside."))
    }
    if let fitted, fitted.dropped > 0 {
      let one = fitted.dropped == 1
      let text =
        fitted.reset == true
        ? "Replies were limited to members of another account’s list, which \(label) can’t use, so this post now has \(label)’s usual reply settings."
        : "\(one ? "A list" : "Lists") from another account can’t limit replies to \(label)’s post, so \(one ? "it was" : "they were") taken out of who can reply."
      notes.append(ComposerNotice(key: "gates-lists", tone: .warn, text: text))
    }
    notices = notices.filter { !$0.key.hasPrefix("elsewhere-") && $0.key != "gates-lists" } + notes
    resolveGates()
    // Blobs belong to one repo: a video starts again as the new account.
    startVideoUploads()
  }

  /// An account removed from this device takes its unsent post with it.
  func forgetGoneAccounts() {
    let present = Set(session.accounts.map { JSKey($0.did) })
    for did in seenAccounts where !present.contains(did) { Autosave.forgetSessionDrafts(did.value) }
    let asDidNow = state.asDid
    let gone = !asDidNow.isEmpty && seenAccounts.contains(JSKey(asDidNow)) && !present.contains(JSKey(asDidNow))
    seenAccounts = present
    guard gone else { return }
    let home = present.contains(JSKey(activeDid)) ? activeDid : (session.accounts.first?.did ?? "")
    loadToken += 1
    error = nil
    replyRefPending = nil
    scheduling.row = nil  // SCHEDULE
    scheduling.sourceWarning = ""
    if home.isEmpty || !restoreFor(home, base: baseState(home), token: loadToken) {
      loads = [:]
      scheduling.whenOpen = false  // SCHEDULE
      loadState(baseState(home))
      notices = []
    }
  }

  // MARK: Default reply settings (§6.6)

  func resolveGates() {
    let did = state.asDid
    guard !did.isEmpty, !state.gates.custom, state.reply == nil else { return }
    let settings = settingsFor(did)
    gatesInfo = (did: did, status: "loading", source: nil, notice: nil)
    let session = self.session
    Task {
      let agent = try? await session.agentFor(did)
      let r = await PostingSettingsStore.resolveDefaultGates(settings, agent: agent?.gatesAgent)
      guard self.state.asDid.jsEquals(did) else { return }
      if !self.state.gates.custom { self.dispatch(.setDefaultGates(r.gates)) }
      self.gatesInfo = (did: did, status: "ready", source: r.source, notice: r.notice)
    }
  }
}
#endif
