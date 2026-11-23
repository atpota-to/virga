// Ports src/posting/lib/publish.js (the browser's File objects, as VirgaPosting's ComposerFiles)
//
// The composer's files on iOS: picked, pasted and prepared bytes are
// temporary files, and a file's `ref` is its path. Publishing reads them
// back (an image's upload, a video's, a card thumbnail's); a fetched card
// image, or a draft's media read back from the draft store, becomes a new
// temporary file.
//
// They all live in one folder, tmp/composer, which its first use in a run
// empties: nothing kept from one run to the next names these files (the
// autosave keeps blobs and draft media refs, and a draft copies its media
// into the draft store), so whatever is there is left over. Within a run
// the composer deletes a file where the web revokes a preview: an
// original once it has been prepared, and what was removed, sent or
// cleared once no post on screen, kept or set aside still holds it.

#if canImport(UIKit)
import Foundation
import UniformTypeIdentifiers
import VirgaCore
import VirgaPosting

public struct TemporaryComposerFiles: ComposerFiles {
  public init() {}

  /// tmp/composer, emptied of the last run's files the first time it is
  /// asked for in this one.
  static let folder: URL = {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("composer", isDirectory: true)
    try? FileManager.default.removeItem(at: url)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }()

  /// Whether `ref` is a file in the composer's folder. Only those are ever
  /// deleted: a draft's stored media, or any other file, isn't the
  /// composer's to delete.
  static func isComposerFile(_ ref: String) -> Bool {
    URL(fileURLWithPath: ref).deletingLastPathComponent().path == folder.path
  }

  /// Deletes each of `refs` that is a file in the composer's folder.
  static func remove(_ refs: [String]) {
    for ref in refs where isComposerFile(ref) {
      try? FileManager.default.removeItem(atPath: ref)
    }
  }

  public func bytes(of file: ComposerFile) async throws -> Data {
    guard let ref = file.ref, let data = FileManager.default.contents(atPath: ref) else {
      throw ComposerFileGoneError(ref: file.ref)
    }
    return data
  }

  public func makeFile(_ data: Data, name: String?, type: String, lastModified: Double?) async throws -> ComposerFile {
    guard let file = Self.write(data, mime: type, name: name ?? "file", lastModified: lastModified) else {
      throw ComposerFileGoneError(ref: nil)
    }
    return file
  }

  /// `data` as a new file of `mime` in the composer's folder, its ref the path.
  static func write(_ data: Data, mime: String, name: String, lastModified: Double? = nil) -> ComposerFile? {
    let ext = UTType(mimeType: mime)?.preferredFilenameExtension ?? "bin"
    let url = folder.appendingPathComponent("composer-\(UUID().uuidString).\(ext)")
    do {
      try data.write(to: url)
    } catch {
      return nil
    }
    let fileName = name.contains(".") ? name : "\(name).\(ext)"
    return ComposerFile(
      name: fileName, type: mime, size: Double(data.count),
      lastModified: lastModified ?? Date().timeIntervalSince1970 * 1000, ref: url.path)
  }
}
#endif
