// Ports src/posting/composer/LanguagePicker.jsx
// Ports src/posting/composer/TagsField.jsx
// Ports src/posting/composer/PostAsPicker.jsx
// Ports src/posting/composer/PublishButton.jsx
// Ports src/posting/composer/composer.css (.lang-picker, .tags-field, .post-as, .publish-split)
//
// The composer's smaller parts: up to three languages (tokens and a search
// that suggests more), the post's tags, "Posting as" (which account the
// post goes out from, without switching the app to it) and the split send
// button (the account's usual action, and the caret's other ways).

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting
import VirgaSession

/// Up to three languages: the chosen ones as tokens, and a search field
/// that suggests more (by name or code).
struct LanguagePicker: View {
  @Environment(\.virgaTheme) private var theme
  @Binding var value: [String]
  var label = "Languages"
  var hint: String?
  var disabled = false
  @State private var query = ""
  @FocusState private var focused: Bool

  static let max = 3

  var body: some View {
    let chosen = Array(value.prefix(Self.max))
    let full = chosen.count >= Self.max
    let options =
      focused && !full
      ? ComposerLanguages.searchLanguages(
        .string(query), chosen: chosen, preferred: Locale.preferredLanguages, limit: 6) : []
    VStack(alignment: .leading, spacing: theme.space2) {
      FieldLabel(label)
      if let hint { FieldHint(hint) }
      TokenRow {
        if chosen.isEmpty { FieldHint("None chosen") }
        ForEach(chosen, id: \.self) { code in
          let name = ComposerLanguages.languageName(code)
          TokenView(name, removeLabel: "Remove \(name)") {
            value = chosen.filter { !$0.jsEquals(code) }
          }
        }
      }
      TextField(full ? "Three languages is the most a post can have" : "Add a language", text: $query)
        .virgaField()
        .focused($focused)
        .disabled(disabled || full)
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .onSubmit { add(options.first?.code, chosen: chosen) }
        .accessibilityLabel(label)
      if !options.isEmpty {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(options, id: \.code) { option in
            Button {
              add(option.code, chosen: chosen)
            } label: {
              HStack {
                Text(option.name).foregroundStyle(theme.ink)
                Spacer(minLength: 0)
                Text(option.code).virgaText(.textSm).foregroundStyle(theme.muted)
              }
              .padding(.horizontal, theme.space3)
              .frame(minHeight: Measure.Touch.target)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("language-\(option.code)")
          }
        }
        .background(theme.surface, in: RoundedRectangle(cornerRadius: theme.radiusLg))
        .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Languages")
      }
    }
  }

  private func add(_ code: String?, chosen: [String]) {
    guard let code, !chosen.jsIncludes(code), chosen.count < Self.max else { return }
    value = chosen + [code]
    query = ""
  }
}

/// The post's tags: words Bluesky files the post under without showing
/// them in the text. A comma or Return between them; a leading "#" is
/// dropped, repeats are merged, at most eight. The word being typed is the
/// composer's (`draft`), so it is committed when the field loses focus and
/// before the post goes out (`onCommit`), as the web's blur and ⌘↩ do.
struct TagsField: View {
  @Environment(\.virgaTheme) private var theme
  let tags: [String]
  @Binding var draft: String
  let disabled: Bool
  /// A phone's: the row right over it already says Tags, so the name is
  /// kept for VoiceOver only.
  var bareLabel = false
  let onCommit: () -> Void
  let onChange: ([String]) -> Void
  @FocusState private var focused: Bool

  var body: some View {
    let full = tags.count >= Tags.maxTags
    VStack(alignment: .leading, spacing: theme.points(ThemeKit.fieldGap)) {
      if !bareLabel { FieldLabel("Tags").accessibilityHidden(true) }
      FieldHint("Not shown in the post, but Bluesky files it under them. Separate them with commas; up to \(Tags.maxTags).")
      TokenRow {
        ForEach(tags, id: \.self) { tag in
          TokenView("#\(tag)", removeLabel: "Remove the tag \(tag)") {
            onChange(tags.filter { !$0.jsEquals(tag) })
          }
        }
      }
      VirgaTextField(full ? "That’s the most a post can have" : tags.isEmpty ? "gardening, repair" : "Another tag", text: $draft)
        .virgaField()
        .focused($focused)
        .disabled(disabled || full)
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .submitLabel(.done)
        .onSubmit { if !draft.jsTrimmed().isEmpty { onCommit() } }
        .onChange(of: draft) { _, next in
          if next.contains(",") { onCommit() }
        }
        .onChange(of: focused) { _, now in
          if !now && !draft.jsTrimmed().isEmpty { onCommit() }
        }
        .accessibilityLabel("Tags")
        .accessibilityIdentifier("tags-input")
    }
  }
}

