// Ports src/posting/composer/PostBlock.jsx
// Ports src/posting/composer/composer.css (.post-block, .post-block-head, .split-offer, .post-count)
//
// One post of what's being written (a single post is a thread of one): its
// text, what's attached, its own count, and in a thread its place and the
// ways to move or remove it. A post over the limit offers to split itself
// into a thread, right under its text; once that offer is put away (Not
// now, or the setting), the same thing is a quiet link beside the count.
// PostTools are the ways to add to a post: pictures and a video
// (PhotosPicker); the library's button waits for the library's port.

#if canImport(UIKit)
import CoreTransferable
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import VirgaCore
import VirgaPosting

/// A movie picked from the library, copied to a temporary file.
struct PickedMovie: Transferable {
  let url: URL

  static var transferRepresentation: some TransferRepresentation {
    FileRepresentation(contentType: .movie) { movie in
      SentTransferredFile(movie.url)
    } importing: { received in
      let ext = received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension
      let copy = FileManager.default.temporaryDirectory.appendingPathComponent("composer-\(UUID().uuidString).\(ext)")
      try FileManager.default.copyItem(at: received.file, to: copy)
      return PickedMovie(url: copy)
    }
  }
}

/// PhotosPicker's picks as composer files: a temporary file each, `ref` its path.
enum PickedMedia {
  static func file(_ item: PhotosPickerItem) async throws -> ComposerFile? {
    let types = item.supportedContentTypes
    if let movieType = types.first(where: { $0.conforms(to: .movie) }) {
      guard let movie = try await item.loadTransferable(type: PickedMovie.self) else { return nil }
      let size = (try? FileManager.default.attributesOfItem(atPath: movie.url.path)[.size] as? NSNumber)?.doubleValue ?? 0
      let mime = movieType.preferredMIMEType ?? "video/quicktime"
      return ComposerFile(
        name: movie.url.lastPathComponent, type: mime, size: size, lastModified: Date().timeIntervalSince1970 * 1000,
        ref: movie.url.path)
    }
    guard let data = try await item.loadTransferable(type: Data.self) else { return nil }
    let type = types.first { $0.conforms(to: .image) } ?? .jpeg
    return ComposerFiles.write(data, mime: type.preferredMIMEType ?? "image/jpeg", name: "image")
  }

  static func files(_ items: [PhotosPickerItem]) async -> [ComposerFile] {
    var out: [ComposerFile] = []
    for item in items {
      if let file = try? await file(item) { out.append(file) }
    }
    return out
  }
}

/// The ways to add to a post: pictures and a video.
struct PostTools: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController
  let post: PostDraft
  let disabled: Bool
  @State private var pickedImages: [PhotosPickerItem] = []
  @State private var pickedVideo: PhotosPickerItem?

  var body: some View {
    let hasMedia = !post.images.isEmpty || post.video != nil
    let room = max(0, ComposerModel.maxImages - post.images.count)
    HStack(spacing: 2) {
      PhotosPicker(selection: $pickedImages, maxSelectionCount: max(1, room), matching: .images) {
        Image(systemName: ComposerGlyph.images)
      }
      .buttonStyle(.virga(.ghost, size: .small, icon: true))
      .disabled(disabled || post.video != nil || post.images.count >= ComposerModel.maxImages)
      .accessibilityLabel("Add images")
      .accessibilityIdentifier("add-images")
      PhotosPicker(selection: $pickedVideo, matching: .videos) {
        Image(systemName: ComposerGlyph.video)
      }
      .buttonStyle(.virga(.ghost, size: .small, icon: true))
      .disabled(disabled || hasMedia)
      .accessibilityLabel("Add a video")
    }
    .onChange(of: pickedImages) { _, items in
      guard !items.isEmpty else { return }
      pickedImages = []
      let postId = post.id
      Task {
        let files = await PickedMedia.files(items)
        if !files.isEmpty { await controller.addFiles(postId, files, allowVideo: false) }
      }
    }
    .onChange(of: pickedVideo) { _, item in
      guard let item else { return }
      pickedVideo = nil
      let postId = post.id
      Task {
        let files = await PickedMedia.files([item])
        if !files.isEmpty { await controller.addFiles(postId, files, allowVideo: true) }
      }
    }
  }
}

