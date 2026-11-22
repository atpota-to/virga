// Ports src/posting/ui/AltTextDialog.jsx (describing and revising)
// Ports src/posting/ui/adviser.css (.alt-dialog, .alt-kind, .alt-revise, .alt-chips, .alt-field-head, .alt-field-foot, .alt-revise-row, .alt-disclosure)
//
// Describe an image for people who can't see it. The words are always the
// writer's to write and to save. With the posting account's requester
// (only for an account with a long session that can use AI) it can also
// describe the image itself (what kind of image it is, if the writer says,
// and Describe it for me) and revise the description from quick notes and
// a note of the writer's own (Revise); Undo takes the last answer back.
// The post's text goes along so the description fits the post. Without a
// requester it is the composer's own dialog (DescribeDialog.altText).
// Over VirgaPosting's AIService, AltTextModel and AltTextFollowUp; the
// image's bytes are the composer's prepared file. ⌘↩ saves.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting

struct AltTextDialog: View {
  @Environment(\.virgaTheme) private var theme
  let image: ComposerImage
  let requester: (any AIRequester)?
  let did: String?
  let context: String
  let store: (any KeyValueStore)?
  let onSave: (String) -> Void
  let onClose: () -> Void

  @State private var alt = ""
  @State private var kind: String?
  @State private var selected: [String] = []
  @State private var note = ""
  /// 'describe' | 'revise' while it waits.
  @State private var pending: String?
  @State private var error = ""
  @State private var limited = false
  @State private var undo: String?
  @State private var rankedAgainst = ""
  @State private var lastAsked: [String] = []
  @State private var described = false
  @State private var run = 0
  @FocusState private var noteFocused: Bool

  var body: some View {
    let canGenerate = requester != nil && (image.file != nil || image.previewUrl != nil)
    let hasText = !alt.jsTrimmed().isEmpty
    let canRevise = canGenerate && (described || hasText)
    let count = AltTextModel.altTextCount(alt)
    let now = SyncStatus.now()
    let usageLine =
      canGenerate
      ? AltTextModel.altTextUsageLine(AdviserUsageStore.readAdviserUsage(did, feature: .altText, now: now, store: store), now: now) : ""
    let postText = context
    DialogFrame(title: "Alt text", onClose: onClose, hasActions: true) {
      VStack(alignment: .leading, spacing: Measure.Adviser.dialogBodyGap) {
        if let preview = image.previewUrl {
          LocalPicture(url: preview)
            .frame(maxWidth: .infinity, maxHeight: theme.isPhone ? Measure.Adviser.phoneAltPreviewMax : Measure.Adviser.altPreviewMax)
            .clipShape(RoundedRectangle(cornerRadius: theme.radiusLg))
            .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line, lineWidth: 1))
            .accessibilityHidden(true)
        }
        if canGenerate && !canRevise { kindChoice }
        description(count: count, canGenerate: canGenerate, canRevise: canRevise)
        if limited {
          Callout(tone: .warn) {
            Text(
              "\(usageLine.isEmpty ? "This month’s free descriptions are used up. They start again on the first of the month." : usageLine) You can still write it yourself."
            )
          }
        }
        if !error.isEmpty {
          Callout(tone: .danger) { Text(error) }
        }
        if canRevise { revise }
        if canGenerate {
          Text(
            "\(usageLine.isEmpty ? "" : "\(usageLine) ")Describing sends the image\(postText.jsTrimmed().isEmpty ? "" : " and the post’s text") to Virga’s server, which asks an AI model. Check the words before you save them."
          )
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .fixedSize(horizontal: false, vertical: true)
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("alt-dialog")
    } actions: {
      Button("Cancel", action: onClose).buttonStyle(.virga)
      Button("Save") { save(count) }
        .buttonStyle(.virga(.primary))
        .disabled(count.over || pending != nil)
        .keyboardShortcut(.return, modifiers: .command)
        .accessibilityIdentifier("describe-save")
    }
    .onAppear {
      alt = image.alt
      rankedAgainst = image.alt
    }
    .onDisappear { run += 1 }
  }

