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
import Combine
import SwiftUI
import UIKit
import VirgaCore
import VirgaPosting
import VirgaSession

/// Up to three languages: the chosen ones as tokens, and a search field
/// that suggests more (by name or code). The suggestions open as the field
/// takes focus or is typed in, and close once one is added; a press on the
/// field asks for them too, as the web's click does, even while the field
/// already has the keyboard (KeyTextField's onPress).
/// They float over whatever follows the field, as the web's `.lang-search
/// .suggest-list` does, so nothing moves: whoever holds the picker draws it
/// over its later siblings (`.zIndex(1)`), as the composer's Language and
/// content labels and the Languages row in Settings do. The list is at most
/// 16rem tall and scrolls inside past that.
/// `bare` is for a place that already says what this is (a row in Settings):
/// the label is VoiceOver's alone, not drawn, and there is no hint.
///
/// On a hardware keyboard the field is a combobox, as the web's is
/// (LanguagePickerKeys): the first suggestion is highlighted as the list
/// opens and after each keystroke, ↓ and ↑ move the highlight round the
/// list, Return adds the highlighted one (the phone's Return too, which is
/// always the first) and Escape puts the list away. While the list shows,
/// the field (KeyTextField, a UIKit text field) hands those four keys to
/// the picker before its own use of them, as onKeyDown's preventDefault
/// does; with no list they are the field's. Return never ends the field's
/// editing, as the web's Enter leaves the caret in the field. VoiceOver
/// hears the highlighted one as selected, and its name as the arrows reach
/// it (the web's aria-activedescendant).
///
/// Where the scroll view holding the picker lends its scroller
/// (`composerScrolling()`: Settings' pages and the composer's Language
/// dialog), the list is brought into view as the composer's "@" list is
/// (ComposerReveals): as it opens, as its rows change and once the keyboard
/// is up, by the least the scroll can move, so not at all while it shows in
/// full. On an iPhone the keyboard would otherwise cover it under a field
/// low on the page.
struct LanguagePicker: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.composerScroller) private var scroller
  @Binding var value: [String]
  var label = "Languages"
  var hint: String?
  var disabled = false
  var bare = false
  @State private var query = ""
  @State private var open = false
  /// The suggestion the arrows are on (the web's `active`), the first to start with.
  @State private var active = 0
  /// The query is being cleared by an add, not typed: it doesn't reopen the list.
  @State private var clearing = false
  /// Whether the field has the keyboard, as the field says it (KeyTextField).
  @State private var focused = false

  static let max = 3
  /// The list's place in the scroll view that holds the picker.
  static let listAnchor = "language-suggestions"

  var body: some View {
    let chosen = Array(value.prefix(Self.max))
    let full = chosen.count >= Self.max
    let options = shown(chosen: chosen)
    VStack(alignment: .leading, spacing: theme.space2) {
      if !bare {
        FieldLabel(label)
        if let hint { FieldHint(hint) }
      }
      TokenRow {
        if chosen.isEmpty { FieldHint("None chosen") }
        ForEach(chosen, id: \.self) { code in
          let name = ComposerLanguages.languageName(code)
          TokenView(name, removeLabel: "Remove \(name)") {
            value = chosen.filter { !$0.jsEquals(code) }
          }
        }
      }
      KeyTextField(
        full ? "Three languages is the most a post can have" : "Add a language", text: $query, focused: $focused,
        label: label, keys: options.isEmpty ? [] : FieldKey.all, onPress: { open = true }
      ) { key in
        // The picker as it is at the key, not as it was last drawn.
        let now = Array(value.prefix(Self.max))
        return press(Self.pickerKey(key), options: shown(chosen: now), chosen: now)
      }
      .virgaField(focused: focused)
      .disabled(disabled || full)
      .onChange(of: focused) { _, now in
        if now {
          open = true
        } else {
          Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(ComposerMeasure.languagesCloseDelay * 1_000_000_000))
            if !focused { open = false }
          }
        }
      }
      .onChange(of: query) { _, _ in
        if clearing {
          clearing = false
        } else {
          open = true
          active = 0
        }
      }
      // `.lang-search .suggest-list`: out of the flow (position:
      // absolute), 4 under the field and as wide, over what follows. It
      // hangs from a line of no height at the field's foot: the line sits
      // on the field's bottom, the list's top on the line. An alignment
      // guide setting the list's foot above its top wasn't honoured (run
      // 94 drew the list over the field, its foot on the field's foot).
      .overlay(alignment: .bottom) {
        if !options.isEmpty {
          Color.clear
            .frame(height: 0)
            .overlay(alignment: .top) {
              suggestions(options, chosen: chosen)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, ComposerMeasure.languagesListTop)
                .composerReveals(Self.listAnchor, when: options.count)
                // It opens as the field takes focus, while the keyboard is
                // still rising: once the keyboard is up, again.
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                  scroller?.reveal(Self.listAnchor)
                }
            }
        }
      }
    }
  }

  private func suggestions(_ options: [LanguageChoice], chosen: [String]) -> some View {
    ScrollViewReader { proxy in
      // Its own height up to 16rem, which grows with Dynamic Type as a rem
      // does with the browser's text size; past that it scrolls inside.
      TableRowsHeight(limit: theme.scaled(ComposerMeasure.languagesListMax, relativeTo: VirgaTheme.textStyle(for: theme.textBase))) {
        ScrollView {
          VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(options.enumerated()), id: \.element.code) { index, option in
              Button {
                add(option.code, chosen: chosen)
              } label: {
                HStack(spacing: ComposerMeasure.suggestItemGap) {
                  Text(option.name).foregroundStyle(theme.ink)
                  Spacer(minLength: 0)
                  Text(option.code).virgaText(.textSm).foregroundStyle(theme.muted)
                }
                .suggestRow()
              }
              .buttonStyle(SuggestItemStyle(marked: index == active))
              .accessibilityAddTraits(index == active ? .isSelected : [])
              .accessibilityIdentifier("language-\(option.code)")
              .id(option.code)
            }
          }
          .padding(ComposerMeasure.suggestListPadding)
        }
        .scrollBounceBehavior(.basedOnSize)
        // The page's scroll lets the keyboard go as it is dragged; a drag in
        // the list (at large sizes, where it scrolls) keeps it and the list.
        .scrollDismissesKeyboard(.never)
      }
      // The highlighted one stays in sight as the arrows move it.
      .onChange(of: active) { _, at in
        if options.indices.contains(at) { proxy.scrollTo(options[at].code) }
      }
    }
    .suggestPop()
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Languages")
  }

  /// The suggestions showing: the search's, while the list is open, the
  /// field has the keyboard and there is room for another.
  private func shown(chosen: [String]) -> [LanguageChoice] {
    guard open && focused && chosen.count < Self.max else { return [] }
    return ComposerLanguages.searchLanguages(
      .string(query), chosen: chosen, preferred: Locale.preferredLanguages, limit: 6)
  }

  private static func pickerKey(_ key: FieldKey) -> LanguagePickerKeys.Key {
    switch key {
    case .up: return .up
    case .down: return .down
    case .enter: return .enter
    case .escape: return .escape
    }
  }

  /// A key in the field (LanguagePickerKeys, LanguagePicker.jsx's onKeyDown):
  /// true when the list took it.
  @discardableResult
  private func press(_ key: LanguagePickerKeys.Key, options: [LanguageChoice], chosen: [String]) -> Bool {
    switch LanguagePickerKeys.press(key, active: active, count: options.count) {
    case .ignored:
      return false
    case .highlight(let next):
      active = next
      AccessibilityNotification.Announcement(options[next].name).post()
      return true
    case .add(let index):
      add(options[index].code, chosen: chosen)
      return true
    case .close:
      open = false
      return true
    }
  }

  private func add(_ code: String?, chosen: [String]) {
    guard let code, !chosen.jsIncludes(code), chosen.count < Self.max else { return }
    value = chosen + [code]
    if !query.isEmpty { clearing = true }
    query = ""
    active = 0
    open = false
  }
}

