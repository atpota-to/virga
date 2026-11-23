// Ports src/posting/composer/MediaGrid.jsx
// Ports src/posting/composer/composer.css (.image-grid, .image-tile, .image-alt, .video-block)
//
// A post's images, up to four, in the order they'll appear: each with its
// alt text button (ticked once the image is described), a move earlier /
// later pair and remove; tiles for images still being prepared are
// placeholders the same size. And a post's video: the player, where its
// upload is, alt text, and remove.

#if canImport(UIKit)
import AVKit
import SwiftUI
import UIKit
import VirgaCore
import VirgaNetwork
import VirgaPosting

/// A composer image's picture: its preview, a local file, or (a draft's
/// image kept only as a posted blob) its CDN address read through
/// `transport`, as `<img src>` loads either.
struct LocalPicture: View {
  @Environment(\.virgaTheme) private var theme
  let url: String?
  var transport: (any HTTPTransport)?
  @State private var image: UIImage?

  var body: some View {
    ZStack {
      theme.surface3
      if let image {
        Image(uiImage: image).resizable().scaledToFill()
      }
    }
    .task(id: url) {
      image = nil
      guard let url else { return }
      image = await Self.picture(url, transport: transport)
    }
  }

  /// The picture at `url`: a `file:` address read from disk, an http(s)
  /// one fetched through `transport` when there is one; nil otherwise.
  static func picture(_ url: String, transport: (any HTTPTransport)?) async -> UIImage? {
    guard let parsed = URL(string: url) else { return nil }
    if parsed.isFileURL { return UIImage(contentsOfFile: parsed.path) }
    guard parsed.scheme == "https" || parsed.scheme == "http", let transport,
      let response = try? await transport.send(HTTPRequest(url: url, timeoutMs: 10_000)), response.ok
    else { return nil }
    return UIImage(data: response.body)
  }
}

/// `.image-grid`: two columns of 4:3 tiles, 6 apart; one picture is a
/// single 16:9 tile, and the first of three stands as tall as the two
/// beside it. A tile is at least 96 tall. Laid out from the grid's width,
/// as the stylesheet's grid is.
struct ComposerImageGridLayout: Layout {
  let gap: CGFloat

  private func rows(_ width: CGFloat) -> (column: CGFloat, tile: CGFloat) {
    let column = max(0, (width - gap) / 2)
    return (column, max(ComposerMeasure.tileMinHeight, column / ComposerMeasure.tileAspect))
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? ComposerMeasure.dialogWidth
    let (_, tile) = rows(width)
    switch subviews.count {
    case 0: return CGSize(width: width, height: 0)
    case 1: return CGSize(width: width, height: max(ComposerMeasure.tileMinHeight, width / ComposerMeasure.singleTileAspect))
    case 2: return CGSize(width: width, height: tile)
    default: return CGSize(width: width, height: tile * 2 + gap)
    }
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let (column, tile) = rows(bounds.width)
    func put(_ index: Int, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) {
      guard subviews.indices.contains(index) else { return }
      subviews[index].place(
        at: CGPoint(x: bounds.minX + x, y: bounds.minY + y), anchor: .topLeading, proposal: ProposedViewSize(width: w, height: h))
    }
    let right = column + gap
    switch subviews.count {
    case 1:
      put(0, 0, 0, bounds.width, bounds.height)
    case 3:
      put(0, 0, 0, column, tile * 2 + gap)
      put(1, right, 0, column, tile)
      put(2, right, tile + gap, column, tile)
    default:
      for index in subviews.indices {
        put(index, index % 2 == 0 ? 0 : right, index < 2 ? 0 : tile + gap, column, tile)
      }
    }
  }
}

struct ImageGrid: View {
  @Environment(\.virgaTheme) private var theme
  let images: [ComposerImage]
  let processing: Int
  let requireAltText: Bool
  let disabled: Bool
  /// For a preview that isn't a local file (a draft's posted image).
  var transport: (any HTTPTransport)?
  let onAlt: (String) -> Void
  let onMove: (Int, Int) -> Void
  let onRemove: (String) -> Void

  var body: some View {
    let count = images.count
    if count > 0 || processing > 0 {
      let note = hint(count)
      VStack(alignment: .leading, spacing: ComposerMeasure.mediaGap) {
        ComposerImageGridLayout(gap: ComposerMeasure.gridGap) {
          ForEach(Array(images.prefix(4).enumerated()), id: \.element.id) { i, img in
            tile(img, i, count: count)
          }
          ForEach(0..<max(0, min(processing, 4 - count)), id: \.self) { _ in
            RoundedRectangle(cornerRadius: theme.radiusLg)
              .fill(theme.surface3)
              .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line))
              .accessibilityHidden(true)
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Images")
        // aria-live="polite": what's being prepared, and what's left to describe.
        Text(note)
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .onChange(of: note) { _, next in ComposerAnnounce.post(next) }
      }
    }
  }