  /// What kind of image it is, before a first description.
  private var kindChoice: some View {
    let kinds = AltTextFollowUp.altTextImageKinds
    return VStack(alignment: .leading, spacing: Measure.Adviser.altGroupGap) {
      (Text("What kind of image is it? ") + Text("Optional").foregroundColor(theme.muted).fontWeight(.regular))
        .virgaText(size: theme.points(ThemeKit.fieldLabelFontSize), weight: ThemeKit.fieldLabelWeight)
        .foregroundStyle(theme.ink)
      FlowLayout(spacing: Measure.Adviser.altChipsGap, lineSpacing: Measure.Adviser.altChipsGap) {
        ForEach(kinds, id: \.id) { k in
          Button(k.label) { kind = kind == k.id ? nil : k.id }
            .buttonStyle(ChipStyle(isOn: kind == k.id))
            .disabled(pending != nil)
            .accessibilityAddTraits(kind == k.id ? .isSelected : [])
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel("What kind of image is it?")
      if let hint = kinds.first(where: { $0.id == kind })?.hint, !hint.isEmpty {
        FieldHint(hint)
      }
    }
  }

  private func description(count: AltTextCount, canGenerate: Bool, canRevise: Bool) -> some View {
    let busyLine =
      pending == "describe"
      ? "Describing the image…" : pending == "revise" ? "\(AltTextModel.revisingLine(selected, note))…" : ""
    return VStack(alignment: .leading, spacing: theme.points(ThemeKit.fieldGap)) {
      HStack(spacing: Measure.Adviser.altChipsGap) {
        FieldLabel("Description")
        Spacer(minLength: 0)
        if let undo, pending == nil {
          Button {
            alt = undo
            rankedAgainst = undo
            lastAsked = []
            self.undo = nil
          } label: {
            Label("Undo", systemImage: ToolGlyph.undo)
          }
          .buttonStyle(.virga(.ghost, size: .small))
        }
        if canGenerate && !canRevise {
          Button {
            Task { await generate("describe") }
          } label: {
            Label(pending == "describe" ? "Describing…" : "Describe it for me", systemImage: AdviserGlyph.sparkles)
          }
          .buttonStyle(.virga(size: .small))
          .disabled(pending != nil)
          .accessibilityIdentifier("alt-describe")
        }
      }
      .frame(minHeight: Measure.Adviser.tallyHeight)
      TextField(
        "What’s in the image, and what matters about it for this post",
        text: Binding(
          get: { alt },
          set: { next in
            alt = next
            // An edit is the writer's own; undoing past it would throw it away.
            if undo != nil { undo = nil }
          }),
        axis: .vertical
      )
      .lineLimit(5...12)
      .frame(minHeight: Measure.Adviser.altTextMin, alignment: .topLeading)
      .virgaTextArea(invalid: count.over, editor: false)
      .foregroundStyle(pending != nil ? theme.muted : theme.ink)
      .disabled(pending != nil)
      .accessibilityLabel("Description")
      .accessibilityIdentifier("describe-text")
      FlowLayout(spacing: theme.space3, lineSpacing: theme.space1) {
        FieldHint("\(count.label)\(count.over ? " · too long" : "")", isOver: count.over)
        if !busyLine.isEmpty {
          FieldHint(busyLine).accessibilityAddTraits(.updatesFrequently)
        }
      }
    }
  }

  /// `Revise it`: the quick notes (ranked against the description), It’s a…,
  /// the note, and Revise.
  private var revise: some View {
    let ranked = AltTextFollowUp.rankQuickNotes(text: rankedAgainst, kind: kind, lastAsked: lastAsked)
    var ids = ranked.map(\.id)
    for id in selected where !ids.contains(id) { ids.append(id) }
    let offered = ids.compactMap { id in AltTextFollowUp.altTextQuickNotes.first { $0.id == id } }
    let noteMax = AltTextFollowUp.altTextNoteMax
    let field = TextField("What should change? For example: it’s my dog, Juniper", text: $note)
      .virgaField()
      .focused($noteFocused)
      .disabled(pending != nil)
      .onChange(of: note) { _, next in if next.utf16.count > noteMax { note = next.jsSlice(0, noteMax) } }
      .onSubmit { Task { await generate("revise") } }
      .accessibilityLabel("What should change")
    let go = Button {
      Task { await generate("revise") }
    } label: {
      Label(pending == "revise" ? "Revising…" : "Revise", systemImage: AdviserGlyph.sparkles)
    }
    .buttonStyle(.virga)
    .disabled(pending != nil || !AltTextFollowUp.hasFollowUpDraft(selected, note))
    .accessibilityIdentifier("alt-revise")
    return VStack(alignment: .leading, spacing: Measure.Adviser.altGroupGap) {
      FieldLabel("Revise it").accessibilityAddTraits(.isHeader)
      FlowLayout(spacing: Measure.Adviser.altChipsGap, lineSpacing: Measure.Adviser.altChipsGap) {
        ForEach(offered, id: \.id) { n in
          Button(n.label) { selected = AltTextFollowUp.toggleQuickNote(selected, n.id) }
            .buttonStyle(ChipStyle(isOn: selected.contains(n.id)))
            .disabled(pending != nil)
            .accessibilityAddTraits(selected.contains(n.id) ? .isSelected : [])
        }
        Button("It’s a…") {
          note = AltTextFollowUp.appendItsA(note)
          noteFocused = true
        }
        .buttonStyle(ChipStyle(isOn: false))
        .disabled(pending != nil)
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Quick notes")
      if theme.isPhone {
        VStack(alignment: .leading, spacing: Measure.Adviser.altGroupGap) {
          field
          go
        }
      } else {
        HStack(spacing: Measure.Adviser.altGroupGap) {
          field
          go
        }
      }
    }
    .padding(.top, Measure.Adviser.altReviseTop)
    .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
  }

  private func generate(_ mode: String) async {
    guard requester != nil, pending == nil,
      let request = AltTextModel.altGenerationRequest(
        mode: mode, alt: .string(alt), selected: selected, note: note, kind: kind.map(JSONValue.string), context: .string(context))
    else { return }
    run += 1
    let id = run
    let before = alt
    pending = mode
    error = ""
    limited = false
    defer { if id == run { pending = nil } }
    do {
      let generated = try await AIService.generateAltTextForFile(
        requester, image.file ?? previewFile(), read: Self.readBytes, payload: request.json, store: store)
      if id != run { return }
      guard let next = AltTextModel.afterGeneration(before: before, generated: .string(generated), mode: mode, selected: selected) else {
        error = "The description came back empty. Try again, or write your own."
        return
      }
      alt = next.alt
      undo = next.undo
      rankedAgainst = next.rankedAgainst
      lastAsked = next.lastAsked
      described = true
      if mode == "revise" {
        selected = []
        note = ""
      }
    } catch {
      if id != run { return }
      if let failed = error as? AIServiceError, failed.code?.stringValue == "monthly_limit" {
        limited = true
      } else {
        let said = (error as? LocalizedError)?.errorDescription ?? ""
        self.error = said.isEmpty ? "The image couldn’t be described. Try again, or write your own." : said
      }
    }
  }

  /// The image as a file, from its preview when the composer kept no file.
  private func previewFile() -> ComposerFile? {
    guard let preview = image.previewUrl else { return nil }
    let path = URL(string: preview)?.isFileURL == true ? URL(string: preview)!.path : preview
    return ComposerFile(json: ["$file": true, "name": "image", "type": "image/jpeg", "size": 0, "ref": .string(path)])
  }

  /// The prepared file's bytes (`blob.arrayBuffer()`).
  static let readBytes: @Sendable (ComposerFile) async throws -> Data = { file in
    guard let ref = file.ref else { throw AIServiceErrorBuilder.noImage }
    let url = URL(string: ref)?.isFileURL == true ? URL(string: ref)! : URL(fileURLWithPath: ref)
    return try Data(contentsOf: url)
  }

  private func save(_ count: AltTextCount) {
    if count.over { return }
    onSave(alt.jsTrimmed())
    onClose()
  }
}

/// The error a file with no bytes gives (`There’s no image to describe.`).
enum AIServiceErrorBuilder {
  struct NoImage: LocalizedError {
    var errorDescription: String? { "There’s no image to describe." }
  }

  static let noImage = NoImage()
}
#endif