struct PostBlock: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController
  let post: PostDraft
  let index: Int
  let total: Int
  let disabled: Bool
  @State private var numberChoice: Bool?

  var body: some View {
    let thread = total > 1
    let replying = controller.state.reply != nil
    let label = thread ? "Post \(index + 1) of \(total)" : replying ? "Your reply" : "Your post"
    VStack(alignment: .leading, spacing: ComposerMeasure.blockGap) {
      if thread { head }
      PostEditor(
        controller: controller, postId: post.id, index: index, label: label,
        placeholder: index > 0 ? "Keep going…" : replying ? "Write your reply" : "What’s on your mind?",
        disabled: disabled)
      SplitOffer(controller: controller, post: post, index: index, total: total, disabled: disabled, numberChoice: $numberChoice)
      attachments
      problems
      foot
    }
    .padding(.bottom, thread ? ComposerMeasure.threadPostSpaceBelow : 0)
    .overlay(alignment: .leading) {
      // The line beside the post being written in.
      if thread && controller.activeIndex == index {
        Rectangle().fill(theme.accent).frame(width: 2).offset(x: -theme.space3)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(label)
  }

  private var head: some View {
    HStack(spacing: theme.space2) {
      Text("\(index + 1) of \(total)")
        .virgaText(.textSm, weight: VirgaWeight.medium)
        .foregroundStyle(theme.muted)
      Spacer(minLength: 0)
      tool(ComposerGlyph.moveUp, "Move post \(index + 1) up", off: index == 0) {
        controller.dispatch(.movePost(from: index, to: index - 1))
      }
      tool(ComposerGlyph.moveDown, "Move post \(index + 1) down", off: index == total - 1) {
        controller.dispatch(.movePost(from: index, to: index + 1))
      }
      tool(ComposerGlyph.trash, "Remove post \(index + 1)", off: false) {
        Task { await controller.removePost(index) }
      }
    }
    .frame(minHeight: ComposerMeasure.headHeight)
  }

  private func tool(_ symbol: String, _ label: String, off: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) { Image(systemName: symbol) }
      .buttonStyle(.virga(.ghost, size: .small, icon: true))
      .disabled(disabled || off)
      .accessibilityLabel(label)
  }

  @ViewBuilder private var attachments: some View {
    ImageGrid(
      images: post.images, processing: controller.processing[post.id] ?? 0,
      requireAltText: controller.settings.requireAltText, disabled: disabled,
      onAlt: { id in controller.dialog = .alt(postId: post.id, imageId: id) },
      onMove: { from, to in controller.dispatch(.moveImage(index: index, from: from, to: to)) },
      onRemove: { id in controller.dispatch(.removeImage(index: index, id: id)) })
    if let video = post.video {
      VideoAttachment(
        video: video, disabled: disabled, onAlt: { controller.dialog = .videoAlt(postId: post.id) },
        onRemove: { controller.removeVideo(index) }, onRetry: { controller.retryVideo(index) },
        onCancel: { controller.removeVideo(index) })
    }
    if controller.recordLoading.contains(post.id) && post.record == nil
      || index == 0 && controller.loads["quote"] == .loading && post.record == nil
    {
      HStack(spacing: ComposerMeasure.embedGap) {
        RoundedRectangle(cornerRadius: theme.radius).fill(theme.surface3).frame(width: 36, height: 36)
        Capsule().fill(theme.surface3).frame(height: 10)
      }
      .padding(ComposerMeasure.embedPadding)
      .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line))
      .accessibilityElement()
      .accessibilityLabel("Reading what you linked")
    }
    if let record = post.record {
      RecordCard(record: record, disabled: disabled) { controller.removeRecord(index) }
    }
    if post.images.isEmpty && post.video == nil {
      LinkCardView(
        card: post.card, loading: controller.cardLoading.contains(post.id) && post.card == nil, disabled: disabled,
        transport: controller.transport, onEdit: { controller.dialog = .card(postId: post.id) },
        onRemove: { controller.removeCard(index) })
    }
  }

  @ViewBuilder private var problems: some View {
    let codes = ["TOO_MANY_BYTES", "IMAGE_MISSING", "VIDEO_MISSING", "RECORD_UNRESOLVED", "ALT_TOO_LONG"]
    let list = controller.model.problems(now: Date()).filter { $0.postIndex == index && codes.contains($0.code) }
    if !list.isEmpty {
      VStack(alignment: .leading, spacing: theme.space1) {
        ForEach(list, id: \.code) { p in
          Text(p.message).virgaText(.textSm).foregroundStyle(theme.danger)
        }
      }
    }
  }

  private var foot: some View {
    let count = InlineLinks.countComposerGraphemes(post.text.jsTrimmed())
    let max = ComposerModel.maxPostGraphemes
    let over = count > max
    let offer = controller.settings.showThreadSuggestion && !controller.splitDismissed && total < ComposerModel.maxPosts
    let numbered = numberChoice ?? (controller.settings.threadNumbering == "counter")
    let parts = over ? ThreadEdits.splitTexts(controller.state.posts, post.id, numbering: numbered ? .counter : .off) : nil
    return HStack(spacing: theme.space3) {
      if !theme.isPhone { PostTools(controller: controller, post: post, disabled: disabled) }
      if !offer && parts != nil {
        Button("Split into a thread") { controller.split(post.id, numbered: numbered) }
          .buttonStyle(.linkAction)
          .disabled(disabled)
      }
      Spacer(minLength: 0)
      Text(
        over
          ? "\(AppLocale.fmtInt(Double(count))) of \(max), \(AppLocale.fmtInt(Double(count - max))) over" : "\(count) of \(max)"
      )
      .virgaText(.textSm, weight: over ? VirgaWeight.semibold : VirgaWeight.regular)
      .foregroundStyle(over ? theme.danger : theme.muted)
      .monospacedDigit()
      .accessibilityIdentifier("post-count-\(index)")
    }
    .onChange(of: count) { old, new in
      let words = ComposerEditing.limitAnnouncement(Double(new))
      if !words.isEmpty, ComposerEditing.limitAnnouncement(Double(old)) != words {
        UIAccessibility.post(notification: .announcement, argument: words)
      }
    }
  }
}

