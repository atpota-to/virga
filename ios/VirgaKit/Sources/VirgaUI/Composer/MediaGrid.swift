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
import VirgaCore
import VirgaPosting

/// A composer file's picture, read from its ref (a local file).
struct LocalPicture: View {
  @Environment(\.virgaTheme) private var theme
  let url: String?
  @State private var image: UIImage?

  var body: some View {
    ZStack {
      theme.surface3
      if let image {
        Image(uiImage: image).resizable().scaledToFill()
      }
    }
    .task(id: url) {
      guard let url, let parsed = URL(string: url), parsed.isFileURL else {
        image = nil
        return
      }
      image = UIImage(contentsOfFile: parsed.path)
    }
  }
}

struct ImageGrid: View {
  @Environment(\.virgaTheme) private var theme
  let images: [ComposerImage]
  let processing: Int
  let requireAltText: Bool
  let disabled: Bool
  let onAlt: (String) -> Void
  let onMove: (Int, Int) -> Void
  let onRemove: (String) -> Void

  var body: some View {
    let count = images.count
    if count > 0 || processing > 0 {
      VStack(alignment: .leading, spacing: theme.space2) {
        let columns = Array(repeating: GridItem(.flexible(), spacing: ComposerMeasure.gridGap), count: min(4, count + processing) == 1 ? 1 : 2)
        LazyVGrid(columns: columns, spacing: ComposerMeasure.gridGap) {
          ForEach(Array(images.enumerated()), id: \.element.id) { i, img in
            tile(img, i, count: count)
          }
          ForEach(0..<max(0, min(processing, 4 - count)), id: \.self) { _ in
            RoundedRectangle(cornerRadius: theme.radiusLg)
              .fill(theme.surface3)
              .aspectRatio(ComposerMeasure.tileAspect, contentMode: .fit)
              .accessibilityHidden(true)
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Images")
        Text(hint(count))
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
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
        LocalPicture(url: img.previewUrl)
          .accessibilityLabel(described ? "Image \(i + 1): \(img.alt)" : "Image \(i + 1), not described yet")
      } else {
        Text(img.localRef != nil && img.file == nil ? "Saved on another device. Add it again." : "Image \(i + 1)")
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(theme.surface3)
      }
      Button {
        onAlt(img.id)
      } label: {
        HStack(spacing: 5) {
          if described { Image(systemName: ComposerGlyph.check).font(.system(size: 12, weight: .semibold)) }
          Text(described ? "ALT" : "+ ALT")
        }
        .virgaText(.textXs, weight: VirgaWeight.semibold)
        .foregroundStyle(Color.white)
        .padding(.horizontal, ComposerMeasure.altPadding)
        .frame(minHeight: ComposerMeasure.altHeight)
        .background(ComposerMeasure.pictureScrim.color, in: Capsule())
      }
      .buttonStyle(.plain)
      .disabled(disabled)
      .padding(ComposerMeasure.altInset)
      .accessibilityLabel(described ? "Edit alt text for image \(i + 1)" : "Add alt text to image \(i + 1)")
      .accessibilityIdentifier("image-alt-\(i)")
    }
    .overlay(alignment: .topTrailing) { tools(img, i, count: count) }
    .frame(minHeight: ComposerMeasure.tileMinHeight)
    .aspectRatio(ComposerMeasure.tileAspect, contentMode: .fit)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusLg))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line))
  }

  private func tools(_ img: ComposerImage, _ i: Int, count: Int) -> some View {
    HStack(spacing: 4) {
      if count > 1 {
        toolButton(ComposerGlyph.chevronLeft, "Move image \(i + 1) earlier", off: i == 0) { onMove(i, i - 1) }
        toolButton(ComposerGlyph.chevronRight, "Move image \(i + 1) later", off: i == count - 1) { onMove(i, i + 1) }
      }
      toolButton(ComposerGlyph.close, "Remove image \(i + 1)", off: false) { onRemove(img.id) }
    }
    .padding(6)
  }

  private func toolButton(_ symbol: String, _ label: String, off: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(Color.white)
        .frame(width: 28, height: 28)
        .background(ComposerMeasure.pictureScrim.color, in: Circle())
    }
    .buttonStyle(.plain)
    .disabled(disabled || off)
    .opacity(disabled || off ? 0.45 : 1)
    .touchTarget()
    .accessibilityLabel(label)
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

  var body: some View {
    let busy = video.status == "uploading" || video.status == "processing"
    let progress = video.json["progress"]?.doubleValue
    let pct = progress.map { Int(max(0, min(100, $0.jsRounded))) }
    VStack(alignment: .leading, spacing: theme.space2) {
      if let preview = video.previewUrl, let url = URL(string: preview) {
        VideoPlayer(player: AVPlayer(url: url))
          .aspectRatio(16 / 9, contentMode: .fit)
          .clipShape(RoundedRectangle(cornerRadius: theme.radiusLg))
      } else {
        Text("The video needs to be added again.")
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .frame(maxWidth: .infinity, minHeight: ComposerMeasure.tileMinHeight)
          .background(theme.surface3, in: RoundedRectangle(cornerRadius: theme.radiusLg))
      }
      Text(statusLine(busy: busy, pct: pct))
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
      if busy {
        ProgressLine(value: pct.flatMap { $0 > 0 ? Double($0) / 100 : nil })
      }
      if video.status == "error", let error = video.error?.stringValue, !error.isEmpty {
        FieldHint(error, isOver: true)
      }
      actions(busy: busy)
    }
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
    FlowLayout(spacing: theme.space2) {
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
  }
}
#endif
