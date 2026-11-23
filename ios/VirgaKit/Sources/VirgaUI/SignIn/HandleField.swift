// Ports src/signin/HandleField.jsx
// Ports src/signin/signin.css (.handle-field, .handle-suggestions)
//
// The handle field, with accounts suggested under it as the handle is typed
// (Bluesky's public search, after a pause: SignInSuggest). A handle is not
// prose: no capitals, no autocorrect, the URL keyboard (the '.' on its
// first plane) and a Go key. Invisible characters a copied handle carries
// are taken out as it is typed (cleanTyped). Taking a suggestion puts its
// handle in the field and looks it up at once; a search that fails shows
// nothing, since the field works without suggestions. On the front page
// the list floats under the field, with what floats has; in a dialog it
// takes its place in the layout. On a hardware keyboard it is a combobox:
// ↑ and ↓ move through the suggestions (round through the field itself:
// moveActive), Return takes the marked one (or, with none marked, signs
// in as the field always does), Escape puts the list away and Tab leaves
// it closed. The marked one is read out to VoiceOver as it is marked (the
// web's aria-activedescendant).
//
// The field is named by the label over it (the web's <label for>), and a
// notice about what was typed is its hint (aria-describedby). On a phone
// the page is scrolled to put the field at its top when suggestions come
// up (`reveal`, through the page's SignInScroller), so the list floats in
// the room above the keyboard rather than under it.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaSession

struct HandleField: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  @Environment(\.signInScroller) private var scroller
  @Binding var value: String
  /// The visible label over the field: its name for VoiceOver.
  var label: String
  /// A notice about what was typed, read as the field's hint.
  var hint: String?
  /// The id of the view to bring to the page's top when suggestions come
  /// up on a phone (the field's label).
  var reveal: String?
  var size: FieldSize
  var floats: Bool
  var invalid: Bool
  var disabled: Bool
  var focus: FocusState<Bool>.Binding
  var onEdit: () -> Void
  var onPick: (String) -> Void
  var onSubmit: () -> Void

  @State private var items: [SignInSuggestion] = []
  /// Suggestions answer typing: a handle already in the field when it came
  /// back on screen (after "Not you?") isn't a question.
  @State private var typed = false
  /// A suggestion just taken is in the field now; it isn't searched for.
  @State private var skip: String?
  /// The suggestion the arrows have marked, -1 for none (the field itself).
  @State private var active = -1
  /// Escape (or Tab) put the list away; the arrows or new answers bring it back.
  @State private var closed = false

  var body: some View {
    let height = theme.points(size == .large ? ThemeKit.largeInputHeight : ThemeKit.touchInputHeight)
    let showing = focus.wrappedValue && !items.isEmpty && !closed
    // The @ grows with Dynamic Type, so the words start after it at its
    // own scale (the web's are both in CSS px under the browser's size).
    let leading = Measure.SignIn.atInset
      + theme.scaled(Measure.SignIn.fieldLeading - Measure.SignIn.atInset, relativeTo: VirgaTheme.textStyle(for: theme.textMd))
    VStack(alignment: .leading, spacing: 0) {
      ZStack(alignment: .leading) {
        TextField(
          label,
          text: Binding(
            get: { value },
            set: { next in
              typed = true
              skip = nil
              value = SignInIdentity.cleanTyped(next)
              onEdit()
            }),
          prompt: Text("you.bsky.social").foregroundStyle(theme.muted)
        )
        .focused(focus)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .keyboardType(.URL)
        .submitLabel(.go)
        .onSubmit {
          if showing && items.indices.contains(active) {
            pick(items[active])
          } else {
            onSubmit()
          }
        }
        .onKeyPress(keys: [.upArrow, .downArrow]) { press in
          if items.isEmpty { return .ignored }
          let down = press.key == .downArrow
          if !showing {
            closed = false
            active = down ? 0 : items.count - 1
          } else {
            active = SignInSuggest.moveActive(active, items.count, down ? "ArrowDown" : "ArrowUp")
          }
          return .handled
        }
        .onKeyPress(.escape) {
          // The list goes away; the dialog the field may be in stays.
          if !showing { return .ignored }
          closed = true
          active = -1
          return .handled
        }
        .onKeyPress(.tab) {
          if showing {
            closed = true
            active = -1
          }
          return .ignored
        }
        .accessibilityHint(hint ?? "")
        .disabled(disabled)
        .virgaField(invalid: invalid, size: size, leading: leading)
        .accessibilityIdentifier("handle-field")
        Text("@")
          .virgaText(.textMd)
          .foregroundStyle(theme.muted)
          .frame(height: height)
          .padding(.leading, Measure.SignIn.atInset)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      }
      if showing && !floats {
        suggestions.padding(.top, Measure.SignIn.suggestionsSpaceAbove)
      }
    }
    .overlay(alignment: .topLeading) {
      if showing && floats {
        suggestions
          .padding(Measure.SignIn.suggestionsPadding)
          .background(RoundedRectangle(cornerRadius: theme.radiusLg).fill(theme.surface))
          .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line, lineWidth: 1))
          .virgaShadow(theme.shadow(theme.tokens.shadowLg))
          .offset(y: height + Measure.SignIn.suggestionsSpaceAbove)
      }
    }
    .zIndex(1)
    .task(id: value) { await suggest() }
    .onChange(of: focus.wrappedValue) { _, focused in
      if !focused { active = -1 }
    }
    .onChange(of: showing) { _, now in
      // On a phone the keyboard takes the lower half: the field goes to the
      // top of the page, so the list has room under it.
      if now, floats, theme.isPhone, let reveal { scroller?.scrollTo(reveal) }
    }
    .onChange(of: active) { _, marked in
      // The web's aria-activedescendant: the option the arrows marked is read.
      guard showing, items.indices.contains(marked) else { return }
      AccessibilityNotification.Announcement(Self.spoken(items[marked])).post()
    }
  }

  /// A suggestion as VoiceOver reads it: its name, then its handle.
  static func spoken(_ item: SignInSuggestion) -> String {
    let handle = "@\(item.handle ?? "")"
    guard let name = item.displayName, !name.isEmpty else { return handle }
    return "\(name), \(handle)"
  }

  /// The debounce, then the search (cancelled by the next keystroke).
  private func suggest() async {
    guard let query = SignInSuggest.suggestQuery(value), !disabled, typed, !Optional(query).jsEquals(skip) else {
      items = []
      return
    }
    try? await Task.sleep(nanoseconds: UInt64(SignInSuggest.suggestDebounceMs * 1_000_000))
    if Task.isCancelled { return }
    do {
      let found = try await app.lookups.suggest(query)
      if Task.isCancelled { return }
      items = found
      active = -1
      closed = false
    } catch {
      if Task.isCancelled { return }
      items = []
    }
  }

  private var suggestions: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(items.enumerated()), id: \.element.did) { index, item in
        Button {
          pick(item)
        } label: {
          HStack(spacing: Measure.SignIn.suggestionGap) {
            Avatar(src: item.avatar, name: item.displayName ?? item.handle, size: .small)
            VStack(alignment: .leading, spacing: 0) {
              if let name = item.displayName {
                Text(name)
                  .virgaText(.textBase, weight: VirgaWeight.medium)
                  .foregroundStyle(theme.ink)
                  .lineLimit(1)
                Text("@\(item.handle ?? "")")
                  .virgaText(.textSm)
                  .foregroundStyle(theme.muted)
                  .lineLimit(1)
              } else {
                Text("@\(item.handle ?? "")")
                  .virgaText(.textBase)
                  .foregroundStyle(theme.ink)
                  .lineLimit(1)
              }
            }
            Spacer(minLength: 0)
          }
          .padding(Measure.SignIn.suggestionPadding)
          .frame(minHeight: Measure.SignIn.suggestionHeight)
          .contentShape(Rectangle())
        }
        .buttonStyle(HandleSuggestionStyle(marked: index == active))
        .accessibilityAddTraits(index == active ? .isSelected : [])
        .accessibilityIdentifier("suggestion-\(item.handle ?? item.did)")
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Accounts that match")
  }

  private func pick(_ item: SignInSuggestion) {
    let handle = item.handle ?? ""
    skip = handle
    items = []
    active = -1
    onPick(handle)
  }
}

