// Ports src/posting/composer/EmbedCards.jsx
// Ports src/posting/composer/ReplyContext.jsx
// Ports src/posting/ui/PostPreview.jsx (compact: who wrote it and its words)
// Ports src/posting/composer/composer.css (.embed-card, .link-thumb, .reply-context)
//
// What a post quotes or attaches (a post, a feed, a list or a starter
// pack), its link card (image, title, description, site, with edit and
// remove) and the dialog that edits the card; and "Replying to @x" above
// the editor. PostPreview's model (postPreview.js) isn't ported yet, so a
// post here is its author and its words, one block, the compact form.

#if canImport(UIKit)
import PhotosUI
import SwiftUI
import VirgaCore
import VirgaNetwork
import VirgaPosting

/// A picture at a web address, read through the session's transport (so
/// the demo's made-up pages have pictures too). Nothing while it loads, or
/// when it won't: a page image that won't load is left out.
struct TransportImage: View {
  let url: String
  let transport: any HTTPTransport
  @State private var image: UIImage?
  @State private var failed = false

  var body: some View {
    Group {
      if let image {
        Image(uiImage: image).resizable().scaledToFill()
      } else {
        Color.clear
      }
    }
    .task(id: url) {
      if url.hasPrefix("file:"), let parsed = URL(string: url) {
        image = UIImage(contentsOfFile: parsed.path)
        return
      }
      guard let response = try? await transport.send(HTTPRequest(url: url, timeoutMs: 10_000)),
        (200..<300).contains(response.status), let made = UIImage(data: response.body)
      else { return }
      image = made
    }
  }
}

/// A post, small: who wrote it and its words (PostPreview, compact).
struct ComposerPostPreview: View {
  @Environment(\.virgaTheme) private var theme
  let view: JSONValue?
  let text: String?

  var body: some View {
    let author = view?["author"]
    let handle = author?["handle"]?.stringValue
    let display = author?["displayName"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
    let name = display ?? handle.map { "@\($0)" }
    let words = view?["record"]?["text"]?.stringValue ?? text ?? ""
    VStack(alignment: .leading, spacing: theme.space1) {
      if let name {
        HStack(spacing: theme.space2) {
          Avatar(src: author?["avatar"]?.stringValue, name: name, size: .small)
          Text(name).virgaText(.textSm, weight: VirgaWeight.semibold).foregroundStyle(theme.ink)
          if let handle, display != nil {
            Text("@\(handle)").virgaText(.textSm).foregroundStyle(theme.muted).lineLimit(1)
          }
        }
      }
      Text(words.isEmpty ? "No text" : words)
        .virgaText(.textSm)
        .foregroundStyle(words.isEmpty ? theme.muted : theme.ink2)
        .lineLimit(3)
    }
    .accessibilityElement(children: .combine)
  }
}

struct RecordCard: View {
  @Environment(\.virgaTheme) private var theme
  let record: ComposerRecord
  let disabled: Bool
  let onRemove: () -> Void

  static let listPurpose = [
    "app.bsky.graph.defs#modlist": "Moderation list", "app.bsky.graph.defs#curatelist": "List",
    "app.bsky.graph.defs#referencelist": "List",
  ]

  var body: some View {
    HStack(alignment: .top, spacing: ComposerMeasure.embedGap) {
      if record.kind == "post" {
        if let view = record.view {
          ComposerPostPreview(view: view, text: nil)
        } else {
          FieldHint("A post (\(record.uri))")
        }
      } else {
        other
      }
      Spacer(minLength: 0)
      Button(action: onRemove) { Image(systemName: ComposerGlyph.close) }
        .buttonStyle(.virga(.ghost, size: .small, icon: true))
        .disabled(disabled)
        .accessibilityLabel("Remove the attachment")
    }
    .padding(ComposerMeasure.embedPadding)
    .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line))
  }

  private var other: some View {
    let view = record.view
    let icon = record.kind == "feed" ? ComposerGlyph.feed : record.kind == "starterpack" ? ComposerGlyph.people : ComposerGlyph.list
    let name =
      [view?["displayName"], view?["name"], view?["record"]?["name"]].compactMap { $0?.stringValue }.first { !$0.isEmpty }
      ?? "Untitled"
    let by = view?["creator"]?["handle"]?.stringValue.map { "@\($0)" }
    let kindWord =
      record.kind == "feed"
      ? "Feed" : record.kind == "starterpack" ? "Starter pack" : (Self.listPurpose[view?["purpose"]?.stringValue ?? ""] ?? "List")
    let about = [view?["description"], view?["record"]?["description"]].compactMap { $0?.stringValue }.first { !$0.isEmpty } ?? ""
    return HStack(alignment: .top, spacing: ComposerMeasure.embedGap) {
      Image(systemName: icon)
        .frame(width: 36, height: 36)
        .background(theme.surface3, in: RoundedRectangle(cornerRadius: theme.radius))
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text(name).virgaText(.textBase, weight: VirgaWeight.semibold).foregroundStyle(theme.ink)
        Text("\(kindWord)\(by.map { " by \($0)" } ?? "")").virgaText(.textSm).foregroundStyle(theme.muted)
        if !about.isEmpty {
          Text(Graphemes.truncateGraphemes(about, 140)).virgaText(.textSm).foregroundStyle(theme.ink2)
        }
      }
    }
  }
}

