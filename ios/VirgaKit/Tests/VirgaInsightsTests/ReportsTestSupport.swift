// The archives the report fixtures run over (ios/parity/cases/_reports.js,
// written once to insights.archives), read back into ReportArchives, and
// the formats, periods and outputs of a case.

import Foundation
import Testing
import VirgaArchive
import VirgaCore
import VirgaRepo
import VirgaTestSupport
@testable import VirgaInsights

enum ReportFixtures {
  /// Each archive's JSON, by name: insights.archives', and those a fixture
  /// holds of its own (insights.interaction's).
  static let archives: [String: JSONValue] = {
    var out: [String: JSONValue] = [:]
    for fixture in ["insights.archives", "insights.interaction"] {
      for c in (try? Parity.cases(fixture, fn: "archive")) ?? [] {
        guard let text = c.output.stringValue, let json = try? JSONValue.parse(text) else { continue }
        out[c.id] = json
      }
    }
    return out
  }()

  /// The rows and meta an archive's JSON holds, as the archive model holds them.
  static func data(_ json: JSONValue, rev: Int = 0, followRev: Int = 0) -> ArchiveData {
    func rows<T>(_ key: String, _ make: (JSONValue) -> T?) -> [T] {
      (json[key]?.arrayValue ?? []).compactMap(make)
    }
    return ArchiveData(
      loaded: true,
      posts: rows("posts", PostRow.init(json:)),
      followers: rows("followers", FollowerRow.init(json:)),
      following: rows("following", FollowingRow.init(json:)),
      blocks: rows("blocks", BlockRow.init(json:)),
      inbound: rows("inbound", EngagementEvent.init(json:)),
      outbound: rows("outbound", EngagementEvent.init(json:)),
      atmosphere: rows("atmosphere", AtmosphereRow.init(json:)),
      meta: ArchiveMeta(json: json["meta"]),
      rev: rev,
      followRev: followRev)
  }

  /// The archive a case names, with the case's revision and now.
  static func archive(_ c: ParityCase) -> ReportArchive? {
    guard let name = c["archive"].stringValue, let json = archives[name] else {
      Issue.record("\(c): no archive \(c["archive"])")
      return nil
    }
    return ReportArchive(
      did: json["did"]?.stringValue ?? "", handle: json["handle"]?.stringValue, nowMs: c["nowMs"].doubleValue,
      data: data(json, rev: c["rev"].intValue ?? 0, followRev: c["followRev"].intValue ?? 0))
  }
}

extension ParityCase {
  /// The case's zone (`zone`), UTC by default.
  var zone: TimeZone {
    self["zone"].stringValue.flatMap(TimeZone.init(identifier:)) ?? TimeZone(identifier: "UTC")!
  }

  /// The formats the case ran in: its zone, locale (en-US) and week start (Monday).
  var formats: ReportFormats {
    ReportFormats(
      locale: self["locale"].stringValue ?? "en-US", weekStart: self["weekStart"].intValue ?? 1, timeZone: zone)
  }

  /// The case's period.
  var period: AnalyticsPeriod? {
    try? self["period"].decode(AnalyticsPeriod.self)
  }

  /// An option of the case (`options[key]`).
  func option(_ key: String) -> JSONValue? {
    input["options"]?[key]
  }

  /// A unit option, nil for none or one that isn't a unit.
  func unitOption(_ key: String) -> AnalyticsUnit? {
    option(key)?.stringValue.flatMap(AnalyticsUnit.init(rawValue:))
  }

  /// The output, which a report case holds as its JSON text.
  var compactOutput: JSONValue {
    guard let text = output.stringValue else { return output }
    return (try? JSONValue.parse(text)) ?? .string(text)
  }
}

/// A value as the fixture writer records it, deeply: NaN and ±Infinity as null.
func recorded(_ value: JSONValue) -> JSONValue {
  switch value {
  case .number(let n): return n.isFinite ? .number(n == 0 ? 0 : n) : .null
  case .array(let items): return .array(items.map(recorded))
  case .object(let members): return .object(members.mapValues(recorded))
  default: return value
  }
}

/// Expects a report result to be the case's (its JSON text).
func expectReport(_ actual: JSONValue, _ c: ParityCase, sourceLocation: SourceLocation = #_sourceLocation) {
  let d = exactDiff(recorded(actual), c.compactOutput)
  #expect(d == nil, "\(c): \(d ?? "")", sourceLocation: sourceLocation)
}