/// "Posting as": which account the post goes out from, chosen from every
/// account on this device without switching the app to it. A signed-out
/// account can't be picked; it offers Sign back in. A scheduled post stays
/// with the account that scheduled it (`locked`).
struct PostAsPicker: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(SessionModel.self) private var session
  let asDid: String
  let locked: Bool
  let lockedReason: String
  let disabled: Bool
  let onChange: (String) -> Void
  @State private var open = false
  @State private var checked: [String: SessionCheckStatus] = [:]

  var body: some View {
    let accounts = session.accounts
    let current = accounts.first { $0.did.jsEquals(asDid) }
    VStack(alignment: .leading, spacing: theme.space2) {
      if accounts.count <= 1 || locked {
        byline(current)
        if locked && !lockedReason.isEmpty { FieldHint(lockedReason) }
      } else {
        Button {
          open.toggle()
        } label: {
          HStack(spacing: ComposerMeasure.postAsGap) {
            byline(current)
            Image(systemName: ComposerGlyph.chevronDown).font(.system(size: 13, weight: .semibold))
              .foregroundStyle(theme.muted)
          }
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel(buttonLabel(current))
        .accessibilityIdentifier("post-as")
        if open { list(accounts) }
      }
    }
    .task(id: open) { if open { await check(accounts) } }
  }

  private func buttonLabel(_ current: SessionAccount?) -> String {
    let name = current.map { Accounts.accountName($0) } ?? asDid
    let handle = current?.handle.map { "@\($0)" } ?? ""
    return "Posting as \(name)\(handle.isEmpty ? "" : " (\(handle))"). Change the account"
  }

  private func byline(_ current: SessionAccount?) -> some View {
    let name = current.map { Accounts.accountName($0) } ?? asDid
    let handle = current?.handle.map { "@\($0)" } ?? ""
    return HStack(spacing: ComposerMeasure.postAsGap) {
      Avatar(src: current?.avatar, name: name, size: .small)
      VStack(alignment: .leading, spacing: 0) {
        Text("Posting as").virgaText(.textXs).foregroundStyle(theme.muted)
        HStack(spacing: theme.space1) {
          Text(name).virgaText(.textSm, weight: VirgaWeight.semibold).foregroundStyle(theme.ink)
          if !handle.isEmpty && name != handle {
            Text(handle).virgaText(.textSm).foregroundStyle(theme.muted).lineLimit(1)
          }
        }
      }
    }
  }

  /// Opening checks the other accounts' sessions, so a dead one shows as
  /// signed out before anyone picks it.
  private func check(_ accounts: [SessionAccount]) async {
    for account in accounts where !Optional(account.did).jsEquals(session.did) && account.status != .needsSignIn {
      let verdict = await session.checkAccount(account.did)
      checked[account.did] = verdict
    }
  }

  private func list(_ accounts: [SessionAccount]) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("The post, its draft or its schedule goes to the account you choose. The rest of Virga stays as it is.")
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
        .padding(theme.space3)
      ForEach(accounts, id: \.did) { account in
        row(account)
        Rectangle().fill(theme.line).frame(height: 1)
      }
    }
    .background(theme.surface, in: RoundedRectangle(cornerRadius: theme.radiusLg))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line))
    .accessibilityIdentifier("post-as-list")
  }

  private func row(_ account: SessionAccount) -> some View {
    let out = account.status == .needsSignIn || checked[account.did] == .expired
    let selected = account.did.jsEquals(asDid)
    let label = Accounts.accountName(account)
    var meta = account.handle.map { "@\($0)" } ?? account.did
    if Optional(account.did).jsEquals(session.did) { meta += " · open in Virga" }
    if out {
      meta += " · signed out"
    } else if account.status == .unknown || checked[account.did] == .unknown {
      meta += " · couldn’t check"
    }
    return HStack(spacing: theme.space2) {
      Button {
        open = false
        if !selected { onChange(account.did) }
      } label: {
        HStack(spacing: theme.space2) {
          Avatar(src: account.avatar, name: label, size: .small)
          VStack(alignment: .leading, spacing: 0) {
            Text(label).virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
            Text(meta).virgaText(.textSm).foregroundStyle(theme.muted)
          }
          Spacer(minLength: 0)
          if selected { Image(systemName: ComposerGlyph.check).foregroundStyle(theme.ink) }
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .disabled(out)
      .accessibilityAddTraits(selected ? .isSelected : [])
      if out {
        Button {
          AccountCopy.requestReauth(account.did, immediate: true)
        } label: {
          Label("Sign back in", systemImage: ComposerGlyph.signIn)
        }
        .buttonStyle(.virga(size: .small))
        .accessibilityLabel("Sign back in as \(label)")
      }
    }
    .padding(.horizontal, theme.space3)
    .frame(minHeight: Measure.Touch.target)
  }
}

/// The split button: the primary half runs the account's usual action (or
/// Save as draft for a post over the limit), and the caret lists the other
/// ways, with the reason under any that can't run here. `also` names the
/// ways that have a button of their own beside it, which the caret leaves
/// out; with nothing left to list there is no caret.
struct PublishButton: View {
  @Environment(\.virgaTheme) private var theme
  let state: ComposerState
  let model: ComposerActionSet
  let busy: Bool
  let also: [String]
  /// SCHEDULE: the allowance in use, at the foot of the menu (`footnote`).
  var footnote = ""
  let onAction: (String) -> Void

  static let order = [PublishActions.post, PublishActions.schedule, PublishActions.queue, PublishActions.draft]
  static let menuLabel = [
    PublishActions.post: "Post now", PublishActions.schedule: "Schedule…", PublishActions.queue: "Add to queue",
    PublishActions.draft: "Save as draft",
  ]

  static func icon(_ action: String) -> String {
    switch action {
    case PublishActions.schedule: return ComposerGlyph.schedule
    case PublishActions.queue: return ComposerGlyph.queue
    case PublishActions.draft: return ComposerGlyph.draft
    default: return ComposerGlyph.post
    }
  }

  var body: some View {
    let primary = model.primary
    let p = model.actions[primary]
    let listed = Self.order.filter { $0 != primary && !also.contains($0) }
    let caretOff = listed.allSatisfy { model.actions[$0].disabled }
    HStack(spacing: 1) {
      Button {
        onAction(primary)
      } label: {
        Label(busy ? "Working…" : ComposerActions.actionLabel(primary, state, short: true), systemImage: Self.icon(primary))
          .frame(minWidth: ComposerMeasure.publishMinWidth)
      }
      .buttonStyle(.virga(.primary))
      .disabled(busy || p.disabled)
      .accessibilityHint(p.disabled ? (p.reason ?? "") : "")
      .accessibilityIdentifier("publish")
      .keyboardShortcut(.return, modifiers: .command)
      if !listed.isEmpty {
        Menu {
          ForEach(listed, id: \.self) { action in
            item(action, primaryReason: p.disabled ? p.reason : nil)
          }
          if !footnote.isEmpty {
            Text(footnote)
          }
        } label: {
          let side = theme.points(ThemeKit.touchButtonHeight)
          Image(systemName: ComposerGlyph.chevronDown)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(theme.onBtn)
            .frame(width: side, height: side)
            .background(theme.btn, in: Circle())
            .contentShape(Circle())
        }
        .menuOrder(.fixed)
        .disabled(busy || caretOff)
        .opacity(busy || caretOff ? 0.45 : 1)
        .accessibilityLabel("More ways to send it")
        .accessibilityIdentifier("publish-more")
      }
    }
  }

  @ViewBuilder
  private func item(_ action: String, primaryReason: String?) -> some View {
    let a = model.actions[action]
    let hint = a.disabled && !(a.reason ?? "").isEmpty && a.reason != primaryReason ? a.reason : nil
    Button {
      onAction(action)
    } label: {
      Label(Self.menuLabel[action] ?? action, systemImage: Self.icon(action))
      if let hint { Text(hint) }
    }
    .disabled(a.disabled)
  }
}
#endif
