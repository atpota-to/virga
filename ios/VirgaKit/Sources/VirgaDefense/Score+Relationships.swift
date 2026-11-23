// Ports src/defense/score.js: publicRelationships.
//
// Who you follow and who follows you, for up to 30 accounts a call, from the
// public AppView. Needs no session: the question that matters most for the
// veto never depends on one. The one read score.js makes itself, and the
// default `getRelationships` of createScorer and runScan.

import Foundation
import VirgaCore
import VirgaNetwork

extension Score {
  /// `publicRelationships({ fetchImpl, appview })`: a GetRelationships that
  /// asks `appview` (config's APPVIEW) through atproto.js's
  /// fetchWithTimeout (its 15-second deadline) over `transport`. Throws
  /// DefenseFetchError "HTTP <status> from getRelationships" (with the
  /// status) for an answer that isn't ok, "getRelationships answered with
  /// no list" for one without a list, and the JSON parser's error for one
  /// that isn't JSON.
  public static func publicRelationships(
    appview: String = AppConfig.appview,
    transport: any HTTPTransport = HTTP.transport
  ) -> GetRelationships {
    { ownerDid, dids in
      let q = dids.map { "others=\(JSURI.encodeURIComponent($0))" }.joined(separator: "&")
      let url = "\(appview)/xrpc/app.bsky.graph.getRelationships?actor=\(JSURI.encodeURIComponent(ownerDid))&\(q)"
      let res = try await Atproto.fetchWithTimeout(
        HTTPRequest(url: url, headers: ["Accept": "application/json"]), transport: transport)
      if !res.ok {
        throw DefenseFetchError("HTTP \(res.status) from getRelationships", status: res.status)
      }
      guard let list = try res.json()["relationships"]?.arrayValue else {
        throw DefenseFetchError("getRelationships answered with no list")
      }
      return list
    }
  }
}
