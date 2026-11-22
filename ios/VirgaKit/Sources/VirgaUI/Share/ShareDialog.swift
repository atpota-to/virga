// Ports src/share/ShareDialog.jsx
// Ports src/share/share.css
//
// "Post this chart": a card as a picture, with its description written
// from the chart's own numbers, ready to go into a post or to save.
// Nothing is posted from here. The picture is drawn as the dialog opens
// (ShareImage), under the sky that is on screen and in its colours; the
// description under it is ShareSpec's, to change. Save the picture puts it
// in Photos (asking first, add-only). Write a post with it hands the
// picture, its description and a first line to the composer when one is
// set in the environment (`shareComposer`); until the composer is in the
// app, it offers the picture and the first line through the system's
// share sheet (ShareLink), as virga-chart.png. A phone's dialog has its two
// buttons one under the other, Write a post with it first.
//
// THE HOOK, for the dashboards and the reports:
//
//   // A card's ghost icon by its title (`Post <name> as a picture`):
//   PostChartButton(type: card.type, name: title ?? def.name, options: card.options, period: period)
//
//   // A report's link action under its chart ("Post this chart"):
//   PostChartLink(type: widget.type, name: widget.name, kind: kind, period: period)
//
//   // Or from anything else (a ⋯ menu's "Post this chart as a picture"):
//   @State var share: ShareRequest?
//   … .shareDialog($share, period: period)
//   share = ShareRequest(type: widget.type, kind: kind)
//
// Each draws nothing for a card type ShareSpec can't make a picture of.

#if canImport(UIKit)
import Photos
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import VirgaArchive
import VirgaCore
import VirgaInsights

/// The card to draw: its type, its own settings, and the window it reads
/// (its own period on a dashboard; nil for the page's).
public struct ShareRequest: Identifiable, Hashable, Sendable {
  public var type: String
  public var kind: String?
  public var rows: Int?
  public var title: String?
  public var period: AnalyticsPeriod?

  public var id: String { type }

  public init(type: String, kind: String? = nil, rows: Int? = nil, title: String? = nil, period: AnalyticsPeriod? = nil) {
    self.type = type
    self.kind = kind
    self.rows = rows
    self.title = title
    self.period = period
  }

  /// A dashboard card's request: its options as they are stored.
  public init(type: String, options: CardOptions?, period: AnalyticsPeriod? = nil) {
    self.init(type: type, kind: options?.kind, rows: options?.rows, title: options?.title, period: period)
  }
}

/// What "Write a post with it" hands the composer: whose post, its first
/// line, and the picture with its description.
public struct ShareDraft {
  public var asDid: String
  public var text: String
  public var image: UIImage
  public var png: Data
  public var filename: String
  public var alt: String
}

/// `composer.open({ asDid, text, images })`, set by whoever holds the
/// composer.
public struct ShareComposer {
  let open: @MainActor (ShareDraft) -> Void

  public init(_ open: @escaping @MainActor (ShareDraft) -> Void) {
    self.open = open
  }

  @MainActor
  public func callAsFunction(_ draft: ShareDraft) {
    open(draft)
  }
}

private struct ShareComposerKey: EnvironmentKey {
  static let defaultValue: ShareComposer? = nil
}

extension EnvironmentValues {
  /// The composer "Write a post with it" opens; nil until the composer is
  /// in the app, when the picture goes out through the share sheet.
  public var shareComposer: ShareComposer? {
    get { self[ShareComposerKey.self] }
    set { self[ShareComposerKey.self] = newValue }
  }
}

/// The picture for the share sheet: a PNG, named as the web names its file.
struct SharePicture: Transferable {
  let png: Data

  static var transferRepresentation: some TransferRepresentation {
    DataRepresentation(exportedContentType: .png) { picture in picture.png }
      .suggestedFileName(ShareImage.filename)
  }
}

struct ShareDialogModifier: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  @Binding var request: ShareRequest?
  let period: AnalyticsPeriod

  func body(content: Content) -> some View {
    content.sheet(item: $request) { shown in
      ShareDialogView(request: shown, period: shown.period ?? period) { request = nil }
        .presentationDetents([.large])
        .presentationBackground(theme.surface)
        .presentationCornerRadius(Measure.Dialog.radius)
    }
  }
}