/// A ScrollViewReader round a scroll view that holds a language picker,
/// its proxy handed down as the composer's scroller, so the picker brings
/// its floating suggestions into view as the composer's sheet brings its
/// "@" and "/" lists (ComposerReveals). Settings' pages and the composer's
/// Language dialog wear it round their scroll views.
struct ComposerScrolling: ViewModifier {
  @Environment(\.virgaTheme) private var theme

  func body(content: Content) -> some View {
    ScrollViewReader { proxy in
      content.environment(
        \.composerScroller,
        ComposerScroller { [motion = theme.motion.control] id in
          DispatchQueue.main.async {
            withAnimation(motion) { proxy.scrollTo(id) }
          }
        })
    }
  }
}

extension View {
  /// Lets a language picker in this scroll view bring its suggestions into view.
  func composerScrolling() -> some View {
    modifier(ComposerScrolling())
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
/// account on this device without switching the app to it. One line: the
/// picture, "Posting as", the name and the handle; with more than one
/// account it is a button with a caret, and its list floats over the post
/// (a popover, closed by a press outside it). A signed-out account can't be
/// picked; it offers Sign back in. A scheduled post stays with the account
/// that scheduled it (`locked`).
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
    VStack(alignment: .leading, spacing: ComposerMeasure.postAsNoteGap) {
      if accounts.count <= 1 || locked {
        byline(current)
        if locked && !lockedReason.isEmpty { FieldHint(lockedReason) }
      } else {
        Button {
          // Pressing the byline takes the focus from the post being written,
          // as the web's button does: the keyboard goes, and the sheet stops
          // scrolling the caret back into view, so the list stays under the
          // byline instead of losing it off the top.
          UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
          open.toggle()
        } label: {
          HStack(spacing: ComposerMeasure.postAsGap) {
            byline(current)
            Image(systemName: ComposerGlyph.chevronDown)
              .virgaGlyph(ComposerMeasure.optionChevron, beside: theme.textSm)
              .foregroundStyle(theme.muted)
          }
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        // A 32-point line, pressed as 44.
        .touchReach(horizontal: 0, vertical: (Measure.Touch.target - ComposerMeasure.postAsHeight) / 2)
        .accessibilityLabel(buttonLabel(current))
        .accessibilityValue(open ? "Expanded" : "Collapsed")
        .accessibilityIdentifier("post-as")
        .popover(isPresented: $open, arrowEdge: .top) {
          list(accounts)
            .presentationCompactAdaptation(.popover)
            .presentationBackground(theme.surface)
        }
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
      Avatar(src: current?.avatar, name: name, size: .small, side: ComposerMeasure.postAsAvatar)
      HStack(alignment: .firstTextBaseline, spacing: ComposerMeasure.postAsTextGap) {
        Text("Posting as").virgaText(.textSm).foregroundStyle(theme.muted).fixedSize()
        Text(name).virgaText(.textSm, weight: VirgaWeight.semibold).foregroundStyle(theme.ink)
          .lineLimit(1).truncationMode(.tail)
        if !handle.isEmpty && name != handle {
          Text(handle).virgaText(.textSm).foregroundStyle(theme.muted)
            .lineLimit(1).truncationMode(.tail)
            .layoutPriority(-1)
        }
      }
    }
    .frame(minHeight: ComposerMeasure.postAsHeight)
  }

  /// Opening checks the other accounts' sessions, so a dead one shows as
  /// signed out before anyone picks it.
  private func check(_ accounts: [SessionAccount]) async {
    for account in accounts where !Optional(account.did).jsEquals(session.did) && account.status != .needsSignIn {
      let verdict = await session.checkAccount(account.did)
      checked[account.did] = verdict
    }
  }

  /// `.post-as-list`: the hint, then a row per account, on the radius with
  /// no rules between, 6 in from the edge.
  private func list(_ accounts: [SessionAccount]) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("The post, its draft or its schedule goes to the account you choose. The rest of Virga stays as it is.")
        .virgaText(.textSm, lineHeight: ComposerMeasure.postAsHintLineHeight)
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)
        .padding(ComposerMeasure.postAsHintPadding)
      ForEach(accounts, id: \.did) { account in
        row(account)
      }
    }
    .padding(ComposerMeasure.postAsListPadding)
    .frame(width: min(ComposerMeasure.postAsListWidth, theme.windowWidth - ComposerMeasure.postAsListMargin))
    .accessibilityElement(children: .contain)
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
    return HStack(spacing: ComposerMeasure.postAsRowGap) {
      Button {
        open = false
        if !selected { onChange(account.did) }
      } label: {
        HStack(spacing: ComposerMeasure.suggestItemGap) {
          Avatar(src: account.avatar, name: label, size: .small, side: ComposerMeasure.postAsAvatar)
          VStack(alignment: .leading, spacing: 0) {
            Text(label).virgaText(.textSm, weight: VirgaWeight.semibold, lineHeight: ComposerMeasure.suggestLineHeight)
              .foregroundStyle(out ? theme.muted : theme.ink).lineLimit(1)
            Text(meta).virgaText(.textSm, lineHeight: ComposerMeasure.suggestLineHeight)
              .foregroundStyle(theme.muted).lineLimit(1)
          }
          Spacer(minLength: 0)
          if selected {
            Image(systemName: ComposerGlyph.check).virgaGlyph(ComposerMeasure.optionIcon).foregroundStyle(theme.ink)
          }
        }
        .padding(ComposerMeasure.suggestItemPadding)
        .frame(minHeight: ComposerMeasure.postAsRowHeight)
        .contentShape(RoundedRectangle(cornerRadius: theme.radius))
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
        .fixedSize()
        .accessibilityLabel("Sign back in as \(label)")
      }
    }
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
    // Nothing here can run: the two halves dim as one button, as any other
    // button that can't be pressed does.
    let allOff = (busy || p.disabled) && (busy || caretOff)
    let height = theme.points(ThemeKit.touchButtonHeight)
    let radius = height / 2
    // One ink pill: the main half's right corners square where the caret
    // follows it, a seam between them.
    HStack(spacing: 0) {
      Button {
        onAction(primary)
      } label: {
        Label(busy ? "Working…" : ComposerActions.actionLabel(primary, state, short: true), systemImage: Self.icon(primary))
      }
      .buttonStyle(
        PublishHalfStyle(
          shape: UnevenRoundedRectangle(
            topLeadingRadius: radius, bottomLeadingRadius: radius, bottomTrailingRadius: listed.isEmpty ? radius : 0,
            topTrailingRadius: listed.isEmpty ? radius : 0),
          leading: theme.points(ThemeKit.buttonPadding.left),
          trailing: listed.isEmpty ? theme.points(ThemeKit.buttonPadding.right) : ComposerMeasure.publishMainTrailing,
          minWidth: theme.composerNarrow ? 0 : ComposerMeasure.publishMinWidth, fadesWhenOff: !allOff))
      .disabled(busy || p.disabled)
      .help(p.disabled ? (p.reason ?? "") : "")
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
          PublishCaret(
            shape: UnevenRoundedRectangle(
              topLeadingRadius: 0, bottomLeadingRadius: 0, bottomTrailingRadius: radius, topTrailingRadius: radius),
            fadesWhenOff: !allOff)
        }
        .menuOrder(.fixed)
        .disabled(busy || caretOff)
        .accessibilityLabel("More ways to send it")
        .accessibilityIdentifier("publish-more")
      }
    }
    .opacity(allOff ? ThemeKit.disabledOpacity : 1)
    .fixedSize()
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

