// The bytes behind the composer's files: the web's File and Blob objects.
//
// A ComposerFile in a state is only `{ name, type, size, lastModified, ref }`;
// the bytes live wherever the app keeps them, named by `ref`. Publishing
// reads them (an image's upload, a video's, a card thumbnail's), a fetched
// card image becomes a new file (`new File([blob], 'thumbnail', { type })`),
// and a draft's media are kept in the draft media store and handed back as
// files. ComposerFiles is that File API: VirgaUI keeps files as temporary
// files (with `ref` their path), and a draft's kept media handed back
// become new ones (the store's `get`; a check that media are held reads
// only their entries); tests and the demo use InMemoryComposerFiles.
//
// No web module of its own: on the web these are the browser's File objects.

import Foundation
import VirgaCore

public protocol ComposerFiles: Sendable {
  /// `await file.arrayBuffer()`: the file's bytes. Throws when they are gone.
  func bytes(of file: ComposerFile) async throws -> Data
  /// `new File([data], name, { type, lastModified })`: a file holding `data`
  /// (`lastModified` nil is now).
  func makeFile(_ data: Data, name: String?, type: String, lastModified: Double?) async throws -> ComposerFile
  /// The file whose bytes the draft media store keeps at `path` in `store`,
  /// as IndexedDB hands back a stored File. The default reads them and makes
  /// a new file of them; the app's can name them where they lie instead.
  func storedFile(
    at path: String, in store: any FileStore, name: String?, type: String, size: Double, lastModified: Double?
  ) async throws -> ComposerFile?
}

extension ComposerFiles {
  public func storedFile(
    at path: String, in store: any FileStore, name: String?, type: String, size: Double, lastModified: Double?
  ) async throws -> ComposerFile? {
    guard let data = try await store.read(path) else { return nil }
    return try await makeFile(data, name: name, type: type, lastModified: lastModified)
  }
}

/// The bytes a file's `ref` names couldn't be found.
public struct ComposerFileGoneError: Error, LocalizedError, Hashable, Sendable {
  public var ref: String?
  public init(ref: String?) { self.ref = ref }
  public var errorDescription: String? { "The file’s contents are gone." }
}

/// Files in memory, for tests and the demo. A file made here is named
/// `memory:<n>`; a file with no `ref` (or one this store doesn't hold, when
/// `zeroFilled`) reads as `size` zero bytes, as the fixtures' files are.
public actor InMemoryComposerFiles: ComposerFiles {
  private var stored: [String: Data] = [:]
  private var made = 0
  private let now: @Sendable () -> Double
  private let zeroFilled: Bool

  public init(zeroFilled: Bool = true, now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
    self.zeroFilled = zeroFilled
    self.now = now
  }

  /// Keeps `data` under `ref`, for a file a test made itself.
  public func hold(_ data: Data, ref: String) {
    stored[ref] = data
  }

  /// Everything held, by ref.
  public var snapshot: [String: Data] { stored }

  public func bytes(of file: ComposerFile) async throws -> Data {
    if let ref = file.ref, let data = stored[ref] { return data }
    if zeroFilled { return Data(count: Int(Swift.max(0, file.size.isFinite ? file.size : 0))) }
    throw ComposerFileGoneError(ref: file.ref)
  }

  public func makeFile(_ data: Data, name: String?, type: String, lastModified: Double?) async throws -> ComposerFile {
    made += 1
    let ref = "memory:\(made)"
    stored[ref] = data
    return ComposerFile(name: name, type: type, size: Double(data.count), lastModified: lastModified ?? now(), ref: ref)
  }
}