extension View {
  /// "Post this chart" over this view, while `request` names a card.
  /// `period` is the page's window, for a request that names none.
  public func shareDialog(_ request: Binding<ShareRequest?>, period: AnalyticsPeriod) -> some View {
    modifier(ShareDialogModifier(request: request, period: period))
  }
}

/// A dashboard card's way to its picture: a ghost icon by its title.
public struct PostChartButton: View {
  @State private var request: ShareRequest?
  private let type: String
  private let name: String
  private let options: CardOptions?
  private let period: AnalyticsPeriod

  public init(type: String, name: String, options: CardOptions? = nil, period: AnalyticsPeriod) {
    self.type = type
    self.name = name
    self.options = options
    self.period = period
  }

  public var body: some View {
    if ShareSpec.canShare(type) {
      Button {
        request = ShareRequest(type: type, options: options, period: period)
      } label: {
        Image(systemName: ToolGlyph.picture)
      }
      .buttonStyle(.virga(.ghost, size: .small, icon: true))
      .accessibilityLabel("Post \(name) as a picture")
      .accessibilityHint("Post this chart")
      .accessibilityIdentifier("post-chart-\(type)")
      .shareDialog($request, period: period)
    }
  }
}

/// A report's way to its chart's picture: "Post this chart", a link action.
public struct PostChartLink: View {
  @State private var request: ShareRequest?
  private let type: String
  private let name: String
  private let kind: String?
  private let period: AnalyticsPeriod

  public init(type: String, name: String, kind: String? = nil, period: AnalyticsPeriod) {
    self.type = type
    self.name = name
    self.kind = kind
    self.period = period
  }

  public var body: some View {
    if ShareSpec.canShare(type) {
      Button {
        request = ShareRequest(type: type, kind: kind)
      } label: {
        Label("Post this chart", systemImage: ToolGlyph.picture)
      }
      .buttonStyle(.linkAction)
      .accessibilityHint("\(name), as a picture with its description")
      .accessibilityIdentifier("post-chart-\(type)")
      .shareDialog($request, period: period)
    }
  }
}

