// Ports src/posting/composer/ComposerDialogs.jsx
// Ports src/posting/ui/GatesEditor.jsx
// Ports src/posting/ui/AltTextDialog.jsx (the writer's part)
//
// The small dialogs the composer opens: a yes-or-no question, languages
// and content labels, who can reply and quote, a video's description and
// an image's alt text. Each sits beside the composer (a sheet over its
// sheet), so closing it closes only it. The timer's (LifespanDialog) is
// LifespanDialog.swift.
//
// Alt text: describing the image for the writer needs the adviser's AI
// service (aiService.js, altTextModel.js), which isn't ported; the web
// offers no Generate button without a server requester either, which is
// how the dialog is here. Continue a thread lists the account's own
// recent posts.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaNetwork
import VirgaPosting

/// A yes-or-no question over the composer; its choices are its buttons.
struct ConfirmDialog: View {
  let ask: ComposerAsk
  let onAnswer: (String?) -> Void

  var body: some View {
    DialogFrame(title: ask.title, onClose: { onAnswer(nil) }) {
      if !ask.body.isEmpty { Text(ask.body) }
    } actions: {
      ForEach(ask.choices) { choice in
        Button(choice.label) { onAnswer(choice.value) }
          .buttonStyle(.virga(choice.primary ? .primary : choice.danger ? .danger : .quiet))
          .accessibilityIdentifier("ask-\(choice.value)")
      }
    }
  }
}

/// Languages and content labels for the whole post (every post of a thread).
struct MetaDialog: View {
  @Environment(\.virgaTheme) private var theme
  let langs: [String]
  let labels: [String]
  let onSave: ([String], [String]) -> Void
  let onClose: () -> Void
  @State private var l: [String] = []
  @State private var lab: [String] = []

  var body: some View {
    let adult = lab.first { x in ComposerLanguages.adultLabelOptions.contains { $0.value.jsEquals(x) } } ?? ""
    let graphic = lab.jsIncludes(ComposerLanguages.graphicLabel.value)
    DialogFrame(title: "Language and content labels", onClose: onClose) {
      DialogForm {
        LanguagePicker(value: $l, label: "Written in", hint: "Up to three. Bluesky uses these for people’s language filters.")
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel("Adult content")
          FieldHint("Label it if it is, so people who’d rather not see it don’t.")
            .padding(.bottom, theme.space2)
          ChoiceRow("None", isOn: choice("", adult: adult, graphic: graphic))
          ForEach(ComposerLanguages.adultLabelOptions, id: \.value) { option in
            ChoiceRow(option.label, description: option.hint, isOn: choice(option.value, adult: adult, graphic: graphic))
          }
        }
        Toggle(isOn: Binding(
          get: { graphic },
          set: { on in lab = (adult.isEmpty ? [] : [adult]) + (on ? [ComposerLanguages.graphicLabel.value] : []) })
        ) {
          Text("\(ComposerLanguages.graphicLabel.label) ")
            + Text("(\(ComposerLanguages.graphicLabel.hint.lowercased()))").foregroundColor(theme.muted)
        }
        .toggleStyle(.virgaCheck)
      }
    } actions: {
      Button("Cancel", action: onClose).buttonStyle(.virga)
      Button("Done") {
        onSave(l, lab)
        onClose()
      }
      .buttonStyle(.virga(.primary))
      .accessibilityIdentifier("meta-done")
    }
    .onAppear {
      l = langs
      lab = labels
    }
  }

  /// A radio choice: on when it's the adult label held; picking it keeps
  /// the graphic label as it was.
  private func choice(_ value: String, adult: String, graphic: Bool) -> Binding<Bool> {
    Binding(
      get: { adult.jsEquals(value) },
      set: { on in
        guard on else { return }
        lab = (value.isEmpty ? [] : [value]) + (graphic ? [ComposerLanguages.graphicLabel.value] : [])
      })
  }
}

/// Who can reply and quote, for this post only.
struct GatesDialog: View {
  let did: String
  let value: (reply: [JSONValue]?, quotes: Bool)
  let sourceLine: String
  let transport: any HTTPTransport
  let onSave: ([JSONValue]?, Bool) -> Void
  let onUseDefault: (() -> Void)?
  let onClose: () -> Void
  @State private var reply: [JSONValue]?
  @State private var quotes = true
  @State private var ready = false

  var body: some View {
    DialogFrame(title: "Who can reply and quote", onClose: onClose) {
      DialogForm {
        if !sourceLine.isEmpty { FieldHint(sourceLine) }
        if ready {
          GatesEditor(did: did, reply: $reply, quotes: $quotes, transport: transport)
        }
      }
    } actions: {
      if let onUseDefault {
        Button("Use my default", action: onUseDefault).buttonStyle(.virga(.ghost))
      }
      Button("Cancel", action: onClose).buttonStyle(.virga)
      Button("Done") {
        onSave(reply, quotes)
        onClose()
      }
      .buttonStyle(.virga(.primary))
    }
    .onAppear {
      reply = value.reply
      quotes = value.quotes
      ready = true
    }
  }
}