  private func hint(_ count: Int) -> String {
    let left = ComposerMedia.missingAltCount(.object(["images": .array(images.map(\.json))]))
    if processing > 0 {
      return "Preparing \(processing == 1 ? "an image" : "\(processing) images"): shrinking it to fit and removing its location data…"
    }
    if requireAltText {
      return left > 0 ? "\(left) still to describe. Alt text is required before this goes out." : "Every image is described."
    }
    return left > 0 ? "\(count) of 4 images. Alt text helps people who can’t see them." : "\(count) of 4 images, all described."
  }

  private func tile(_ img: ComposerImage, _ i: Int, count: Int) -> some View {
    let described = !img.alt.jsTrimmed().isEmpty
    return ZStack(alignment: .bottomLeading) {
      if img.previewUrl != nil {
        LocalPicture(url: img.previewUrl, transport: transport)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .accessibilityLabel(described ? "Image \(i + 1): \(img.alt)" : "Image \(i + 1), not described yet")
      } else {
        Text(img.localRef != nil && img.file == nil ? "Saved on another device. Add it again." : "Image \(i + 1)")
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .multilineTextAlignment(.center)
          .padding(ComposerMeasure.missingPadding)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(theme.surface3)
      }
      altButton(img, i, described: described)
    }
    .overlay(alignment: .topTrailing) { tools(img, i, count: count) }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusLg))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line))
  }

  /// "+ ALT" on the scrim until the picture is described; then a pill in
  /// the dialog's own colours, with a tick. 36 tall under a finger, pressed
  /// through 44.
  private func altButton(_ img: ComposerImage, _ i: Int, described: Bool) -> some View {
    Button {
      onAlt(img.id)
    } label: {
      HStack(spacing: ComposerMeasure.altGap) {
        if described { Image(systemName: ComposerGlyph.check).virgaGlyph(ComposerMeasure.altTick, weight: .semibold) }
        Text(described ? "ALT" : "+ ALT")
      }
      .virgaText(.textXs, weight: VirgaWeight.semibold, tracking: ComposerMeasure.altTracking)
      .foregroundStyle(described ? theme.ink : Color.white)
      .padding(.horizontal, ComposerMeasure.altPadding)
      .frame(minHeight: ComposerMeasure.altHeight)
      .background(described ? theme.surface : ComposerMeasure.pictureScrim.color, in: Capsule())
    }
    .buttonStyle(.plain)
    .disabled(disabled)
    .touchReach(horizontal: 0, vertical: (Measure.Touch.target - ComposerMeasure.altHeight) / 2)
    .padding(ComposerMeasure.altInset)
    .accessibilityLabel(described ? "Edit alt text for image \(i + 1)" : "Add alt text to image \(i + 1)")
    .accessibilityIdentifier("image-alt-\(i)")
  }

  private func tools(_ img: ComposerImage, _ i: Int, count: Int) -> some View {
    HStack(spacing: ComposerMeasure.toolGap) {
      if count > 1 {
        toolButton(ComposerGlyph.chevronLeft, "Move image \(i + 1) earlier", off: i == 0) { onMove(i, i - 1) }
        toolButton(ComposerGlyph.chevronRight, "Move image \(i + 1) later", off: i == count - 1) { onMove(i, i + 1) }
      }
      toolButton(ComposerGlyph.close, "Remove image \(i + 1)", off: false) { onRemove(img.id) }
    }
    .padding(ComposerMeasure.altInset)
  }

  private func toolButton(_ symbol: String, _ label: String, off: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: symbol)
        .virgaGlyph(ComposerMeasure.toolGlyph, weight: .semibold)
        .foregroundStyle(Color.white)
        .frame(width: ComposerMeasure.toolSize, height: ComposerMeasure.toolSize)
        .background(ComposerMeasure.pictureScrim.color, in: Circle())
    }
    .buttonStyle(.plain)
    .disabled(disabled || off)
    .opacity(disabled || off ? ComposerMeasure.toolOffOpacity : 1)
    .touchReach(
      horizontal: (Measure.Touch.target - ComposerMeasure.toolSize) / 2,
      vertical: (Measure.Touch.target - ComposerMeasure.toolSize) / 2)
    .accessibilityLabel(label)
  }
}

/// A box as wide as it's offered and as tall as `ratio` makes it, up to
/// `maxHeight` (`.video-preview { width: 100%; max-height: 320px }`): what's
/// inside it letterboxes.
struct ComposerAspectBox: Layout {
  let ratio: CGFloat
  let maxHeight: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? ComposerMeasure.dialogWidth
    return CGSize(width: width, height: min(maxHeight, ratio > 0 ? width / ratio : maxHeight))
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    for subview in subviews {
      subview.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(width: bounds.width, height: bounds.height))
    }
  }
}

/// The video's player, made once for its file: the post redraws on every
/// step of the upload, and a player made in the body would start over.
struct ComposerVideoPreview: View {
  @Environment(\.virgaTheme) private var theme
  let url: URL
  let ratio: CGFloat
  @State private var player: AVPlayer?