/// The site a card's address is on, without "www.".
func composerHostOf(_ url: String) -> String {
  guard let host = URLComponents(string: url)?.host, !host.isEmpty else { return url }
  return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
}

struct LinkCardView: View {
  @Environment(\.virgaTheme) private var theme
  let card: ComposerCard?
  let loading: Bool
  let disabled: Bool
  let transport: any HTTPTransport
  let onEdit: () -> Void
  let onRemove: () -> Void

  var body: some View {
    if loading {
      HStack(spacing: ComposerMeasure.embedGap) {
        RoundedRectangle(cornerRadius: theme.radius).fill(theme.surface3)
          .frame(width: ComposerMeasure.thumb, height: ComposerMeasure.thumb)
        VStack(alignment: .leading, spacing: theme.space2) {
          Capsule().fill(theme.surface3).frame(height: 10)
          Capsule().fill(theme.surface3).frame(width: 120, height: 10)
        }
      }
      .padding(ComposerMeasure.embedPadding)
      .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line))
      .accessibilityElement()
      .accessibilityLabel("Reading the link")
    } else if let card {
      cardBody(card)
    }
  }

  private func cardBody(_ card: ComposerCard) -> some View {
    HStack(alignment: .top, spacing: ComposerMeasure.embedGap) {
      // A page with no image has no picture column.
      if let thumb = card.thumb, !thumb.isEmpty {
        TransportImage(url: thumb, transport: transport)
          .frame(width: ComposerMeasure.thumb, height: ComposerMeasure.thumb)
          .background(theme.surface3)
          .clipShape(RoundedRectangle(cornerRadius: theme.radius))
          .accessibilityHidden(true)
      }
      VStack(alignment: .leading, spacing: 2) {
        Text(card.title.isEmpty ? composerHostOf(card.url) : card.title)
          .virgaText(.textBase, weight: VirgaWeight.semibold).foregroundStyle(theme.ink)
        if !card.description.isEmpty {
          Text(Graphemes.truncateGraphemes(card.description, 160)).virgaText(.textSm).foregroundStyle(theme.ink2)
        }
        Text(composerHostOf(card.url)).virgaText(.textSm).foregroundStyle(theme.muted)
      }
      Spacer(minLength: 0)
      HStack(spacing: 0) {
        Button(action: onEdit) { Image(systemName: ComposerGlyph.edit) }
          .buttonStyle(.virga(.ghost, size: .small, icon: true))
          .disabled(disabled)
          .accessibilityLabel("Edit the link card")
        Button(action: onRemove) { Image(systemName: ComposerGlyph.close) }
          .buttonStyle(.virga(.ghost, size: .small, icon: true))
          .disabled(disabled)
          .accessibilityLabel("Remove the link card")
      }
    }
    .padding(ComposerMeasure.embedPadding)
    .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line))
    .accessibilityIdentifier("link-card")
  }
}

/// Change a link card's title (up to 200 characters), description (up to
/// 500) and image. A new image is shrunk to the card's size and stripped of
/// its metadata before it's kept.
struct LinkCardDialog: View {
  @Environment(\.virgaTheme) private var theme
  let card: ComposerCard
  let transport: any HTTPTransport
  let onSave: (ComposerCard) -> Void
  let onClose: () -> Void
  @State private var title = ""
  @State private var description = ""
  @State private var thumb: (url: String?, file: ComposerFile?, removed: Bool) = (nil, nil, false)
  @State private var busy = false
  @State private var error = ""
  @State private var pick: PhotosPickerItem?

  var body: some View {
    let titleCount = Graphemes.countGraphemes(title)
    let descCount = Graphemes.countGraphemes(description)
    let over = titleCount > ComposerLinkCards.titleMax || descCount > ComposerLinkCards.descriptionMax
    DialogFrame(title: "Edit the link card", onClose: onClose) {
      DialogForm {
        FieldHint(card.url)
        FieldStack("Title") {
          TextField("", text: $title).virgaField(invalid: titleCount > ComposerLinkCards.titleMax)
          FieldHint("\(titleCount) of \(ComposerLinkCards.titleMax)", isOver: titleCount > ComposerLinkCards.titleMax)
        }
        FieldStack("Description") {
          TextField("", text: $description, axis: .vertical).lineLimit(3...6)
            .virgaTextArea(invalid: descCount > ComposerLinkCards.descriptionMax)
          FieldHint("\(descCount) of \(ComposerLinkCards.descriptionMax)", isOver: descCount > ComposerLinkCards.descriptionMax)
        }
        imageField
        if !error.isEmpty {
          Callout(tone: .danger) { Text(error) }
        }
      }
    } actions: {
      Button("Cancel", action: onClose).buttonStyle(.virga)
      Button("Save card") { save() }
        .buttonStyle(.virga(.primary))
        .disabled(busy || over)
    }
    .onAppear {
      title = card.title
      description = card.description
      thumb = (card.thumb, card.thumbFile, false)
    }
    .onChange(of: pick) { _, item in
      guard let item else { return }
      pick = nil
      Task { await choose(item) }
    }
  }