/// The offer to split a post that's over the limit into a thread.
struct SplitOffer: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController
  let post: PostDraft
  let index: Int
  let total: Int
  let disabled: Bool
  @Binding var numberChoice: Bool?

  var body: some View {
    let count = InlineLinks.countComposerGraphemes(post.text.jsTrimmed())
    let max = ComposerModel.maxPostGraphemes
    let offer = controller.settings.showThreadSuggestion && !controller.splitDismissed && total < ComposerModel.maxPosts
    let numbered = numberChoice ?? (controller.settings.threadNumbering == "counter")
    let parts =
      count > max && offer ? ThreadEdits.splitTexts(controller.state.posts, post.id, numbering: numbered ? .counter : .off) : nil
    if let parts {
      let first = numbered ? parts.first.flatMap { ThreadSplit.readCounter($0) } : nil
      Callout(systemImage: ComposerGlyph.split) {
        VStack(alignment: .leading, spacing: theme.space2) {
          Text(
            "This is \(AppLocale.fmtInt(Double(count - max))) characters over the \(max) limit. As a thread it would be \(AppLocale.fmtInt(Double(parts.count))) posts."
          )
          Toggle(isOn: Binding(get: { numbered }, set: { numberChoice = $0 })) {
            Text("Number them") + Text(first.map { " (\($0.number)/\($0.total) and so on)" } ?? "").foregroundColor(theme.muted)
          }
          .toggleStyle(.virgaCheck)
          .disabled(disabled)
          HStack(spacing: theme.space2) {
            // An outline: the one ink button in the composer is the one that sends.
            Button("Split into a thread") { controller.split(post.id, numbered: numbered) }
              .buttonStyle(.virga(size: .small))
              .disabled(disabled)
              .accessibilityIdentifier("split-\(index)")
            Button("Not now") { controller.dismissSplit() }
              .buttonStyle(.virga(.ghost, size: .small))
          }
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Split this post into a thread")
    }
  }
}
#endif