  var body: some View {
    ComposerAspectBox(ratio: ratio, maxHeight: ComposerMeasure.videoMaxHeight) {
      ZStack {
        theme.surface3
        if let player { VideoPlayer(player: player) }
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusLg))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line))
    .task(id: url) { player = AVPlayer(url: url) }
  }
}

struct VideoAttachment: View {
  @Environment(\.virgaTheme) private var theme
  let video: ComposerVideo
  let disabled: Bool
  let onAlt: () -> Void
  let onRemove: () -> Void
  let onRetry: () -> Void
  let onCancel: () -> Void

  static let statusWords = [
    "idle": "Uploads when you post", "uploading": "Uploading…", "processing": "Processing…", "ready": "Ready",
    "error": "Upload failed",
  ]

  /// The video's own shape (its aspectRatio once read), else 16:9.
  private var ratio: CGFloat {
    let width = video.json["aspectRatio"]?["width"]?.doubleValue ?? 0
    let height = video.json["aspectRatio"]?["height"]?.doubleValue ?? 0
    return width > 0 && height > 0 ? CGFloat(width / height) : ComposerMeasure.singleTileAspect
  }

  var body: some View {
    let busy = video.status == "uploading" || video.status == "processing"
    let progress = video.json["progress"]?.doubleValue
    let pct = progress.map { Int(max(0, min(100, $0.jsRounded))) }
    VStack(alignment: .leading, spacing: ComposerMeasure.videoGap) {
      if let preview = video.previewUrl, let url = URL(string: preview) {
        ComposerVideoPreview(url: url, ratio: ratio)
      } else {
        Text("The video needs to be added again.")
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .frame(maxWidth: .infinity, minHeight: ComposerMeasure.videoMissingHeight)
          .background(theme.surface3, in: RoundedRectangle(cornerRadius: theme.radiusLg))
          .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line))
      }
      meta(busy: busy, pct: pct)
    }
  }

  /// `.video-meta`: where it is, its bar, what went wrong and the actions
  /// at the end, on one wrapping line.
  private func meta(busy: Bool, pct: Int?) -> some View {
    let line = statusLine(busy: busy, pct: pct)
    let error = video.status == "error" ? video.error?.stringValue ?? "" : ""
    return ViewThatFits(in: .horizontal) {
      HStack(alignment: .center, spacing: ComposerMeasure.videoMetaGap) {
        status(line)
        if busy { bar(pct) }
        if !error.isEmpty { FieldHint(error, isOver: true) }
        Spacer(minLength: 0)
        actions(busy: busy)
      }
      VStack(alignment: .leading, spacing: ComposerMeasure.videoMetaRowGap) {
        HStack(alignment: .center, spacing: ComposerMeasure.videoMetaGap) {
          status(line)
          if busy { bar(pct) }
        }
        if !error.isEmpty { FieldHint(error, isOver: true) }
        HStack(spacing: 0) {
          Spacer(minLength: 0)
          actions(busy: busy)
        }
      }
    }
    // role="status": where the upload is, read out as it moves.
    .onChange(of: line) { _, next in ComposerAnnounce.post(next) }
  }

  private func status(_ line: String) -> some View {
    Text(line)
      .virgaText(.textSm)
      .foregroundStyle(theme.ink2)
  }

  private func bar(_ pct: Int?) -> some View {
    ProgressLine(value: pct.flatMap { $0 > 0 ? Double($0) / 100 : nil })
      .frame(minWidth: ComposerMeasure.videoBarMin, maxWidth: .infinity)
  }

  private func statusLine(busy: Bool, pct: Int?) -> String {
    var line = Self.statusWords[video.status] ?? ""
    if let duration = video.json["duration"]?.doubleValue, duration > 0 {
      line += " · \(ComposerMedia.formatDuration(duration))"
    }
    if busy, let pct, pct > 0 { line += " · \(pct)%" }
    return line
  }

  private func actions(busy: Bool) -> some View {
    HStack(spacing: ComposerMeasure.calloutActionsGap) {
      Button(video.alt.jsTrimmed().isEmpty ? "Add alt text" : "Edit alt text", action: onAlt)
        .buttonStyle(.virga(size: .small))
        .disabled(disabled)
      if video.status == "error" {
        Button(action: onRetry) {
          Label("Try again", systemImage: ComposerGlyph.retry)
        }
        .buttonStyle(.virga(size: .small))
        .disabled(disabled)
      }
      if busy {
        Button("Cancel upload", action: onCancel)
          .buttonStyle(.virga(size: .small))
      } else {
        Button(action: onRemove) {
          Label("Remove", systemImage: ComposerGlyph.close)
        }
        .buttonStyle(.virga(.ghost, size: .small))
        .disabled(disabled)
      }
    }
    .fixedSize()
  }
}
#endif
