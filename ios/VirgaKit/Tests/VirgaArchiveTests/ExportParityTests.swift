// Parity with src/lib/analyticsExport.js and src/archive/exports.js
// (fixture archive.exports): the JSON document and the order of its own
// members, the CSV byte for byte, the file names by local day, and what
// each download hands over.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaRepo
import VirgaTestSupport
@testable import VirgaArchive

/// The archive a case describes.
func archiveData(_ value: JSONValue?) -> ArchiveData {
  let v = value ?? .object([:])
  return ArchiveData(
    loaded: v["loaded"]?.boolValue ?? false,
    posts: rows(v["posts"]) ?? [], followers: rows(v["followers"]) ?? [], following: rows(v["following"]) ?? [],
    blocks: rows(v["blocks"]) ?? [], inbound: rows(v["inbound"]) ?? [], outbound: rows(v["outbound"]) ?? [],
    atmosphere: (v["atmosphere"]?.arrayValue ?? []).compactMap(AtmosphereRow.init(json:)),
    meta: ArchiveMeta(json: v["meta"]), rev: v["rev"]?.intValue ?? 0)
}

/// A JSON document as its value and the order of its own members.
private func document(_ text: String) throws -> JSONValue {
  let ordered = try OrderedJSON.parse(text)
  return ["document": try JSONValue.parse(text), "keys": .array(ordered.entries.map { .string($0.0) })]
}

private func file(_ file: ExportFile, json: Bool = false) throws -> JSONValue {
  ["text": json ? try document(file.text) : .string(file.text), "filename": .string(file.filename), "type": .string(file.type)]
}

@Suite struct ExportParity {
  @Test func constants() throws {
    try forEachCase("archive.exports", "constants") { _ in
      ["EXPORT_FORMAT": .string(AnalyticsExport.exportFormat), "EXPORT_VERSION": .number(Double(AnalyticsExport.exportVersion))]
    }
  }

  @Test func archiveJson() throws {
    try forEachCase("archive.exports", "archiveJson") { c in
      let actors: [ActorCard] = rows(c["actors"]) ?? []
      let text = try AnalyticsExport.archiveJson(
        archiveData(c.input["archive"]), did: c["did"].stringValue, handle: c["handle"].stringValue, actors: actors,
        now: c.number("now"))
      return try document(text)
    }
  }

  @Test func postsCsv() throws {
    try forEachCase("archive.exports", "postsCsv") { c in
      let posts: [PostRow]? = c["posts"].arrayValue?.compactMap { PostRow(json: $0) }
      return .string(AnalyticsExport.postsCsv(posts, did: c["did"].stringValue, handle: c["handle"].stringValue, timeZone: c.zone))
    }
  }

  @Test func exportFilename() throws {
    try forEachCase("archive.exports", "exportFilename") { c in
      .string(
        AnalyticsExport.exportFilename(
          c["handle"].stringValue, c["what"].stringValue ?? "", c["ext"].stringValue ?? "", now: c.number("now"), timeZone: c.zone))
    }
  }

  private static let fixtureArchive: ArchiveData = {
    // The generator's ARCHIVE is the archiveJson 'whole' case's input.
    let c = try? Parity.cases("archive.exports", fn: "archiveJson").first { $0.id == "whole" }
    return archiveData(c?.input["archive"])
  }()

  private static let fixtureActors: [ActorCard] = {
    let c = try? Parity.cases("archive.exports", fn: "archiveJson").first { $0.id == "whole" }
    return rows(c?.input["actors"]) ?? []
  }()

  @Test func exportArchive() throws {
    try forEachCase("archive.exports", "exportArchive") { c in
      try file(
        try ArchiveExports.exportArchive(
          Self.fixtureArchive, did: c["did"].stringValue, handle: c["handle"].stringValue, actors: Self.fixtureActors,
          now: c.number("now"), timeZone: c.zone),
        json: true)
    }
  }

  @Test func exportPosts() throws {
    let all = try Parity.cases("archive.exports", fn: "postsCsv").first { $0.id == "all" }
    let posts: [PostRow] = rows(all?.input["posts"]) ?? []
    try forEachCase("archive.exports", "exportPosts") { c in
      try file(
        ArchiveExports.exportPosts(
          Self.fixtureArchive, did: c["did"].stringValue, handle: c["handle"].stringValue,
          posts: c["some"].boolValue == true ? Array(posts.dropFirst(3)) : nil, now: c.number("now"), timeZone: c.zone))
    }
  }

  @Test func exportRows() throws {
    try forEachCase("archive.exports", "exportRows") { c in
      let table = (c["rows"].arrayValue ?? []).map { ($0.arrayValue ?? []).map { Optional($0) } }
      return try file(
        ArchiveExports.exportRows(
          did: c["did"].stringValue, handle: c["handle"].stringValue, what: c["what"].stringValue ?? "", rows: table,
          now: c.number("now"), timeZone: c.zone))
    }
  }

  @Test func anExportReadsBackIntoTheSameArchive() throws {
    let text = try AnalyticsExport.archiveJson(Self.fixtureArchive, did: "did:plc:owner", handle: nil, actors: [], now: 0)
    let doc = try JSONValue.parse(text)
    let back = archiveData(doc)
    #expect(back.posts == Self.fixtureArchive.posts)
    #expect(back.blocks == Self.fixtureArchive.blocks)
    #expect(back.atmosphere == Self.fixtureArchive.atmosphere)
    #expect(back.meta == Self.fixtureArchive.meta)
  }
}
