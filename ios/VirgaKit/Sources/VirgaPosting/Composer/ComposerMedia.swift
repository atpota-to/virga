// Ports src/posting/composer/media.js
//
// Which files a pick, a paste or a drop brings into a post, and what is
// left out and why. The pipeline itself (compression, uploads) is Images
// and Video; this only sorts. A file is a ComposerFile; the sorting reads
// any value as the web does (`file.type`).

import Foundation
import VirgaCore

/// What a pick or a drop adds to a post: `{ images, video, notes }`.
public struct IncomingFiles: Codable, Hashable, Sendable {
  public var images: [JSONValue]
  /// The video taken, or null.
  public var video: JSONValue?
  public var notes: [String]

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(images, forKey: .images)
    try container.encode(video ?? .null, forKey: .video)
    try container.encode(notes, forKey: .notes)
  }

  /// The images as files.
  public var imageFiles: [ComposerFile] { images.compactMap(ComposerFile.init(json:)) }
  public var videoFile: ComposerFile? { ComposerFile(json: video) }
}

/// An item on the pasteboard: its kind ('file' or 'string'), its type, and
/// the file it holds (the clipboard's DataTransferItem).
public struct PastedItem: Hashable, Sendable {
  public var kind: String
  public var type: String
  public var file: ComposerFile?

  public init(kind: String, type: String, file: ComposerFile?) {
    self.kind = kind
    self.type = type
    self.file = file
  }
}

public enum ComposerMedia {
  public static let imageInputAccept = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/avif"

  static func type(of file: JSONValue) -> String? { file["type"]?.stringValue }
  static func isImage(_ file: JSONValue) -> Bool { type(of: file).map { PostingJS.hasPrefix($0, "image/") } ?? false }
  static func isVideo(_ file: JSONValue) -> Bool { type(of: file).map { PostingJS.hasPrefix($0, "video/") } ?? false }

  /// The image files a paste should attach. Empty means leave the paste
  /// alone: any text on the pasteboard means a text paste. Clipboard images
  /// arrive nameless and are named `pasted-image-<time>.<ext>`.
  public static func pastedImageFiles(_ items: [PastedItem]?, text: String?, now: () -> Date = Date.init)
    -> [ComposerFile]
  {
    guard let items else { return [] }
    if let text, !text.jsTrimmed().isEmpty { return [] }
    var files: [ComposerFile] = []
    for item in items {
      guard item.kind == "file", PostingJS.hasPrefix(item.type, "image/"), let file = item.file else { continue }
      let at = (now().timeIntervalSince1970 * 1000).rounded(.down)
      let stamp = String(
        decoding: (JSDate.toISOString(at) ?? "").utf16.map { $0 == 0x3A || $0 == 0x2E ? 0x2D : $0 }, as: UTF16.self)
      let pieces = PostingQueue.split(file.type, 0x2F)
      let ext = pieces.count > 1 && !pieces[1].isEmpty ? pieces[1] : "png"
      var named = file
      named.name = "pasted-image-\(stamp).\(ext)"
      named.lastModified = (now().timeIntervalSince1970 * 1000).rounded(.down)
      files.append(named)
    }
    return files
  }

  /// What a pick or a drop adds to a post. A post holds up to four images
  /// or one video. A video is taken only when the post holds no images and
  /// it's the only video offered; `allowVideo: false` (a drop) refuses video.
  public static func sortIncomingFiles(
    _ files: [JSONValue]?, imageCount: Int = 0, hasVideo: Bool = false, allowVideo: Bool = true
  ) -> IncomingFiles {
    let list = (files ?? []).filter(\.isTruthy)
    let images = list.filter(isImage)
    let videos = list.filter(isVideo)
    let other = list.count - images.count - videos.count
    var notes: [String] = []

    if !videos.isEmpty && allowVideo && images.isEmpty && imageCount == 0 {
      let video = videos[0]
      if videos.count > 1 { notes.append("A post holds one video, so only the first was added.") }
      if !ComposerJS.includes(Video.videoSupportedMimeTypes, video["type"]) {
        return IncomingFiles(images: [], video: nil, notes: ["Videos can be MP4, MOV, WebM or MPEG."])
      }
      if other > 0 {
        notes.append(other == 1 ? "One file wasn’t an image or a video." : "\(other) files weren’t images or videos.")
      }
      return IncomingFiles(images: [], video: video, notes: notes)
    }
    if !videos.isEmpty {
      notes.append(
        !allowVideo
          ? "Drop images here; add a video with the video button."
          : "A post holds images or a video, not both, so the video wasn’t added.")
    }

    let maxImages = ComposerModel.maxImages
    let room = hasVideo ? 0 : Swift.max(0, maxImages - imageCount)
    if !images.isEmpty && hasVideo {
      notes.append("This post has a video, so images can’t be added. Remove the video first.")
    } else if images.count > room {
      notes.append(
        room == 0
          ? "A post holds up to \(maxImages) images, and this one is full."
          : "A post holds up to \(maxImages) images, so only \(room) more \(room == 1 ? "was" : "were") added.")
    }
    if other > 0 { notes.append(other == 1 ? "One file wasn’t an image." : "\(other) files weren’t images.") }
    return IncomingFiles(images: Array(images.prefix(room)), video: nil, notes: notes)
  }

  public static func sortIncomingFiles(
    _ files: [ComposerFile], imageCount: Int = 0, hasVideo: Bool = false, allowVideo: Bool = true
  ) -> IncomingFiles {
    sortIncomingFiles(files.map(\.json), imageCount: imageCount, hasVideo: hasVideo, allowVideo: allowVideo)
  }

  /// "1:23" for a duration in seconds.
  public static func formatDuration(_ seconds: JSONValue?) -> String {
    let n = seconds.jsNumber
    let s = Swift.max(0, (n.isNaN ? 0 : n).jsRounded)
    let minutes = (s / 60).rounded(.down)
    let rest = s.truncatingRemainder(dividingBy: 60)
    let text = JSNumber.format(rest)
    return "\(JSNumber.format(minutes)):\(text.utf16.count < 2 ? "0" + text : text)"
  }

  public static func formatDuration(_ seconds: Double) -> String { formatDuration(.number(seconds)) }

  /// How many of a post's images still need alt text.
  public static func missingAltCount(_ post: JSONValue?) -> Int {
    ComposerJS.list(ComposerJS.or(post?["images"], nil)).filter { ComposerJS.trimmed($0["alt"]).isEmpty }.count
  }

  public static func missingAltCount(_ post: PostDraft) -> Int { missingAltCount(post.json) }
}