/// `.handle-suggestion`: the row the arrows have marked (the one Return
/// takes) on --hover with 2 points of ink at its edge, to be told from the
/// one the pointer is over, which is only shaded (--surface-2).
struct HandleSuggestionStyle: ButtonStyle {
  let marked: Bool

  func makeBody(configuration: Configuration) -> some View {
    HandleSuggestionBody(label: configuration.label, marked: marked, pressed: configuration.isPressed)
  }
}

struct HandleSuggestionBody<Label: View>: View {
  @Environment(\.virgaTheme) private var theme
  let label: Label
  let marked: Bool
  let pressed: Bool
  @State private var hovered = false

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: theme.radius)
    label
      .background {
        if marked {
          shape.fill(theme.hover)
            .overlay(alignment: .leading) {
              Rectangle().fill(theme.ink).frame(width: Measure.SignIn.suggestionMark)
            }
            .clipShape(shape)
        } else if hovered || pressed {
          shape.fill(theme.surface2)
        }
      }
      .onHover { hovered = $0 }
  }
}

/// Scrolls the page the sign-in is on, so a view of it (by its id) comes to
/// the top: the front page's ScrollViewReader, handed down.
struct SignInScroller {
  let scrollTo: @MainActor (String) -> Void
}

private struct SignInScrollerKey: EnvironmentKey {
  static let defaultValue: SignInScroller? = nil
}

extension EnvironmentValues {
  /// The page's scroller, where the page gives one (the front page).
  var signInScroller: SignInScroller? {
    get { self[SignInScrollerKey.self] }
    set { self[SignInScrollerKey.self] = newValue }
  }
}

/// A ScrollViewReader round the page's scroll view, its proxy handed to the
/// sign-in as a SignInScroller.
struct SignInScrolling: ViewModifier {
  func body(content: Content) -> some View {
    ScrollViewReader { proxy in
      content.environment(\.signInScroller, SignInScroller { id in proxy.scrollTo(id, anchor: .top) })
    }
  }
}

extension View {
  /// Lets the sign-in in this scroll view bring its field to the top.
  func signInScrolling() -> some View {
    modifier(SignInScrolling())
  }
}
#endif
