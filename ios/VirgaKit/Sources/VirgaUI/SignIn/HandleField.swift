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
// takes its place in the layout.

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

  var body: some View {
    let height = theme.points(size == .large ? ThemeKit.largeInputHeight : ThemeKit.touchInputHeight)
    let showing = focus.wrappedValue && !items.isEmpty
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
        .onSubmit(onSubmit)
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
    } catch {
      if Task.isCancelled { return }
      items = []
    }
  }

  private var suggestions: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(items, id: \.did) { item in
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
        .buttonStyle(.plain)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Accounts that match")
  }

  private func pick(_ item: SignInSuggestion) {
    let handle = item.handle ?? ""
    skip = handle
    items = []
    onPick(handle)
  }
}
#endif
