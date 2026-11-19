// The web app's IndexedDB stores, as a protocol: larger data (an account's
// archive, a draft's media) as bytes at relative paths, read and written
// asynchronously. Ports lay out their data as paths
// (`analytics/<did>/posts.json`, `posting/<did>/media/<ref>`), and logic
// never touches the file system directly (PORTING.md): the app passes
// `DiskFileStore`, tests and the demo `InMemoryFileStore`.
//
// A path is relative: segments separated by "/", none empty, "." or "..",
// so nothing can reach outside the store. A path that breaks the rule
// throws `FileStoreError.invalidPath`.

import Foundation

public protocol FileStore: Sendable {
  /// The bytes at `path`, or nil when there is nothing there.
  func read(_ path: String) async throws -> Data?
  /// Writes `data` at `path`, replacing what was there, all at once: a
  /// reader sees the old bytes or the new, never half of either.
  func write(_ data: Data, to path: String) async throws
  /// Removes `path`: a file, or a directory with everything under it.
  /// Removing nothing is not an error.
  func delete(_ path: String) async throws
  /// Every file under `directory` ("" for the whole store), as paths
  /// relative to the store, sorted.
  func list(_ directory: String) async throws -> [String]
}

public enum FileStoreError: Error, Equatable, LocalizedError {
  case invalidPath(String)

  public var errorDescription: String? {
    switch self {
    case .invalidPath(let path): return "Not a path inside the store: \(path)"
    }
  }
}

extension FileStore {
  /// Whether anything is stored at `path`.
  public func exists(_ path: String) async throws -> Bool {
    try await read(path) != nil
  }

  /// The JSON at `path` decoded as `T`, or nil when there is none.
  public func readJSON<T: Decodable>(_ path: String, as type: T.Type) async throws -> T? {
    guard let data = try await read(path) else { return nil }
    return try JSONDecoder().decode(T.self, from: data)
  }

  /// Writes `value` as JSON at `path`.
  public func writeJSON<T: Encodable>(_ value: T, to path: String) async throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes, .sortedKeys]
    try await write(try encoder.encode(value), to: path)
  }
}

/// The checks every store applies to a path: relative, "/"-separated, no
/// empty, "." or ".." segment. Returns the segments.
public enum FileStorePath {
  public static func segments(_ path: String, allowRoot: Bool = false) throws -> [String] {
    if path.isEmpty {
      if allowRoot { return [] }
      throw FileStoreError.invalidPath(path)
    }
    let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    for part in parts where part.isEmpty || part == "." || part == ".." || part.contains("\0") || part.contains("\\") {
      throw FileStoreError.invalidPath(path)
    }
    return parts
  }

  /// The path made canonical (it is already, once it passes the checks).
  public static func normalize(_ path: String, allowRoot: Bool = false) throws -> String {
    try segments(path, allowRoot: allowRoot).joined(separator: "/")
  }
}

/// A store in memory: the tests' and the demo's.
public actor InMemoryFileStore: FileStore {
  private var files: [String: Data]

  public init(_ files: [String: Data] = [:]) {
    self.files = files
  }

  /// Everything held, for assertions.
  public var snapshot: [String: Data] { files }

  public func read(_ path: String) async throws -> Data? {
    files[try FileStorePath.normalize(path)]
  }

  public func write(_ data: Data, to path: String) async throws {
    let key = try FileStorePath.normalize(path)
    // A file can't sit where a directory is, or under a file.
    let parts = key.split(separator: "/")
    for end in parts.indices.dropLast() where files[parts[...end].joined(separator: "/")] != nil {
      throw FileStoreError.invalidPath(path)
    }
    if files.keys.contains(where: { $0.hasPrefix(key + "/") }) { throw FileStoreError.invalidPath(path) }
    files[key] = data
  }

  public func delete(_ path: String) async throws {
    let key = try FileStorePath.normalize(path)
    files.removeValue(forKey: key)
    for name in files.keys where name.hasPrefix(key + "/") { files.removeValue(forKey: name) }
  }

  public func list(_ directory: String) async throws -> [String] {
    let key = try FileStorePath.normalize(directory, allowRoot: true)
    let prefix = key.isEmpty ? "" : key + "/"
    return files.keys.filter { $0.hasPrefix(prefix) }.sorted()
  }
}

/// The app's store: files under a base directory (Application Support in
/// the app), written atomically (to a temporary file, then moved into
/// place), with directories made as needed.
public struct DiskFileStore: FileStore {
  public let baseURL: URL

  public init(baseURL: URL) {
    self.baseURL = baseURL.standardizedFileURL
  }

  func url(_ path: String, allowRoot: Bool = false) throws -> URL {
    var url = baseURL
    for segment in try FileStorePath.segments(path, allowRoot: allowRoot) {
      url.appendPathComponent(segment, isDirectory: false)
    }
    return url
  }

  public func read(_ path: String) async throws -> Data? {
    let file = try url(path)
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
      return nil
    }
    return try Data(contentsOf: file)
  }

  public func write(_ data: Data, to path: String) async throws {
    let file = try url(path)
    try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: file, options: .atomic)
  }

  public func delete(_ path: String) async throws {
    let file = try url(path)
    guard FileManager.default.fileExists(atPath: file.path) else { return }
    try FileManager.default.removeItem(at: file)
  }

  public func list(_ directory: String) async throws -> [String] {
    let root = try url(directory, allowRoot: true)
    // Resolved, so /var and /private/var (macOS's temporary directories) agree.
    let rootPath = baseURL.resolvingSymlinksInPath().path
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: root.path, isDirectory: &isDirectory), isDirectory.boolValue else {
      return []
    }
    guard let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey]) else {
      return []
    }
    var out: [String] = []
    for case let file as URL in walker {
      let values = try file.resourceValues(forKeys: [.isRegularFileKey])
      guard values.isRegularFile == true else { continue }
      let full = file.resolvingSymlinksInPath().path
      guard full.hasPrefix(rootPath + "/") else { continue }
      out.append(String(full.dropFirst(rootPath.count + 1)))
    }
    return out.sorted()
  }
}
