// Ports src/posting/lib/publish.js (the browser's File objects, as VirgaPosting's ComposerFiles)
//
// The composer's files on iOS: picked, pasted and prepared bytes are
// temporary files, and a file's `ref` is its path. Publishing reads them
// back (an image's upload, a video's, a card thumbnail's); a fetched card
// image, or a draft's media read back from the draft store, becomes a new
// temporary file.

#if canImport(UIKit)
import Foundation
import UniformTypeIdentifiers
import VirgaCore
import VirgaPosting

public struct TemporaryComposerFiles: ComposerFiles {
  public init() {}

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

  /// `data` as a new temporary file of `mime`, its ref the path.
  static func write(_ data: Data, mime: String, name: String, lastModified: Double? = nil) -> ComposerFile? {
    let ext = UTType(mimeType: mime)?.preferredFilenameExtension ?? "bin"
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("composer-\(UUID().uuidString).\(ext)")
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