  private var imageField: some View {
    FieldStack("Image") {
      HStack(alignment: .top, spacing: ComposerMeasure.embedGap) {
        Group {
          if let url = thumb.url, !thumb.removed {
            TransportImage(url: url, transport: transport).accessibilityLabel("The card’s image")
          } else {
            Text("No image").virgaText(.textSm).foregroundStyle(theme.muted)
          }
        }
        .frame(width: ComposerMeasure.thumbLarge, height: ComposerMeasure.thumbLarge * 0.6)
        .background(theme.surface3)
        .clipShape(RoundedRectangle(cornerRadius: theme.radius))
        VStack(alignment: .leading, spacing: theme.space2) {
          PhotosPicker(selection: $pick, matching: .images) {
            Text(busy ? "Preparing…" : "Choose an image")
          }
          .buttonStyle(.virga(size: .small))
          .disabled(busy)
          if thumb.url != nil && !thumb.removed {
            Button("Remove the image") { thumb.removed = true }
              .buttonStyle(.linkAction)
          }
        }
      }
    }
  }

  private func choose(_ item: PhotosPickerItem) async {
    busy = true
    error = ""
    defer { busy = false }
    do {
      guard let file = try await PickedMedia.file(item) else { throw ImageProcessingError("That image couldn’t be used.", code: "IMAGE_PROCESSING_FAILED") }
      let prepared = try await Images.prepareImage(file, budget: Images.cardThumbBudget, encoder: ImageIOEncoder())
      let url = prepared.file.ref.map { URL(fileURLWithPath: $0).absoluteString }
      thumb = (url, prepared.file, false)
    } catch {
      self.error = ComposerController.optionalMessage(error) ?? "That image couldn’t be used."
    }
  }

  private func save() {
    var next = card.json.objectValue ?? [:]
    next["title"] = .string(title.jsTrimmed())
    next["description"] = .string(description.jsTrimmed())
    next["edited"] = true
    if thumb.removed {
      next["thumb"] = .null
      for key in ["thumbFile", "thumbBlob", "thumbBlobDid"] { next[key] = nil }
    } else if let file = thumb.file, file != card.thumbFile {
      next["thumb"] = thumb.url.map(JSONValue.string) ?? .null
      next["thumbFile"] = file.json
      for key in ["thumbBlob", "thumbBlobDid"] { next[key] = nil }
    }
    onSave(ComposerCard(json: .object(next)))
    onClose()
  }
}

/// "Replying to @x" above the editor, with the post being answered.
struct ReplyContext: View {
  @Environment(\.virgaTheme) private var theme
  let reply: ComposerReply?
  let selfDid: String
  let loading: Bool
  let error: String
  let disabled: Bool
  let onRetry: () -> Void
  let onRemove: () -> Void

  var body: some View {
    if loading {
      VStack(alignment: .leading, spacing: ComposerMeasure.replyGap) {
        line("Replying to…")
        Capsule().fill(theme.surface3).frame(width: 140, height: 10)
        Capsule().fill(theme.surface3).frame(height: 10)
      }
      .accessibilityElement(children: .combine)
      .accessibilityLabel("Replying to")
    } else if !error.isEmpty {
      Callout(tone: .danger) {
        VStack(alignment: .leading, spacing: theme.space2) {
          Text(error)
          HStack(spacing: theme.space2) {
            Button(action: onRetry) { Label("Try again", systemImage: ComposerGlyph.retry) }
              .buttonStyle(.virga(size: .small))
            Button("Post it on its own", action: onRemove).buttonStyle(.virga(.ghost, size: .small))
          }
        }
      }
    } else if let reply {
      replying(reply)
    }
  }

  private func line(_ text: String) -> some View {
    Label(text, systemImage: ComposerGlyph.replyingTo)
      .virgaText(.textSm, weight: VirgaWeight.medium)
      .foregroundStyle(theme.muted)
  }

  private func replying(_ reply: ComposerReply) -> some View {
    let handle = reply.author?["handle"]?.stringValue
    let who = handle.map { "@\($0)" } ?? "a post"
    let own = reply.author?["did"]?.stringValue.map { $0.jsEquals(selfDid) } ?? false
    return VStack(alignment: .leading, spacing: ComposerMeasure.replyGap) {
      HStack {
        line(own ? "Continuing your thread" : "Replying to \(who)")
        Spacer(minLength: 0)
        Button(action: onRemove) { Label("Don’t reply", systemImage: ComposerGlyph.close) }
          .buttonStyle(.virga(.ghost, size: .small))
          .disabled(disabled)
          .accessibilityLabel("Don’t reply: make this a new post")
      }
      ComposerPostPreview(view: reply.view, text: reply.text)
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Replying to \(who)")
  }
}
#endif
