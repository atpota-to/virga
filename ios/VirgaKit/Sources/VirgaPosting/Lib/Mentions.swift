// Ports src/posting/lib/mentions.js
//
// Mentions: where an @handle starts and ends (findMentions, which facet
// detection uses too), the typeahead's view of the mention being typed, and
// resolving a handle to its DID through the public AppView.
//
// The resolver's network call is injected (`MentionFetch`), as the web's
// `createMentionResolver({ fetch })` takes it; the shared default
// (`Mentions.resolveMention`) uses `Mentions.defaultFetch`, which the app
// sets to VirgaNetwork's transport (wave 2). Unset, every lookup is a
// network failure: no DID, nothing remembered.

import Foundation
import VirgaCore

/// An '@' in text and the handle after it.
public struct MentionMatch: Codable, Hashable, Sendable {
  public var start: Int
  public var end: Int
  public var handle: String
  public var email: Bool
}

/// The mention being typed at the cursor.
public struct PartialMention: Codable, Hashable, Sendable {
  public var start: Int
  public var end: Int
  public var query: String
  public var fullText: String
}

/// A mention the cursor has left.
public struct CompletedMention: Codable, Hashable, Sendable {
  public var start: Int
  public var end: Int
  public var handle: String
  public var fullText: String
}

/// What a fetch for a handle got back: the status and the body.
public struct MentionFetchResponse: Sendable {
  public var status: Int
  public var body: Data
  public init(status: Int, body: Data) {
    self.status = status
    self.body = body
  }
  public var ok: Bool { (200..<300).contains(status) }
}

/// `fetch(url)` for the resolver: throws for a network failure.
public typealias MentionFetch = @Sendable (_ url: String) async throws -> MentionFetchResponse

/// `(handle) => Promise<did | null>`, as facet detection takes it.
public typealias ResolveMention = @Sendable (_ handle: String) async throws -> String?

public enum Mentions {
  static func isHandleChar(_ unit: UInt16?) -> Bool {
    guard let unit else { return false }
    switch unit {
    case 0x30...0x39, 0x41...0x5A, 0x61...0x7A, 0x2E, 0x2D: return true
    default: return false
    }
  }

  static func isAlphaNumeric(_ unit: UInt16?) -> Bool {
    guard let unit else { return false }
    switch unit {
    case 0x30...0x39, 0x41...0x5A, 0x61...0x7A: return true
    default: return false
    }
  }

  static func unit(_ units: [UInt16], _ index: Int) -> UInt16? {
    index >= 0 && index < units.count ? units[index] : nil
  }

  /// An '@' straight after an ASCII letter or digit is an email address.
  static func isEmailAt(_ units: [UInt16], _ at: Int) -> Bool {
    at > 0 && isAlphaNumeric(unit(units, at - 1))
  }

  /// An '@' straight after '/' is a URL path segment (/@handle/repo).
  static func isUrlPathAt(_ units: [UInt16], _ at: Int) -> Bool {
    unit(units, at - 1) == 0x2F
  }

  /// Every '@' in text followed by a handle. A handle runs to the first
  /// character a handle can't contain, less any trailing dots. An '@' right
  /// after an ASCII letter or digit is an email address (`email: true`,
  /// handle unchecked); one right after '/' is skipped; otherwise the handle
  /// must pass isValidHandle.
  public static func findMentions(_ text: String) -> [MentionMatch] {
    findMentions(units: Array(text.utf16))
  }

  static func findMentions(units: [UInt16]) -> [MentionMatch] {
    var found: [MentionMatch] = []
    for start in units.indices where units[start] == 0x40 {
      var end = start + 1
      while end < units.count, isHandleChar(units[end]) { end += 1 }
      while end > start + 1, units[end - 1] == 0x2E { end -= 1 }
      let handle = String(jsUnits: units[(start + 1)..<end])
      if handle.isEmpty || isUrlPathAt(units, start) { continue }
      let email = isEmailAt(units, start)
      if email || isValidHandle(handle) {
        found.append(MentionMatch(start: start, end: end, handle: handle, email: email))
      }
    }
    return found
  }

