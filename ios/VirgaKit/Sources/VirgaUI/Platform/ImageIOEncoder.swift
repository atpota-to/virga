// Ports src/posting/lib/images.js (the encoder: browser-image-compression's part)
//
// VirgaPosting's ImageEncoder over ImageIO: a composer file's bytes are at
// its `ref` (a file path). Decoding reads the pixel size, turned upright by
// its orientation. Compressing walks browser-image-compression's loop
// (Images.compress): the image drawn upright at most `maxWidthOrHeight` on
// its longer side, written as `fileType` (JPEG where ImageIO can't write
// the type asked, as WebP) at `initialQuality`, then up to ten more tries
// at 0.95 the quality, smaller by 0.95 only when it was over `maxSizeMB`
// and `alwaysKeepResolution` is off; the last try is the answer, and
// prepareImage refuses it if it is still over. Nothing of the original's
// metadata is copied, so no EXIF (and no location) goes out. The output is
// a new temporary file, its ref the path.

#if canImport(UIKit)
import Foundation
import ImageIO
import UniformTypeIdentifiers
import VirgaPosting

public struct ImageIOEncoder: ImageEncoder {
  public init() {}

  public func decodeSize(_ file: ComposerFile) async throws -> ImageSize? {
    guard let source = Self.source(file),
      let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let w = props[kCGImagePropertyPixelWidth] as? Double, let h = props[kCGImagePropertyPixelHeight] as? Double
    else { return nil }
    let orientation = props[kCGImagePropertyOrientation] as? Int ?? 1
    return orientation >= 5 ? ImageSize(width: h, height: w) : ImageSize(width: w, height: h)
  }

  public func compress(_ file: ComposerFile, _ options: ImageCompressOptions) async throws -> ComposerFile? {
    guard let source = Self.source(file) else { return nil }
    let type = UTType(mimeType: options.fileType).flatMap { Self.writable($0) ? $0 : nil } ?? .jpeg
    // The picture is drawn again only when the size changes; most tries
    // only lower the quality.
    var drawn: (side: Int, image: CGImage)?
    let data = Images.compress(
      longSide: Self.longSide(source), originalSize: file.size, options: options, png: type == .png
    ) { side, quality in
      if drawn?.side != side {
        guard let image = Self.upright(source, maxSide: side) else { return nil }
        drawn = (side, image)
      }
      return drawn.flatMap { Self.encode($0.image, type: type, quality: quality) }
    }
    return try data.map { try Self.write($0, like: file, type: type) }
  }

  // MARK: ImageIO

  static func source(_ file: ComposerFile) -> CGImageSource? {
    guard let ref = file.ref else { return nil }
    return CGImageSourceCreateWithURL(URL(fileURLWithPath: ref) as CFURL, nil)
  }

  static func longSide(_ source: CGImageSource) -> Int {
    guard let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else { return 4096 }
    let w = props[kCGImagePropertyPixelWidth] as? Int ?? 4096
    let h = props[kCGImagePropertyPixelHeight] as? Int ?? 4096
    return max(w, h)
  }

  /// The first frame, turned upright, at most `maxSide` on its longer side.
  static func upright(_ source: CGImageSource, maxSide: Int) -> CGImage? {
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: max(1, maxSide),
      kCGImageSourceShouldCacheImmediately: true,
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
  }

  static func writable(_ type: UTType) -> Bool {
    let types = CGImageDestinationCopyTypeIdentifiers() as? [String] ?? []
    return types.contains(type.identifier)
  }

  /// The image alone, with no metadata copied from the original.
  static func encode(_ image: CGImage, type: UTType, quality: Double) -> Data? {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data as CFMutableData, type.identifier as CFString, 1, nil) else { return nil }
    let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: max(0, min(1, quality))]
    CGImageDestinationAddImage(destination, image, options as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return data as Data
  }

  static func write(_ data: Data, like file: ComposerFile, type: UTType) throws -> ComposerFile {
    let ext = type.preferredFilenameExtension ?? "jpg"
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("virga-\(UUID().uuidString).\(ext)")
    try data.write(to: url, options: .atomic)
    let stem = (file.name as NSString?)?.deletingPathExtension
    return ComposerFile(
      name: stem.map { "\($0).\(ext)" }, type: type.preferredMIMEType ?? "image/jpeg", size: Double(data.count),
      lastModified: Date().timeIntervalSince1970 * 1000, ref: url.path)
  }
}
#endif
