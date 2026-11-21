// Ports src/archive/exports.js
//
// Downloads: the archive as JSON, the posts as CSV, any table as CSV. Each
// reads the archive already in memory, the same rows the charts draw. The
// web hands the text to the browser as a download (downloadText: a Blob, an
// anchor, a click); on iOS the functions return an ExportFile, and VirgaUI
// saves or shares it (fileExporter or ShareLink).

import Foundation
import VirgaCore

/// A file to hand the person: its text, its name and its media type.
public struct ExportFile: Codable, Hashable, Sendable {
  public var text: String
  public var filename: String
  public var type: String

  public init(text: String, filename: String, type: String) {
    self.text = text
    self.filename = filename
    self.type = type
  }

  /// The bytes to write (UTF-8, as the web's Blob encodes the text).
  public var data: Data { Data(text.utf8) }
}

public enum ArchiveExports {
  /// The handle for a file name, or the DID with its colons made safe
  /// (`/[^a-z0-9.-]+/gi` → '-').
  public static func fileStem(handle: String?, did: String?) -> String {
    let source = handle.flatMap { $0.isEmpty ? nil : $0 } ?? did.flatMap { $0.isEmpty ? nil : $0 } ?? "archive"
    var out: [UInt16] = []
    var inRun = false
    for unit in source.utf16 {
      let keep =
        (0x61...0x7A).contains(unit) || (0x41...0x5A).contains(unit) || (0x30...0x39).contains(unit) || unit == 0x2E
        || unit == 0x2D
      if keep {
        out.append(unit)
        inRun = false
      } else if !inRun {
        out.append(0x2D)
        inRun = true
      }
    }
    return String(jsUnits: out)
  }

  /// The whole archive as JSON.
  public static func exportArchive(
    _ archive: ArchiveData, did: String?, handle: String?, actors: [ActorCard], now: Double,
    timeZone: TimeZone = AppLocale.activeTimeZone()
  ) throws -> ExportFile {
    let json = try AnalyticsExport.archiveJson(archive, did: did, handle: handle, actors: actors, now: now)
    return downloadText(
      json, AnalyticsExport.exportFilename(fileStem(handle: handle, did: did), "analytics", "json", now: now, timeZone: timeZone),
      "application/json")
  }

  /// The posts (all of them, or the ones a page shows) as CSV.
  public static func exportPosts(
    _ archive: ArchiveData, did: String?, handle: String?, posts: [PostRow]? = nil, now: Double,
    timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> ExportFile {
    let csv = AnalyticsExport.postsCsv(posts ?? archive.posts, did: did, handle: handle, timeZone: timeZone)
    return downloadText(
      csv, AnalyticsExport.exportFilename(fileStem(handle: handle, did: did), "posts", "csv", now: now, timeZone: timeZone),
      "text/csv;charset=utf-8")
  }

  /// Any table as CSV: `rows` are arrays of cells, the first the header.
  /// A cell is written as `String(v)` (nil and null empty).
  public static func exportRows(
    did: String?, handle: String?, what: String, rows: [[JSONValue?]], now: Double,
    timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> ExportFile {
    func cell(_ v: JSONValue?) -> String {
      guard let v, !v.isNull else { return "" }
      return AnalyticsExport.csvCell(v.stringValue ?? v.jsString)
    }
    let csv = "\u{FEFF}\(rows.map { $0.map(cell).joined(separator: ",") }.joined(separator: "\r\n"))\r\n"
    return downloadText(
      csv, AnalyticsExport.exportFilename(fileStem(handle: handle, did: did), what, "csv", now: now, timeZone: timeZone),
      "text/csv;charset=utf-8")
  }

  /// The file the web hands the browser to download.
  public static func downloadText(_ text: String, _ filename: String, _ type: String) -> ExportFile {
    ExportFile(text: text, filename: filename, type: type)
  }
}
