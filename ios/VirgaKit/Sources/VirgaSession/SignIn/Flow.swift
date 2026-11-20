// Ports src/signin/flow.js
//
// The steps of a sign-in, as a reducer, with the words each step says. The
// view (VirgaUI's SignInFlow) owns the timers and the network; this decides
// where the card goes next and what it reads, so both can be tested without
// a screen.
//
//   entry    the handle field (and the accounts this device remembers)
//   finding  looking the handle up
//   found    "Is this you?", with the account and where it signs in
//   hosts    the hosts to make an account on
//   leaving  the card that says where the app is about to go
//
// session.signin runs event sequences through the web's reducer and holds
// every state and every sentence to it.

import Foundation
import VirgaCore

public enum SignInStep: String, Sendable, Hashable, Codable {
  case entry, finding, found, hosts, leaving
}

/// A line on the card: `{ about, text, anyway? }`. `about` is what it is
/// about ('field', 'lookup', 'trip'); `anyway` the handle to go on with.
public struct SignInNotice: Sendable, Hashable, Codable {
  public var about: String?
  public var text: String
  public var anyway: String?

  public init(about: String? = nil, text: String, anyway: String? = nil) {
    self.about = about
    self.text = text
    self.anyway = anyway
  }
}

/// The leaving card: `{ trip, host, purpose, from, phase }`.
public struct SignInLeaving: Sendable, Hashable, Codable {
  /// Counts the trips, so a timer from an earlier one can't act on a later one.
  public var trip: Int
  public var host: String?
  /// 'signin' or 'signup'.
  public var purpose: String
  /// The step it left.
  public var from: SignInStep
  /// 'waiting', 'sent' or 'stalled'.
  public var phase: String

  enum CodingKeys: String, CodingKey { case trip, host, purpose, from, phase }

  public init(trip: Int, host: String?, purpose: String, from: SignInStep, phase: String) {
    self.trip = trip
    self.host = host
    self.purpose = purpose
    self.from = from
    self.phase = phase
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(trip, forKey: .trip)
    if let host { try c.encode(host, forKey: .host) } else { try c.encodeNil(forKey: .host) }
    try c.encode(purpose, forKey: .purpose)
    try c.encode(from, forKey: .from)
    try c.encode(phase, forKey: .phase)
  }
}

/// The card's state: `{ step, identity, notice, leaving, hostsFrom, trips }`.
public struct SignInFlowState: Sendable, Hashable, Codable {
  public var step: SignInStep
  public var identity: SignInIdentityAnswer?
  public var notice: SignInNotice?
  public var leaving: SignInLeaving?
  public var hostsFrom: SignInStep
  public var trips: Int

  enum CodingKeys: String, CodingKey { case step, identity, notice, leaving, hostsFrom, trips }

  public init(
    step: SignInStep = .entry, identity: SignInIdentityAnswer? = nil, notice: SignInNotice? = nil, leaving: SignInLeaving? = nil,
    hostsFrom: SignInStep = .entry, trips: Int = 0
  ) {
    self.step = step
    self.identity = identity
    self.notice = notice
    self.leaving = leaving
    self.hostsFrom = hostsFrom
    self.trips = trips
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(step, forKey: .step)
    if let identity { try c.encode(identity, forKey: .identity) } else { try c.encodeNil(forKey: .identity) }
    if let notice { try c.encode(notice, forKey: .notice) } else { try c.encodeNil(forKey: .notice) }
    if let leaving { try c.encode(leaving, forKey: .leaving) } else { try c.encodeNil(forKey: .leaving) }
    try c.encode(hostsFrom, forKey: .hostsFrom)
    try c.encode(trips, forKey: .trips)
  }
}

/// What can happen to the card: the web's `{ type, … }` events.
public enum SignInFlowEvent: Sendable, Hashable {
  /// Typing answers whatever the notice said.
  case typed
  case notice(SignInNotice?)
  case find
  case found(SignInIdentityAnswer?)
  case lookupFailed(SignInNotice?)
  case notMe
  case hosts
  case hostsBack
  /// `{ type: 'leave', host, purpose }`.
  case leave(host: String?, purpose: String?)
  /// A remembered account's host, found a moment after the card came up.
  case hostKnown(trip: Int?, host: String?)
  case sent(trip: Int?)
  case stalled(trip: Int?)
  case cancel
  case tripFailed(trip: Int?, notice: SignInNotice?)
  /// Anything else, which changes nothing.
  case other(String)
}

public enum SignInFlow {
  /// Long enough that a quick lookup reads as a step rather than a flicker.
  public static let findingMinMs: Double = 450
  /// How long the leaving card stays before the app goes: time to read where
  /// it is going, and to turn back.
  public static let leaveDelayMs: Double = 3_500
  /// Once sent on, how long before offering to try again.
  public static let stallMs: Double = 4_000

  public static func initialFlow() -> SignInFlowState { SignInFlowState() }

  /// Where the card goes back to from the leaving card: the step it left,
  /// never a lookup.
  static func returnStep(_ from: SignInStep) -> SignInStep {
    from == .found || from == .hosts ? from : .entry
  }