  static let likelyInUrl = [
    JSRegex(#"https?://[^\#(JSRegex.space)]*\z"#),
    JSRegex(#"www\.[^\#(JSRegex.space)]*\z"#),
    JSRegex(#"[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}[^\#(JSRegex.space)]*\z"#),
    JSRegex(#"://[^\#(JSRegex.space)]*\z"#),
  ]

  /// The @-mention being typed at the cursor, for typeahead suggestions.
  public static func detectPartialMention(_ text: String, _ cursorPosition: Int) -> PartialMention? {
    let units = Array(text.utf16)
    var atIndex = -1
    var i = cursorPosition - 1
    while i >= 0 {
      let u = unit(units, i)
      if u == 0x40 {
        atIndex = i
        break
      } else if !isHandleChar(u) {
        break
      }
      i -= 1
    }
    if atIndex == -1 { return nil }
    if isEmailAt(units, atIndex) || isUrlPathAt(units, atIndex) { return nil }

    // Skip an @ inside a URL (scheme, www. or domain-like text right before it).
    let before = String(jsUnits: units[max(0, atIndex - 20)..<atIndex])
    if likelyInUrl.contains(where: { $0.test(before) }) { return nil }

    var endIndex = cursorPosition
    while endIndex < units.count, endIndex >= 0, isHandleChar(units[endIndex]) { endIndex += 1 }
    let mentionText = text.jsSubstring(atIndex + 1, endIndex)
    if cursorPosition >= atIndex + 1, cursorPosition <= endIndex {
      return PartialMention(start: atIndex, end: endIndex, query: mentionText, fullText: "@" + mentionText)
    }
    return nil
  }

  /// Mentions the cursor has left, ready to validate: a mention with the
  /// cursor outside it and outside any dots trailing it.
  public static func detectCompletedMentions(_ text: String, _ cursorPosition: Int) -> [CompletedMention] {
    let units = Array(text.utf16)
    var mentions: [CompletedMention] = []
    for match in findMentions(units: units) where !match.email {
      let charAfter = unit(units, match.end)
      // An apostrophe not yet followed by "s" is an incomplete possessive.
      if charAfter == 0x27 || charAfter == 0x2019, unit(units, match.end + 1) != 0x73 { continue }
      var typingEnd = match.end
      while unit(units, typingEnd) == 0x2E { typingEnd += 1 }
      if cursorPosition < match.start || cursorPosition > typingEnd {
        mentions.append(
          CompletedMention(
            start: match.start, end: match.end, handle: match.handle,
            fullText: String(jsUnits: units[match.start..<match.end])))
      }
    }
    return mentions
  }

  /// A mention facet for an account picked from the typeahead.
  public static func createMentionFacet(did: String, start: Int, end: Int, byteMap: [Int]) -> Facet {
    Facet(byteStart: byteMap[start], byteEnd: byteMap[end], feature: .mention(did: did))
  }

  /// Handle syntax: two or more dot-separated segments of 1-63 ASCII letters,
  /// digits and hyphens, none starting or ending with a hyphen, the last not
  /// starting with a digit, at most 253 in all.
  public static func isValidHandle(_ handle: String?) -> Bool {
    guard let handle, !handle.isEmpty, handle.jsLength <= 253 else { return false }
    let segments = Array(handle.utf16).split(separator: 0x2E, omittingEmptySubsequences: false)
    guard segments.count >= 2, segments.allSatisfy(isHandleSegment) else { return false }
    let first = segments[segments.count - 1].first!
    return !(0x30...0x39).contains(first)
  }

  /// `^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`.
  static func isHandleSegment(_ units: ArraySlice<UInt16>) -> Bool {
    guard (1...63).contains(units.count) else { return false }
    guard isAlphaNumeric(units.first), isAlphaNumeric(units.last) else { return false }
    return units.allSatisfy { isAlphaNumeric($0) || $0 == 0x2D }
  }

  // MARK: Debounce

  /// A debounced `fn`: only the last call in each `delay` window runs.
  public static func debounce<Value: Sendable>(
    _ fn: @escaping @Sendable (Value) -> Void,
    _ delay: Duration
  ) -> @Sendable (Value) -> Void {
    let pending = Locked<Task<Void, Never>?>(nil)
    return { value in
      let task = Task {
        try? await Task.sleep(for: delay)
        if Task.isCancelled { return }
        fn(value)
      }
      pending.withLock { current in
        current?.cancel()
        current = task
      }
    }
  }

  // MARK: Resolving handles

  public static let resolveTimeoutMs: Double = 8000
  public static let resolveCacheTtlMs: Double = 5 * 60_000

  /// The fetch the shared resolver uses: VirgaNetwork's, once the app sets it.
  public static let defaultFetch = Locked<MentionFetch?>(nil)

  /// A `resolveMention` over the public AppView's
  /// `com.atproto.identity.resolveHandle`. A handle the AppView says doesn't
  /// exist (400) resolves to nil and is remembered for `ttlMs`, as is a DID; a
  /// network failure resolves to nil and isn't remembered. Concurrent asks
  /// for one handle share a request.
  public static func createMentionResolver(
    fetch: MentionFetch? = nil,
    appview: String = AppConfig.appview,
    ttlMs: Double = resolveCacheTtlMs,
    timeoutMs: Double = resolveTimeoutMs,
    now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }
  ) -> ResolveMention {
    let resolver = MentionResolver(fetch: fetch, appview: appview, ttlMs: ttlMs, timeoutMs: timeoutMs, now: now)
    return { handle in await resolver.resolve(handle) }
  }

  /// The shared resolver posting uses when the caller doesn't supply one.
  public static let resolveMention: ResolveMention = createMentionResolver()
}

/// The state behind `createMentionResolver`: answers and requests in flight.
actor MentionResolver {
  let fetch: MentionFetch?
  let appview: String
  let ttlMs: Double
  let timeoutMs: Double
  let now: @Sendable () -> Double
  private var answers: [String: (did: String?, at: Double)] = [:]
  private var inFlight: [String: Task<String?, Never>] = [:]

  init(fetch: MentionFetch?, appview: String, ttlMs: Double, timeoutMs: Double, now: @escaping @Sendable () -> Double) {
    self.fetch = fetch
    self.appview = appview
    self.ttlMs = ttlMs
    self.timeoutMs = timeoutMs
    self.now = now
  }

  func resolve(_ rawHandle: String?) async -> String? {
    var handle = rawHandle ?? ""
    if handle.hasPrefix("@") { handle.removeFirst() }
    handle = PostingJS.toLowerCase(handle)
    guard Mentions.isValidHandle(handle) else { return nil }

    if let held = answers[handle], now() - held.at < ttlMs { return held.did }
    if let running = inFlight[handle] { return await running.value }

    let url = "\(appview)/xrpc/com.atproto.identity.resolveHandle?handle=\(URIComponent.encodeURIComponent(handle))"
    let fetch = self.fetch ?? Mentions.defaultFetch.wrappedValue
    let timeout = timeoutMs
    let ask = Task<String?, Never> {
      let outcome = await Self.fetchWithTimeout(fetch, url, timeoutMs: timeout)
      self.settle(handle, outcome)
      switch outcome {
      case .did(let did): return did
      case .noSuchHandle, .failed: return nil
      }
    }
    inFlight[handle] = ask
    return await ask.value
  }

  enum Outcome: Sendable {
    case did(String?)
    case noSuchHandle
    case failed
  }

  private func settle(_ handle: String, _ outcome: Outcome) {
    switch outcome {
    case .did(let did): answers[handle] = (did, now())
    case .noSuchHandle: answers[handle] = (nil, now())
    case .failed: break
    }
    inFlight[handle] = nil
  }

  static func fetchWithTimeout(_ fetch: MentionFetch?, _ url: String, timeoutMs: Double) async -> Outcome {
    guard let fetch else { return .failed }
    return await withTaskGroup(of: Outcome?.self) { group in
      group.addTask {
        do {
          let response = try await fetch(url)
          if response.ok {
            let body = try? JSONValue.parse(response.body)
            if let did = body?["did"]?.stringValue, did.hasPrefix("did:") { return .did(did) }
            return .did(nil)
          }
          // 400 is the AppView's "Unable to resolve handle": a definite no.
          return response.status == 400 ? .noSuchHandle : .failed
        } catch {
          return .failed
        }
      }
      group.addTask {
        try? await Task.sleep(for: .milliseconds(max(0, timeoutMs)))
        return nil
      }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first ?? .failed
    }
  }
}
