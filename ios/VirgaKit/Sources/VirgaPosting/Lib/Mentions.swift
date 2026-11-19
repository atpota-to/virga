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

/// `fetch(url)` for the resolver: throws for a network failure. The web hands
/// its fetch an `AbortSignal.timeout`; here the lookup's task is cancelled at
/// the timeout, so a fetch must stop when cancelled (URLSession's async calls
/// do) for the timeout to end the wait, as the web's fetch must honour its
/// signal.
public typealias MentionFetch = @Sendable (_ url: String) async throws -> MentionFetchResponse

/// `(handle) => Promise<did | null>`, as facet detection takes it.
public typealias ResolveMention = @Sendable (_ handle: String) async throws -> String?

/// The `RangeError` a resolver whose `timeoutMs` isn't a wait throws on
/// every lookup, as `AbortSignal.timeout` throws it (Node's message).
public struct MentionTimeoutError: Error, LocalizedError, Hashable, Sendable {
  public let message: String
  public var errorDescription: String? { message }
}

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

  /// A mention facet for an account picked from the typeahead, or nil when
  /// `start` or `end` is outside the map (the web writes undefined offsets).
  public static func createMentionFacet(did: String, start: Int, end: Int, byteMap: [Int]) -> Facet? {
    guard byteMap.indices.contains(start), byteMap.indices.contains(end) else { return nil }
    return Facet(byteStart: byteMap[start], byteEnd: byteMap[end], feature: .mention(did: did))
  }

  /// Handle syntax: two or more dot-separated segments of 1-63 ASCII letters,
  /// digits and hyphens, none starting or ending with a hyphen, the last not
  /// starting with a digit, at most 253 in all.
  /// (VirgaCore's `Handle.isValidHandle` is this function, ported there for
  /// the targets below this one.)
  public static func isValidHandle(_ handle: String?) -> Bool {
    Handle.isValidHandle(handle)
  }

  // MARK: Debounce

  /// A debounced `fn`: only the last call in each `delay` window runs.
  public static func debounce<Value: Sendable>(
    _ fn: @escaping @Sendable (Value) -> Void,
    _ delay: Duration
  ) -> @Sendable (Value) -> Void {
    let pending = Locked<Task<Void, Never>?>(nil)
    return { value in
      // The old call is cancelled and the new one scheduled in one step, so
      // two calls from different threads can't leave the earlier one
      // standing (the web's clearTimeout and setTimeout run as one).
      pending.withLock { current in
        current?.cancel()
        current = Task {
          try? await Task.sleep(for: delay)
          if Task.isCancelled { return }
          fn(value)
        }
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
  /// for one handle share a request. A `timeoutMs` that isn't a wait (not
  /// finite, or negative) makes every lookup throw `MentionTimeoutError`, as
  /// the web's `AbortSignal.timeout` does.
  public static func createMentionResolver(
    fetch: MentionFetch? = nil,
    appview: String = AppConfig.appview,
    ttlMs: Double = resolveCacheTtlMs,
    timeoutMs: Double = resolveTimeoutMs,
    now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }
  ) -> ResolveMention {
    let resolver = MentionResolver(fetch: fetch, appview: appview, ttlMs: ttlMs, timeoutMs: timeoutMs, now: now)
    return { handle in try await resolver.resolve(handle) }
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

  func resolve(_ rawHandle: String?) async throws -> String? {
    // `.replace(/^@/, '').toLowerCase()`.
    let handle = Handle.normalize(rawHandle ?? "")
    guard Mentions.isValidHandle(handle) else { return nil }

    if let held = answers[handle], now() - held.at < ttlMs { return held.did }
    if let running = inFlight[handle] { return await running.value }

    // `AbortSignal.timeout(timeoutMs)` refuses a time it can't wait for
    // before the request starts, so the lookup fails without asking.
    let timeout = try Self.abortTimeout(timeoutMs)
    let url = "\(appview)/xrpc/com.atproto.identity.resolveHandle?handle=\(JSURI.encodeURIComponent(handle))"
    let fetch = self.fetch ?? Mentions.defaultFetch.wrappedValue
    let ask = Task<String?, Never> {
      let outcome = await Self.fetchWithTimeout(fetch, url, timeout: timeout)
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

  /// The wait `AbortSignal.timeout(ms)` takes, or its RangeError (Node's
  /// message) for a time that isn't one: not a number, infinite or
  /// negative. A fraction is cut down to whole milliseconds, as a browser's
  /// `unsigned long long` argument is; the largest is 2^53 - 1.
  static func abortTimeout(_ ms: Double) throws -> Duration {
    let prefix = #"The value of "delay" is out of range. "#
    guard ms.isFinite, ms >= 0 || ms.rounded(.towardZero) == ms else {
      throw MentionTimeoutError(message: prefix + "It must be an integer. Received \(JSNumber.format(ms))")
    }
    guard ms >= 0, ms <= 9_007_199_254_740_991 else {
      throw MentionTimeoutError(
        message: prefix + "It must be >= 0 && <= 4294967295. Received \(nodeNumber(ms))")
    }
    return .milliseconds(Int64(ms.rounded(.towardZero)))
  }

  /// A number as Node's range errors show it: an integer past 2^32 with
  /// underscores between thousands.
  static func nodeNumber(_ value: Double) -> String {
    let text = JSNumber.format(value)
    guard abs(value) > 4_294_967_296, value.rounded(.towardZero) == value, !text.contains("e") else { return text }
    let negative = text.hasPrefix("-")
    var digits = Array(negative ? text.dropFirst() : Substring(text))
    var out: [Character] = []
    while digits.count > 3 {
      out.insert(contentsOf: ["_"] + digits.suffix(3), at: 0)
      digits.removeLast(3)
    }
    return (negative ? "-" : "") + String(digits + out)
  }

  static func fetchWithTimeout(_ fetch: MentionFetch?, _ url: String, timeout: Duration) async -> Outcome {
    guard let fetch else { return .failed }
    return await withTaskGroup(of: Outcome?.self) { group in
      group.addTask {
        do {
          let response = try await fetch(url)
          if response.ok {
            let body = try? JSONValue.parse(response.body)
            // `did.startsWith('did:')`, by code unit.
            if let did = body?["did"]?.stringValue, PostingJS.hasPrefix(did, "did:") { return .did(did) }
            return .did(nil)
          }
          // 400 is the AppView's "Unable to resolve handle": a definite no.
          return response.status == 400 ? .noSuchHandle : .failed
        } catch {
          return .failed
        }
      }
      group.addTask {
        try? await Task.sleep(for: timeout)
        return nil
      }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first ?? .failed
    }
  }
}