/// The dialog itself.
struct ShareDialogView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.shareComposer) private var composer
  @Environment(AppModel.self) private var app
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  let request: ShareRequest
  let period: AnalyticsPeriod
  let onClose: () -> Void

  @State private var spec: ShareSpecification?
  @State private var made = false
  @State private var picture: UIImage?
  @State private var png: Data?
  @State private var failed: String?
  @State private var alt = ""
  @State private var saving = false

  var body: some View {
    DialogFrame(title: "Post this chart", onClose: onClose) {
      content
    } actions: {
      actions
    }
    .task(id: request) { await draw() }
    .accessibilityIdentifier("share-dialog")
  }

  @ViewBuilder
  private var content: some View {
    if made && spec == nil {
      EmptyState("There’s nothing on this card to draw yet.")
    } else {
      VStack(alignment: .leading, spacing: Measure.Share.gap) {
        preview
        FieldStack("Description (alt text)") {
          TextEditor(text: $alt)
            .virgaTextArea(invalid: alt.utf16.count > ShareSpec.altTextMax)
            .frame(minHeight: Measure.Share.altMinHeight)
            .accessibilityLabel("Description (alt text)")
            .accessibilityIdentifier("share-alt")
            .onChange(of: alt) { _, next in
              if next.utf16.count > Measure.Share.altMaxLength { alt = next.jsSlice(0, Measure.Share.altMaxLength) }
            }
          FieldHint(
            "Written from the chart’s numbers; change it as you like. Nothing posts until you do.",
            isOver: alt.utf16.count > ShareSpec.altTextMax)
        }
      }
      .frame(maxWidth: Measure.Share.dialogWidth, alignment: .leading)
    }
  }

  /// The picture as it will be posted, with an edge of its own.
  private var preview: some View {
    let ratio = CGFloat(ChartImage.shareWidth / ChartImage.shareHeight)
    return ZStack {
      theme.bg
      if let picture {
        Image(uiImage: picture)
          .resizable()
          .aspectRatio(ratio, contentMode: .fit)
          .accessibilityLabel(alt)
          .accessibilityIdentifier("share-picture")
      } else {
        Text(failed ?? "Drawing the picture…")
          .virgaText(.textBase)
          .foregroundStyle(theme.muted)
          .accessibilityAddTraits(.updatesFrequently)
      }
    }
    .aspectRatio(ratio, contentMode: .fit)
    .frame(maxWidth: .infinity)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusLg))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line, lineWidth: 1))
  }

  @ViewBuilder
  private var actions: some View {
    if theme.isPhone {
      VStack(spacing: Measure.Dialog.actionsGap) {
        write
        save
      }
    } else {
      save
      write
    }
  }

  private var save: some View {
    Button {
      Task { await saveToPhotos() }
    } label: {
      Label("Save the picture", systemImage: Glyph.download)
    }
    .buttonStyle(.virga)
    .disabled(png == nil || saving)
    .accessibilityIdentifier("share-save")
  }

  @ViewBuilder
  private var write: some View {
    if let composer, let picture, let png, let spec, let archive {
      Button {
        composer(
          ShareDraft(
            asDid: archive.did, text: ShareSpec.sharePostText(spec, period), image: picture, png: png, filename: ShareImage.filename,
            alt: alt.jsTrimmed()))
        onClose()
      } label: {
        Label("Write a post with it", systemImage: Glyph.newPost)
      }
      .buttonStyle(.virga(.primary))
      .accessibilityIdentifier("share-write")
    } else if let picture, let png, let spec {
      ShareLink(
        item: SharePicture(png: png), subject: Text(spec.title), message: Text(ShareSpec.sharePostText(spec, period)),
        preview: SharePreview(alt.isEmpty ? spec.title : alt, image: Image(uiImage: picture))
      ) {
        Label("Write a post with it", systemImage: Glyph.newPost)
      }
      .buttonStyle(.virga(.primary))
      .accessibilityIdentifier("share-write")
    } else {
      Button {
      } label: {
        Label("Write a post with it", systemImage: Glyph.newPost)
      }
      .buttonStyle(.virga(.primary))
      .disabled(true)
      .accessibilityIdentifier("share-write")
    }
  }

  /// The spec from the card and the account's notes, its description, then
  /// the picture, once the dialog is up.
  private func draw() async {
    picture = nil
    png = nil
    failed = nil
    guard let archive else {
      made = true
      return
    }
    let notes = Annotations.readAnnotations(archive.did, store: app.stores.keyValue)
    let options = ShareOptions(kind: request.kind ?? "all", rows: request.rows.map { Double($0) }, title: request.title, notes: notes)
    let drawn = ShareSpec.shareSpec(request.type, ReportArchive(archive), period, archive.nowMs, options)
    spec = drawn
    alt = drawn.map { ShareSpec.shareAltText($0) } ?? ""
    made = true
    guard let drawn else { return }
    // Let the dialog draw its first frame before the picture is made.
    await Task.yield()
    if Task.isCancelled { return }
    let image = ShareImage.render(drawn, theme: ChartImage.readShareTheme(theme.tokens))
    if let image, let data = image.pngData() {
      picture = image
      png = data
    } else {
      failed = "The picture couldn’t be made."
    }
  }

  /// Save the picture: into Photos, add-only, asking first.
  private func saveToPhotos() async {
    guard let png else { return }
    saving = true
    defer { saving = false }
    let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
    guard status == .authorized || status == .limited else {
      toasts?.push("The picture couldn’t be saved.", danger: true)
      return
    }
    do {
      try await PHPhotoLibrary.shared().performChanges {
        PHAssetCreationRequest.forAsset().addResource(with: .photo, data: png, options: nil)
      }
      toasts?.push("Saved to Photos.")
    } catch {
      toasts?.push("The picture couldn’t be saved.", danger: true)
    }
  }
}
#endif
