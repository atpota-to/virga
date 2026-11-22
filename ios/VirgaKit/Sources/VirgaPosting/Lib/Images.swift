// Ports src/posting/lib/images.js
//
// Images for posts: every image is re-encoded before it is attached, which
// shrinks it to what the PDS accepts and drops its EXIF data (camera, time
// and often the place it was taken). When re-encoding fails the image is
// refused, never uploaded as it was, because the original would carry
// that data out.
//
// The decisions are here: the budgets, which options the re-encode gets,
// when a result is refused, the new name and type, the aspect ratio. The
// pixel work is an ImageEncoder the app supplies (VirgaUI's, over ImageIO;
// the web's browser-image-compression and createImageBitmap), so this
// runs and is tested on Linux with a fake.

import Foundation
import VirgaCore
import VirgaNetwork

/// What a post image (or a card thumbnail) is brought under.
public struct ImageBudget: Codable, Hashable, Sendable {
  public var maxSizeMB: Double
  public var maxDimension: Int

  public init(maxSizeMB: Double, maxDimension: Int) {
    self.maxSizeMB = maxSizeMB
    self.maxDimension = maxDimension
  }
}

/// What the re-encode is asked for: browser-image-compression's options,
/// by their names.
public struct ImageCompressOptions: Codable, Hashable, Sendable {
  /// The most the output may weigh, in MiB (1,048,576 bytes).
  public var maxSizeMB: Double
  /// The longest side the output may have, in pixels.
  public var maxWidthOrHeight: Int
  /// The web's worker thread; an encoder on iOS works off the main actor anyway.
  public var useWebWorker: Bool
  /// Always 'image/jpeg'.
  public var fileType: String
  /// The quality to start from, 0 to 1 (lowered while the output is over `maxSizeMB`).
  public var initialQuality: Double
  /// Keep the pixel size, and meet `maxSizeMB` by quality alone.
  public var alwaysKeepResolution: Bool
  /// Always false: the metadata is what re-encoding drops.
  public var preserveExif: Bool
}

/// An image's pixel size.
public struct ImageSize: Codable, Hashable, Sendable {
  public var width: Double
  public var height: Double

  public init(width: Double, height: Double) {
    self.width = width
    self.height = height
  }
}

/// The pixel work prepareImage needs. VirgaUI's encoder reads `file.ref`'s
/// bytes and writes the output somewhere it can hand back as a new
/// ComposerFile (its `size` the output's byte count).
public protocol ImageEncoder: Sendable {
  /// Re-encode `file` as `options` say, without its metadata: the output
  /// file, or nil for nothing.
  func compress(_ file: ComposerFile, _ options: ImageCompressOptions) async throws -> ComposerFile?
  /// The pixel size from decoding `file`, or nil when it can't be decoded.
  func decodeSize(_ file: ComposerFile) async throws -> ImageSize?
}

/// A prepared image: `{ file, mime, size, aspectRatio? }`.
public struct PreparedImage: Codable, Hashable, Sendable {
  public var file: ComposerFile
  public var mime: String
  public var size: Double
  public var aspectRatio: ImageSize?
}

/// An image that couldn't be made safe to post.
public struct ImageProcessingError: Error, LocalizedError, Sendable {
  public let name = "ImageProcessingError"
  public var message: String
  /// 'NOT_AN_IMAGE' | 'IMAGE_PROCESSING_FAILED' | 'IMAGE_TOO_LARGE'.
  public var code: String
  public var causeMessage: String?

  public init(_ message: String, code: String = "IMAGE_PROCESSING_FAILED", cause: (any Error)? = nil) {
    self.message = message
    self.code = code
    causeMessage = cause.map(jsMessage)
  }

  public var errorDescription: String? { message }
}

public enum Images {
  /// Up to four images per post (`app.bsky.embed.images`).
  public static let maxImages = 4

  /// What a post image is brought under: the lexicon allows 2,000,000 bytes.
  public static let imageBudget = ImageBudget(maxSizeMB: 1.9, maxDimension: 4000)

  /// A link card's thumbnail: the lexicon allows 1,000,000 bytes.
  public static let cardThumbBudget = ImageBudget(maxSizeMB: 0.95, maxDimension: 1920)

  public static let imageMimeTypes = [
    "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "image/avif",
  ]

  public static let compressTimeoutMs: Double = 30_000
  static let mb: Double = 1024 * 1024

  /// Whether a file is something the image pipeline takes.
  public static func isImageFile(_ file: JSONValue?) -> Bool {
    file?["type"]?.stringValue.map { PostingJS.hasPrefix($0, "image/") } ?? false
  }