/// One half of the send button: the primary's ink (pressed, its hover's),
/// its words in --on-btn. A half that can't run while the other can keeps
/// the ink and fades only its words (`.publish-main:disabled`), so the two
/// stay one button; when neither can, the pill dims as one instead.
struct PublishHalfStyle: ButtonStyle {
  let shape: UnevenRoundedRectangle
  let leading: CGFloat
  let trailing: CGFloat
  let minWidth: CGFloat
  let fadesWhenOff: Bool

  func makeBody(configuration: Configuration) -> some View {
    PublishHalfBody(
      label: configuration.label, isPressed: configuration.isPressed, shape: shape, leading: leading, trailing: trailing,
      minWidth: minWidth, fadesWhenOff: fadesWhenOff)
  }
}

struct PublishHalfBody<Label: View>: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  let label: Label
  let isPressed: Bool
  let shape: UnevenRoundedRectangle
  let leading: CGFloat
  let trailing: CGFloat
  let minWidth: CGFloat
  let fadesWhenOff: Bool

  var body: some View {
    let ink = theme.color(ThemeKit.primaryButtonInk)
    let height = theme.points(ThemeKit.touchButtonHeight)
    label
      .labelStyle(InlineLabelStyle(gap: theme.points(ThemeKit.buttonGap)))
      .virgaText(size: theme.points(ThemeKit.buttonFontSize), weight: ThemeKit.primaryButtonWeight, lineHeight: Measure.Lines.button)
      .lineLimit(1)
      .fixedSize(horizontal: true, vertical: false)
      .foregroundStyle(!isEnabled && fadesWhenOff ? ink.opacity(ComposerMeasure.publishOffInk) : ink)
      .padding(.leading, leading)
      .padding(.trailing, trailing)
      .frame(minWidth: minWidth, minHeight: height)
      .background(shape.fill(theme.color(isPressed ? ThemeKit.primaryButtonHoverFill : ThemeKit.primaryButtonFill)))
      .contentShape(Rectangle().inset(by: -(Measure.Touch.target - height) / 2))
      .animation(theme.motion.control, value: isPressed)
      .virgaFocusOutline(Capsule())
  }
}

