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
// it closed.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaSession

struct HandleField: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  @Binding var value: String
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
    VStack(alignment: .leading, spacing: 0) {
      ZStack(alignment: .leading) {
        TextField(
          "you.bsky.social",
          text: Binding(
            get: { value },
            set: { next in
              typed = true
              skip = nil
              value = SignInIdentity.cleanTyped(next)
              onEdit()
            })
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
        .accessibilityValue(showing && items.indices.contains(active) ? "@\(items[active].handle ?? "")" : "")
        .disabled(disabled)
        .virgaField(invalid: invalid, size: size, leading: Measure.SignIn.fieldLeading)
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
#endif