  public static func isImageFile(_ file: ComposerFile?) -> Bool { isImageFile(file?.json) }

  /// The re-encode's options for a file of `size` bytes: a small image
  /// keeps its resolution and quality (re-encoded only to drop the
  /// metadata); a large one is shrunk to the budget.
  public static func compressOptions(size: Double, budget: ImageBudget) -> ImageCompressOptions {
    let over = size > budget.maxSizeMB * mb
    return ImageCompressOptions(
      maxSizeMB: over ? budget.maxSizeMB : Swift.max(size / mb, 0.01),
      maxWidthOrHeight: budget.maxDimension,
      useWebWorker: true,
      fileType: "image/jpeg",
      initialQuality: over ? 0.8 : 1.0,
      alwaysKeepResolution: !over,
      preserveExif: false)
  }

  /// `String(name || 'image').replace(/\.[^.]+$/, '') + '.jpg'`.
  public static func jpegName(_ name: String?) -> String {
    let text = (name ?? "").isEmpty ? "image" : name!
    let units = Array(text.utf16)
    if let dot = units.lastIndex(of: 0x2E), dot < units.count - 1, !units[(dot + 1)...].contains(0x2E) {
      return String(decoding: units[..<dot], as: UTF16.self) + ".jpg"
    }
    return text + ".jpg"
  }

  /// The timeout's own failure.
  struct TimedOut: Error, LocalizedError {
    var errorDescription: String? { "Image processing timed out" }
  }

  /// `compress` unless `timeoutMs` passes first (`sleep` waits; it returns
  /// early only when cancelled).
  static func withTimeout<T: Sendable>(
    _ timeoutMs: Double, sleep: @escaping @Sendable (Double) async -> Void,
    _ work: @escaping @Sendable () async throws -> T
  ) async throws -> T {
    try await withThrowingTaskGroup(of: T?.self) { group in
      group.addTask { try await work() }
      group.addTask {
        await sleep(timeoutMs)
        if Task.isCancelled { throw CancellationError() }
        return nil
      }
      defer { group.cancelAll() }
      guard let first = try await group.next(), let value = first else { throw TimedOut() }
      return value
    }
  }

  /// Re-encode an image to JPEG within `budget`, without its metadata, and
  /// read its real size. Throws ImageProcessingError.
  public static func prepareImage(
    _ file: ComposerFile,
    budget: ImageBudget = imageBudget,
    encoder: any ImageEncoder,
    timeoutMs: Double = compressTimeoutMs,
    sleep: @escaping @Sendable (Double) async -> Void = { ms in
      try? await Task.sleep(nanoseconds: UInt64(Swift.max(0, ms) * 1_000_000))
    }
  ) async throws -> PreparedImage {
    guard isImageFile(file) else {
      throw ImageProcessingError("That file isn’t an image.", code: "NOT_AN_IMAGE")
    }
    let options = compressOptions(size: file.size, budget: budget)
    let output: ComposerFile?
    do {
      output = try await withTimeout(timeoutMs, sleep: sleep) { try await encoder.compress(file, options) }
    } catch {
      throw ImageProcessingError(
        "This image couldn’t be prepared for posting, so it wasn’t added. Try saving it as a JPEG or PNG first.",
        cause: error)
    }
    guard let output, output.size != 0, !output.size.isNaN else {
      throw ImageProcessingError("This image couldn’t be prepared for posting, so it wasn’t added.")
    }
    if output.size > budget.maxSizeMB * mb {
      throw ImageProcessingError(
        "This image is still too large after shrinking it, so it wasn’t added.", code: "IMAGE_TOO_LARGE")
    }
    var processed = output
    processed.name = jpegName(file.name)
    processed.type = "image/jpeg"
    let size = (try? await encoder.decodeSize(processed)) ?? nil
    var result = PreparedImage(file: processed, mime: "image/jpeg", size: processed.size, aspectRatio: nil)
    if let size, size.width > 0, size.height > 0 {
      result.aspectRatio = ImageSize(width: size.width.jsRounded, height: size.height.jsRounded)
    }
    return result
  }

  /// Upload a prepared image's bytes as the write account.
  public static func uploadImage(agent: XRPCAgent, image: PreparedImage, data: Data, timeoutMs: Double? = nil)
    async throws -> BlobRef
  {
    let encoding = image.mime.isEmpty ? (image.file.type.isEmpty ? "image/jpeg" : image.file.type) : image.mime
    return try await Blobs.uploadBlob(agent: agent, data: data, encoding: encoding, timeoutMs: timeoutMs)
  }
}