/// Who can reply and whether the post can be quoted. `reply` nil is
/// everyone, [] is nobody, else up to five rules.
struct GatesEditor: View {
  @Environment(\.virgaTheme) private var theme
  let did: String
  @Binding var reply: [JSONValue]?
  @Binding var quotes: Bool
  let transport: any HTTPTransport
  @State private var lists: (status: String, items: [JSONValue]) = ("idle", [])

  var body: some View {
    let replyJSON: JSONValue = reply.map(JSONValue.array) ?? .null
    let mode = GatesModel.replyMode(replyJSON)
    VStack(alignment: .leading, spacing: theme.space3) {
      FieldLabel("Who can reply")
      Segmented(
        label: "Who can reply",
        options: [
          SegmentedOption("everyone", "Anyone"), SegmentedOption("some", "Some people"),
          SegmentedOption("nobody", "Nobody"),
        ],
        selection: Binding(
          get: { mode },
          set: { next in
            guard next != mode else { return }
            // Some people starts with the two groups most people mean.
            if next == "everyone" {
              reply = nil
            } else if next == "nobody" {
              reply = []
            } else {
              let following: JSONValue = ["type": "following"]
              let mention: JSONValue = ["type": "mention"]
              reply = [following, mention]
            }
          }))
      if mode == "some" { rules(replyJSON) }
      Toggle("Allow quote posts", isOn: $quotes).toggleStyle(.virgaCheck)
    }
    .task(id: mode == "some" ? did : "") {
      guard mode == "some", lists.status == "idle" else { return }
      await readLists()
    }
  }

  private func rules(_ replyJSON: JSONValue) -> some View {
    let count = reply?.count ?? 0
    let full = count >= Gates.maxReplyRules
    let unlisted = lists.status == "loading" ? [] : GatesModel.unlistedRules(replyJSON, lists.items.compactMap { $0["uri"]?.stringValue })
    return VStack(alignment: .leading, spacing: theme.space2) {
      ForEach(GatesModel.ruleOptions, id: \.type) { option in
        check(option.label, rule: ["type": .string(option.type)], replyJSON: replyJSON, count: count, full: full)
      }
      if lists.status == "loading" { FieldHint("Looking for your lists…") }
      if lists.status == "error" { FieldHint("Couldn’t read your lists, so only the groups above can be chosen.") }
      ForEach(Array(lists.items.enumerated()), id: \.offset) { _, list in
        let name = list["name"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? "a list"
        check("Members of \(name)", rule: ["type": "list", "list": list["uri"] ?? .null], replyJSON: replyJSON, count: count, full: full)
      }
      ForEach(Array(unlisted.enumerated()), id: \.offset) { _, rule in
        let words =
          GatesModel.isForeignListRule(rule, did)
          ? "Members of a list from another account" : "Members of a list that couldn’t be found"
        check(words, rule: rule, replyJSON: replyJSON, count: count, full: full)
      }
      let note = GatesModel.rulesNote(replyJSON)
      if !note.isEmpty { FieldHint(note) }
    }
  }

  private func check(_ label: String, rule: JSONValue, replyJSON: JSONValue, count: Int, full: Bool) -> some View {
    let on = GatesModel.hasRule(replyJSON, rule)
    let last = on && count == 1
    return Toggle(label, isOn: Binding(get: { on }, set: { _ in reply = GatesModel.toggleRule(replyJSON, rule) }))
      .toggleStyle(.virgaCheck)
      .disabled(last || (!on && full))
  }

  /// The account's own curation lists, read publicly.
  private func readLists() async {
    lists = (status: "loading", items: [])
    do {
      let body = try await PublicAppView.publicXrpc(
        "app.bsky.graph.getLists", ["actor": .string(did), "limit": 50], transport: transport)
      let items = (body["lists"]?.arrayValue ?? []).filter {
        $0["purpose"] == "app.bsky.graph.defs#curatelist" && !($0["uri"]?.stringValue ?? "").isEmpty
      }
      lists = (status: "ready", items: items)
    } catch {
      lists = (status: "error", items: [])
    }
  }
}

/// A description written in a dialog: a video's, or an image's alt text.
struct DescribeDialog: View {
  @Environment(\.virgaTheme) private var theme
  let title: String
  let fieldLabel: String
  let placeholder: String
  let initial: String
  let max: Int
  /// The image described, when it is one (the alt text dialog's preview).
  let preview: String?
  /// "N of max", as altTextCount or the video's count says it.
  let countLabel: (Int) -> String
  let onSave: (String) -> Void
  let onClose: () -> Void
  @State private var text = ""

