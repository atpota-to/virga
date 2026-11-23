// Ports src/posting/composer/Composer.jsx (dropProps, dropFiles, the composer's drop hint)
// Ports src/posting/composer/composer.css (.composer-drop)
//
// Files dragged onto the composer (from Photos, Files or another app beside
// it) go to the post being written, as a drop on the web's composer does:
// the pictures are added, and everything goes through addFiles with
// allowVideo false, so a video or any other file is left out with the
// web's own note ("Drop images here; add a video with the video button.",
// "One file wasn't an image."). Nothing is taken while the composer is busy
// (`disabled`). A drop counts as files where it brings a picture, a video
// or sound, or a PDF; dragged text and links are left to the post's text
// view, as a browser's are to the textarea (no 'Files' in the drag).
//
// While a drag of files is over the composer, the post area says so: "Drop
// images to add them to the post" over it, in a dashed line in the accent,
// on the surface at 90% (`.composer-drop`, inset 0 in `.composer`). The
// head or a phone's bar and the foot stay clear, as the web's dialog head,
// sticky bar and actions do. The whole sheet takes the drop, as the web's
// window-level listener sends a drop on the dialog's head or actions to the
// post too.

#if canImport(UIKit)
import SwiftUI
import UniformTypeIdentifiers
import VirgaPosting

/// What a drop takes: files, not text or links.
enum ComposerDrop {
  static let types: [UTType] = [.image, .audiovisualContent, .pdf]

  /// `dropFiles`: everything dropped, to the post being written (the web's
  /// `posts[activeIndex]?.id || posts[0].id`). False (the drop refused)
  /// while the composer is busy or when nothing in it is a file.
  ///
  /// The dropped payload can be read only until the drop's action returns,
  /// so every picture's load starts here; the files are added together, in
  /// the order they were dropped, once all have arrived.
  @MainActor
  static func take(_ providers: [NSItemProvider], into controller: ComposerController) -> Bool {
    guard !controller.disabled else { return false }
    let dropped = providers.filter { provider in
      provider.registeredContentTypes.contains { type in types.contains { type.conforms(to: $0) } }
    }
    let posts = controller.state.posts
    guard !dropped.isEmpty, !posts.isEmpty else { return false }
    let postId = posts.indices.contains(controller.activeIndex) ? posts[controller.activeIndex].id : posts[0].id

    let (arrivals, deliver) = AsyncStream.makeStream(of: (Int, ComposerFile?).self)
    for (at, provider) in dropped.enumerated() {
      start(provider) { deliver.yield((at, $0)) }
    }
    Task { @MainActor in
      var files: [Int: ComposerFile] = [:]
      var left = dropped.count
      for await (at, file) in arrivals {
        if let file { files[at] = file }
        left -= 1
        if left == 0 { break }
      }
      let ordered = dropped.indices.compactMap { files[$0] }
      guard !ordered.isEmpty else { return }
      await controller.addFiles(postId, ordered, allowVideo: false)
    }
    return true
  }

  /// One dropped item as a file. A picture is read and kept as a temporary
  /// file, as a pasted one is: its first of PNG, JPEG, HEIC or GIF
  /// (PasteboardItems.preferred), else whichever image type it brings. A
  /// video, sound or PDF is never taken from a drop (addFiles with allowVideo
  /// false), so only its type and name are passed on, for addFiles' note.
  private static func start(_ provider: NSItemProvider, _ done: @escaping @Sendable (ComposerFile?) -> Void) {
    let types = provider.registeredContentTypes
    let name = provider.suggestedName
    let picture =
      PasteboardItems.preferred.first(where: { preferred in types.contains { $0.conforms(to: preferred) } })
      ?? types.first(where: { $0.conforms(to: .image) })
    guard let picture else {
      let other = types.first { type in Self.types.contains { type.conforms(to: $0) } }
      done(other.map { ComposerFile(name: name, type: $0.preferredMIMEType ?? "", size: 0) })
      return
    }
    let mime = picture.preferredMIMEType ?? "image/png"
    _ = provider.loadDataRepresentation(for: picture) { data, _ in
      done(data.flatMap { TemporaryComposerFiles.write($0, mime: mime, name: name ?? "dropped") })
    }
  }
}

extension View {
  /// The composer as a place to drop files; `over` is set while a drag of
  /// files is over it, for ComposerDropHint.
  func composerDrop(_ controller: ComposerController, over: Binding<Bool>) -> some View {
    onDrop(of: ComposerDrop.types, isTargeted: over) { providers in
      ComposerDrop.take(providers, into: controller)
    }
  }
}

/// `.composer-drop`: over the post area while a drag of files is over the
/// composer. Not pressable, and not read out (aria-hidden).
struct ComposerDropHint: View {
  @Environment(\.virgaTheme) private var theme

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: theme.radiusLg)
    Text("Drop images to add them to the post")
      .virgaText(.textBase, weight: VirgaWeight.semibold)
      .foregroundStyle(theme.ink)
      .multilineTextAlignment(.center)
      .padding(ComposerMeasure.dropPadding)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(theme.surface.opacity(ComposerMeasure.dropFillShare), in: shape)
      .overlay(
        shape.strokeBorder(
          theme.accent,
          style: StrokeStyle(lineWidth: ComposerMeasure.dropBorder, dash: [ComposerMeasure.dropDash, ComposerMeasure.dropDash])))
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }
}
#endif