/// The send button's caret: 40 wide, its chevron a little left of centre
/// (`.publish-caret { width: 40px; padding: 0 4px 0 0 }`), the seam its own
/// left edge (`border-left: 1px solid color-mix(on-btn 28%)`), inside the 40,
/// and not faded with the chevron.
struct PublishCaret: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  let shape: UnevenRoundedRectangle
  let fadesWhenOff: Bool

  var body: some View {
    let ink = theme.color(ThemeKit.primaryButtonInk)
    let height = theme.points(ThemeKit.touchButtonHeight)
    Image(systemName: ComposerGlyph.chevronDown)
      .virgaGlyph(ComposerMeasure.publishGlyph, weight: .semibold, beside: theme.points(ThemeKit.buttonFontSize))
      .foregroundStyle(!isEnabled && fadesWhenOff ? ink.opacity(ComposerMeasure.publishOffInk) : ink)
      .padding(.trailing, ComposerMeasure.publishCaretInset)
      .padding(.leading, ComposerMeasure.publishSeam)
      .frame(width: ComposerMeasure.publishCaretWidth, height: height)
      .background(shape.fill(theme.color(ThemeKit.primaryButtonFill)))
      .overlay(alignment: .leading) {
        Rectangle()
          .fill(ink.opacity(ComposerMeasure.publishSeamInk))
          .frame(width: ComposerMeasure.publishSeam)
      }
      .contentShape(Rectangle())
  }
}
#endif