  var body: some View {
    let count = Graphemes.countGraphemes(text)
    let over = count > max
    DialogFrame(title: title, onClose: onClose) {
      DialogForm {
        if let preview {
          LocalPicture(url: preview)
            .frame(maxWidth: .infinity, maxHeight: 220)
            .clipShape(RoundedRectangle(cornerRadius: theme.radiusLg))
            .accessibilityHidden(true)
        }
        FieldStack(fieldLabel) {
          TextField(placeholder, text: $text, axis: .vertical)
            .lineLimit(5...12)
            .virgaTextArea(invalid: over, editor: false)
            .accessibilityIdentifier("describe-text")
          FieldHint(countLabel(count), isOver: over)
        }
      }
    } actions: {
      Button("Cancel", action: onClose).buttonStyle(.virga)
      Button("Save") {
        onSave(text.jsTrimmed())
        onClose()
      }
      .buttonStyle(.virga(.primary))
      .disabled(over)
      .accessibilityIdentifier("describe-save")
    }
    .onAppear { text = initial }
  }
}

extension DescribeDialog {
  /// altTextModel.js's ALT_TEXT_MAX_GRAPHEMES (the adviser's, not ported yet).
  static let altTextMax = 2000

  /// AltTextDialog, the writer's part: the image, and its description.
  static func altText(image: ComposerImage, onSave: @escaping (String) -> Void, onClose: @escaping () -> Void)
    -> DescribeDialog
  {
    DescribeDialog(
      title: "Alt text", fieldLabel: "Description",
      placeholder: "What’s in the image, and what matters about it for this post", initial: image.alt, max: altTextMax,
      preview: image.previewUrl,
      countLabel: { n in
        let over = n > altTextMax
        return "\(AppLocale.fmtInt(Double(n))) of \(AppLocale.fmtInt(Double(altTextMax)))\(over ? " · too long" : "")"
      }, onSave: onSave, onClose: onClose)
  }

  /// VideoAltDialog: what someone who can't watch it should know.
  static func videoAlt(alt: String, onSave: @escaping (String) -> Void, onClose: @escaping () -> Void) -> DescribeDialog {
    DescribeDialog(
      title: "Describe the video", fieldLabel: "What happens in it", placeholder: "", initial: alt,
      max: Video.videoAltMaxGraphemes, preview: nil, countLabel: { n in "\(n) of \(Video.videoAltMaxGraphemes)" },
      onSave: onSave, onClose: onClose)
  }
}

/// Pick one of the account's own recent posts to continue as a thread.
struct ContinueThreadDialog: View {
  @Environment(\.virgaTheme) private var theme
  let status: String
  let items: [JSONValue]
  let error: String
  let onPick: (JSONValue) -> Void
  let onRetry: () -> Void
  let onClose: () -> Void

  var body: some View {
    DialogFrame(title: "Continue a thread", onClose: onClose) {
      DialogForm {
        FieldHint("Your post will reply to the one you pick, so it reads as the next part of that thread.")
        if status == "loading" {
          VStack(alignment: .leading, spacing: theme.space3) {
            ForEach(0..<3, id: \.self) { _ in
              VStack(alignment: .leading, spacing: theme.space2) {
                Capsule().fill(theme.surface3).frame(width: 120, height: 10)
                Capsule().fill(theme.surface3).frame(height: 10)
              }
            }
          }
          .accessibilityElement()
          .accessibilityLabel("Your recent posts")
        }
        if status == "error" {
          Callout(tone: .danger) {
            VStack(alignment: .leading, spacing: theme.space2) {
              Text(error.isEmpty ? "Couldn’t read your recent posts." : error)
              Button("Try again", action: onRetry).buttonStyle(.virga(size: .small))
            }
          }
        }
        if status == "ready" && items.isEmpty {
          Text("No posts of yours to continue yet. Post something first.").foregroundStyle(theme.muted)
        }
        if status == "ready" && !items.isEmpty {
          VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
              row(item)
            }
          }
          .accessibilityElement(children: .contain)
          .accessibilityLabel("Your recent posts")
        }
      }
    } actions: {
      Button("Cancel", action: onClose).buttonStyle(.virga)
    }
  }

  private func row(_ item: JSONValue) -> some View {
    let text = item["text"]?.stringValue ?? ""
    let at = item["at"]?.stringValue ?? ""
    let when = at.isEmpty ? "" : Time.relativeTime(at, now: Date().timeIntervalSince1970 * 1000)
    return Button {
      onPick(item)
    } label: {
      VStack(alignment: .leading, spacing: theme.space1) {
        ComposerPostPreview(view: item["view"].flatMap { $0.isNull ? nil : $0 }, text: text)
        if !when.isEmpty, item["view"]?["author"] == nil {
          Text(when).virgaText(.textSm).foregroundStyle(theme.muted)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.vertical, theme.space3)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Continue the post from \(when): \(text.isEmpty ? "no text" : text)")
    .accessibilityAddTraits(.isButton)
    .accessibilityIdentifier("continue-item")
  }
}
#endif