  /// `flowReducer(state, event)`.
  public static func flowReducer(_ state: SignInFlowState, _ event: SignInFlowEvent) -> SignInFlowState {
    var next = state
    switch event {
    case .typed:
      next.notice = nil
    case .notice(let notice):
      next.notice = notice
    case .find:
      guard state.step == .entry else { return state }
      next.step = .finding
      next.identity = nil
      next.notice = nil
    case .found(let identity):
      guard state.step == .finding else { return state }
      next.step = .found
      next.identity = identity
      next.notice = nil
    case .lookupFailed(let notice):
      guard state.step == .finding else { return state }
      next.step = .entry
      next.identity = nil
      next.notice = notice
    case .notMe:
      next.step = .entry
      next.identity = nil
      next.notice = nil
    case .hosts:
      guard state.step == .entry || state.step == .found else { return state }
      next.step = .hosts
      next.hostsFrom = state.step
      next.notice = nil
    case .hostsBack:
      guard state.step == .hosts else { return state }
      // Back to "Is this you?" only while there is still someone to ask about.
      next.step = state.hostsFrom == .found && state.identity != nil ? .found : .entry
      next.notice = nil
    case .leave(let host, let purpose):
      guard state.step != .leaving, state.step != .finding else { return state }
      next.step = .leaving
      next.notice = nil
      next.trips = state.trips + 1
      next.leaving = SignInLeaving(
        trip: state.trips + 1, host: host?.isEmpty == false ? host : nil, purpose: purpose == "signup" ? "signup" : "signin",
        from: state.step, phase: "waiting")
    case .hostKnown(let trip, let host):
      guard state.step == .leaving, let leaving = state.leaving, leaving.trip == trip, leaving.host?.isEmpty ?? true,
        let host, !host.isEmpty
      else { return state }
      next.leaving?.host = host
    case .sent(let trip):
      guard state.step == .leaving, let leaving = state.leaving, leaving.trip == trip else { return state }
      next.leaving?.phase = leaving.phase == "stalled" ? "stalled" : "sent"
    case .stalled(let trip):
      guard state.step == .leaving, state.leaving?.trip == trip else { return state }
      next.leaving?.phase = "stalled"
    case .cancel:
      guard state.step == .leaving, let leaving = state.leaving else { return state }
      next.step = returnStep(leaving.from)
      next.leaving = nil
      next.notice = nil
    case .tripFailed(let trip, let notice):
      guard state.step == .leaving, let leaving = state.leaving, leaving.trip == trip else { return state }
      next.step = returnStep(leaving.from)
      next.leaving = nil
      next.notice = notice
    case .other:
      return state
    }
    return next
  }

  // MARK: The words

  static func atHandle(_ value: String) -> String {
    value.units.hasPrefix("did:") ? value : "@\(value)"
  }

  /// A handle (or DID) nobody has. The field is marked, since it is what to fix.
  public static func notFoundNotice(_ value: String) -> SignInNotice {
    SignInNotice(
      about: "field",
      text: "Couldn’t find \(atHandle(value)). Check the spelling, or type the whole handle (it looks like you.bsky.social).")
  }

  /// The lookup couldn't be made. The handle may be fine, so the reader can go on with it.
  public static func lookupFailedNotice(_ value: String) -> SignInNotice {
    SignInNotice(about: "lookup", text: "Couldn’t look up \(atHandle(value)) just now.", anyway: value)
  }

  /// The name an account is shown by: its display name, else its handle, else its DID.
  public static func identityName(_ identity: SignInIdentityAnswer?) -> String {
    if let name = identity?.displayName, !name.isEmpty { return name }
    if let handle = identity?.handle, !handle.isEmpty { return "@\(handle)" }
    return identity?.did ?? ""
  }

  /// The line under the name: the handle when the name above is something
  /// else, else the DID.
  public static func identityMeta(_ identity: SignInIdentityAnswer?) -> String {
    let name = identity?.displayName ?? ""
    let handle = identity?.handle ?? ""
    if !name.isEmpty && !handle.isEmpty { return "@\(handle)" }
    if !handle.isEmpty || !name.isEmpty { return identity?.did ?? "" }
    return ""
  }

  public static func continueLabel(_ identity: SignInIdentityAnswer?) -> String {
    if let host = identity?.host, !host.isEmpty { return "Continue at \(host)" }
    return "Continue to your account’s host"
  }

  public static func leavingTitle(_ leaving: SignInLeaving?) -> String {
    if let host = leaving?.host, !host.isEmpty { return "Taking you to \(host)" }
    return "Taking you to your account’s host"
  }

  public static func leavingDetail(_ leaving: SignInLeaving?) -> String {
    leaving?.purpose == "signup"
      ? "Make your account on their page, and you’ll come straight back here, signed in."
      : "Approve Virga on their page, and you’ll come straight back here, signed in."
  }

  public static func stallLabel(_ leaving: SignInLeaving?) -> String {
    if let host = leaving?.host, !host.isEmpty { return "Open \(host)" }
    return "Try again"
  }

  /// `tripFailureNotice(error, leaving)`: what to say when the trip to a
  /// host couldn't start, or nil when there is nothing to say (the reader
  /// called it off, or came back). A new account's trip blames the host only
  /// for what is the host's doing.
  public static func tripFailureNotice(_ error: (any Error)?, _ leaving: SignInLeaving?) -> SignInNotice? {
    tripFailureNotice(JSErrorFields(error), leaving)
  }

  public static func tripFailureNotice(_ error: JSErrorFields?, _ leaving: SignInLeaving?) -> SignInNotice? {
    let message = (error?.message ?? "").units.map(Unit.asciiLower)
    if error?.code?.stringValue == "CANCELLED" || error?.name == "AbortError" || OAuthClient.has(message, "navigated back") {
      return nil
    }
    if leaving?.purpose == "signup" && !SignInHosts.notTheHosts(error) {
      let host = leaving?.host.flatMap { $0.isEmpty ? nil : $0 } ?? "That host"
      return SignInNotice(
        about: "trip", text: "\(host) isn’t taking sign-ups from here right now. Pick another host, or try again in a little while.")
    }
    return SignInNotice(about: "trip", text: OAuthClient.signInErrorMessage(error))
  }
}
