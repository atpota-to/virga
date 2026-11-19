// Ports src/defense/historyModel.js
//
// The History page's words, apart from the view: what each decision came
// to, and what an approval came to in all.

import Foundation
import VirgaCore

/// A decision as `GET /api/defense/history` gives it (server/defense/
/// handlers/history.js `publicDecision`): an add or a removal of one
/// account on one list, and what became of it. `action` is "add" or
/// "remove"; `state` is "queued", "sent", "done", "already", "vetoed",
/// "failed" or "cancelled".
public struct DefenseDecision: Codable, Hashable, Sendable {
  public var id: Int
  public var listId: String?
  public var planId: String?
  public var did: String?
  public var action: String
  public var band: Band?
  public var trust: Int?
  public var via: String?
  public var note: String?
  public var state: String
  public var reason: String?
  public var createdAt: String?
  public var actedAt: String?
  public var undoneAt: String?
  public var undoes: Int?

  public init(
    id: Int,
    listId: String? = nil,
    planId: String? = nil,
    did: String? = nil,
    action: String,
    band: Band? = nil,
    trust: Int? = nil,
    via: String? = nil,
    note: String? = nil,
    state: String,
    reason: String? = nil,
    createdAt: String? = nil,
    actedAt: String? = nil,
    undoneAt: String? = nil,
    undoes: Int? = nil
  ) {
    self.id = id
    self.listId = listId
    self.planId = planId
    self.did = did
    self.action = action
    self.band = band
    self.trust = trust
    self.via = via
    self.note = note
    self.state = state
    self.reason = reason
    self.createdAt = createdAt
    self.actedAt = actedAt
    self.undoneAt = undoneAt
    self.undoes = undoes
  }
}

/// The server's counts for one approval's adds. `live` is how many an undo
/// would take back.
public struct PlanCounts: Codable, Hashable, Sendable {
  public var added: Int?
  public var waiting: Int?
  public var kept: Int?
  public var failed: Int?
  public var undone: Int?
  public var live: Int?

  public init(added: Int? = nil, waiting: Int? = nil, kept: Int? = nil, failed: Int? = nil, undone: Int? = nil, live: Int? = nil) {
    self.added = added
    self.waiting = waiting
    self.kept = kept
    self.failed = failed
    self.undone = undone
    self.live = live
  }
}

/// An approval as the History page reads it (history.js's `plans`).
public struct DefensePlan: Codable, Hashable, Sendable {
  public var id: String?
  public var listId: String?
  public var postUri: String?
  public var createdAt: String?
  public var approvedAt: String?
  public var bands: [Band]?
  public var note: String?
  public var totals: JSONValue?
  public var counts: PlanCounts?

  public init(
    id: String? = nil,
    listId: String? = nil,
    postUri: String? = nil,
    createdAt: String? = nil,
    approvedAt: String? = nil,
    bands: [Band]? = nil,
    note: String? = nil,
    totals: JSONValue? = nil,
    counts: PlanCounts? = nil
  ) {
    self.id = id
    self.listId = listId
    self.postUri = postUri
    self.createdAt = createdAt
    self.approvedAt = approvedAt
    self.bands = bands
    self.note = note
    self.totals = totals
    self.counts = counts
  }
}

/// What an approval came to, and the line that says so.
public struct PlanOutcome: Codable, Hashable, Sendable {
  public var added: Int
  public var waiting: Int
  public var kept: Int
  public var failed: Int
  public var undone: Int
  public var live: Int
  public var line: String
}

public enum HistoryModel {
  /// A decision in a few words: "Added", "Waiting to be added", "Kept off:
  /// you follow them".
  public static func decisionPhrase(_ d: DefenseDecision) -> String {
    let reason = d.reason.flatMap { $0.isEmpty ? nil : $0 }
    let undone = !(d.undoneAt ?? "").isEmpty
    if d.action == "remove" {
      if d.state == "done" { return "Taken off" }
      if d.state == "already" { return "Taken off (already gone)" }
      if d.state == "failed" { return "Couldn’t take off: \(reason ?? "the PDS refused")" }
      return "Waiting to be taken off"
    }
    if undone && d.state == "cancelled" { return "Undone before it was written" }
    if undone { return "Added, then taken off" }
    switch d.state {
    case "done": return "Added"
    case "already": return "Was on the list already"
    case "vetoed": return "Kept off: \(reason ?? "protected")"
    case "failed": return "Couldn’t add: \(reason ?? "the PDS refused")"
    case "cancelled": return "Cancelled"
    default: return "Waiting to be added"
    }
  }

  /// What an approval came to, from the counts the server keeps for it.
  /// Numbers are written in `locale` (nil: the active one, as the web's fmtInt).
  public static func planOutcome(_ plan: DefensePlan?, locale: String? = nil) -> PlanOutcome {
    let c = plan?.counts ?? PlanCounts()
    let added = c.added ?? 0
    let waiting = c.waiting ?? 0
    let kept = c.kept ?? 0
    let failed = c.failed ?? 0
    let undone = c.undone ?? 0
    func n(_ value: Int) -> String { DefenseFormat.fmtInt(Double(value), locale: locale) }
    let parts = [
      added != 0 ? "\(n(added)) added" : nil,
      waiting != 0 ? "\(n(waiting)) waiting" : nil,
      kept != 0 ? "\(n(kept)) kept off by the veto" : nil,
      failed != 0 ? "\(n(failed)) couldn’t be added" : nil,
      undone != 0 ? "\(n(undone)) undone" : nil,
    ].compactMap { $0 }
    return PlanOutcome(
      added: added, waiting: waiting, kept: kept, failed: failed, undone: undone, live: c.live ?? 0,
      line: parts.isEmpty ? "Nothing to add" : parts.joined(separator: " · "))
  }
}
