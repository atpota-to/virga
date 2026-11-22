// Ports src/posting/composer/Composer.jsx (dropProps, dropFiles, the composer's drop hint)
// Ports src/posting/composer/composer.css (.composer-drop)
//
// Pictures dragged onto the composer (from Photos, Files or another app
// beside it) are added to the post being written, as a drop on the web's
// composer is: images only (addFiles with allowVideo false, so a video
// isn't taken from a drop), and nothing while the composer is busy
// (`disabled`). While a drag carrying a picture is over the composer, it
// says so: "Drop images to add them to the post" over the whole of it, in
// a dashed line in the accent, on the surface at 90%.
//
// The web also stops a file dropped on the page around its dialog from
// opening in the tab; a sheet on iOS has nothing around it to drop on.

#if canImport(UIKit)
import SwiftUI
import UniformTypeIdentifiers
import VirgaPosting

extension View {
  /// The composer as a place to drop pictures.
  func composerDrop(_ controller: ComposerController) -> some View {
    modifier(ComposerDrop(controller: controller))
  }
}

struct ComposerDrop: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController
  /// `dragOver`: a drag carrying a picture is over the composer.
  @State private var over = false

  func body(content: Content) -> some View {
    content
      .onDrop(of: [.image], isTargeted: $over) { providers in
        take(providers)
      }
      .overlay {
        if over {
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
                style: StrokeStyle(
                  lineWidth: ComposerMeasure.dropBorder, dash: [ComposerMeasure.dropDash, ComposerMeasure.dropDash])))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
      }
  }

  /// `dropFiles`: the pictures, added to the post being written. False
  /// (the drop refused) while the composer is busy or when none is a picture.
  private func take(_ providers: [NSItemProvider]) -> Bool {
    guard !controller.disabled else { return false }
    let pictures = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
    let index = controller.toolsIndex
    guard !pictures.isEmpty, controller.state.posts.indices.contains(index) else { return false }
    let postId = controller.state.posts[index].id
    let controller = self.controller
    Task { @MainActor in
      var files: [ComposerFile] = []
      for provider in pictures {
        if let file = await Self.file(from: provider) { files.append(file) }
      }
      guard !files.isEmpty else { return }
      await controller.addFiles(postId, files, allowVideo: false)
    }
    return true
  }

  /// A dropped picture as a temporary file, as a pasted one is: its first
  /// of PNG, JPEG, HEIC or GIF (PasteboardItems.preferred), else whichever
  /// image type it brings, with the name it suggests.
  private static func file(from provider: NSItemProvider) async -> ComposerFile? {
    let types = provider.registeredContentTypes
    guard
      let type = PasteboardItems.preferred.first(where: { preferred in types.contains { $0.conforms(to: preferred) } })
        ?? types.first(where: { $0.conforms(to: .image) })
    else { return nil }
    let mime = type.preferredMIMEType ?? "image/png"
    let name = provider.suggestedName ?? "dropped"
    return await withCheckedContinuation { continuation in
      _ = provider.loadDataRepresentation(for: type) { data, _ in
        continuation.resume(returning: data.flatMap { TemporaryComposerFiles.write($0, mime: mime, name: name) })
      }
    }
  }
}
#endif
