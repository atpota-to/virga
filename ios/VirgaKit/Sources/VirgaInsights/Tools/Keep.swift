// Ports src/tools/keep.js
//
// A per-account set of DIDs a tool should leave alone ("Keep, don't
// suggest"), kept in the key-value store under the web's key and in the
// web's JSON (an array of DIDs, in the order they were added). Only ever
// changes what a page suggests.
//
// The web's useKeepList hook is KeepListModel: a view makes one for its
// account and tool (as FollowCleanup and FollowBack do with "cleanup" and
// "followback") and binds to it. A new account is a new model, as a page
// mounted for another account is a new hook.
// ios/parity/cases/insights-early.keep.js runs the hook itself through each
// sequence of changes, and KeepModelParity holds the model to it.

import Foundation
import Observation
import VirgaCore

public enum Keep {
  /// Where an account's kept list for one tool is stored.
  public static func keepKey(_ did: String, _ name: String) -> String {
    "virga:keep:\(name):\(did)"
  }

  /// The stored list: its strings, each once, in order; none when there is
  /// no store, nothing stored, or what is stored isn't a JSON array.
  public static func read(_ key: String, store: KeyValueStore?) -> [String] {
    let text = store?.getItem(key) ?? ""
    guard case .array(let list)? = try? JSONValue.parse(text.isEmpty ? "[]" : text) else { return [] }
    var seen = Set<String>()
    return list.compactMap { item in
      guard case .string(let did) = item, seen.insert(did).inserted else { return nil }
      return did
    }
  }

  /// `JSON.stringify(dids)`, byte for byte.
  public static func serialize(_ dids: [String]) -> String {
    "[" + dids.map(\.jsJSONQuoted).joined(separator: ",") + "]"
  }
}

/// The web's useKeepList(did, name): the DIDs one tool leaves alone for one
/// account. Each change is written through at once; if the store refuses
/// it, the change holds for as long as the model lives ("for this visit
/// only"), as on the web.
@MainActor
@Observable
public final class KeepListModel {
  public let did: String
  public let name: String
  /// The kept DIDs, in the order they were added (the stored order).
  public private(set) var dids: [String]
  private var members: Set<String>

  @ObservationIgnored private let store: KeyValueStore?

  /// - Parameters:
  ///   - did: the account's.
  ///   - name: the tool's ("cleanup", "followback").
  ///   - store: the app's key-value store; nil keeps the list in memory only.
  public init(did: String, name: String, store: KeyValueStore?) {
    self.did = did
    self.name = name
    self.store = store
    let dids = Keep.read(Keep.keepKey(did, name), store: store)
    self.dids = dids
    self.members = Set(dids)
  }

  /// Where the list is stored.
  public var key: String { Keep.keepKey(did, name) }

  public func has(_ did: String) -> Bool { members.contains(did) }

  public var size: Int { dids.count }

  /// Keep these too (each once; those already kept stay where they are).
  public func add(_ more: [String]) {
    var next = dids
    var seen = members
    for did in more where seen.insert(did).inserted { next.append(did) }
    save(next)
  }

  /// Stop keeping these.
  public func remove(_ these: [String]) {
    let drop = Set(these)
    save(dids.filter { !drop.contains($0) })
  }

  /// Keep none.
  public func clear() {
    save([])
  }

  private func save(_ next: [String]) {
    dids = next
    members = Set(next)
    do {
      try store?.setItem(key, Keep.serialize(next))
    } catch {
      // Kept for this visit only.
    }
  }
}
