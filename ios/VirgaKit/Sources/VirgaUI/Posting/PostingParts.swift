// Ports src/posting/pages/hubParts.jsx (RowSkeleton, LoadError, ConfirmDialog)
// Ports src/posting/ui/PostingHeader.jsx
// Ports src/posting/pages/hub.css (.hub-skeleton, .hub-bone, .hub-error, .hub-confirm, .hub-notice)
//
// What the posting pages share: the bones a list loads under, a read that
// failed with Try again, and the question every delete asks first. A count
// in words is hubModel.js's countPhrase, ported as `HubModel.countPhrase`.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaInsights

/// `PostingHeader`: Posting in the crumbs (except on the overview), the
/// page's title and line, and what it touches.
enum PostingHeader {
  /// `crumbs` replaces the usual ones (a page reached from another, as the
  /// weekly schedule is from Scheduled posts); `title` and `sub` the page's;
  /// `showAccess` is false where the page itself isn't shown (NeedsBackend).
  static func model(
    _ key: String, title: String? = nil, sub: String? = nil, crumbs: [Crumb]? = nil, showAccess: Bool = true
  ) -> PageHeaderModel {
    let page = PostingRoutes.postingPageByKey[key] ?? PostingRoutes.postingPageByKey["hub"]
    let usual = page?.key == "hub" || page == nil ? [] : [Crumb("Posting", to: PostingRoutes.postingBase)]
    return PageHeaderModel(
      title: title ?? page?.title ?? "Posting", sub: sub ?? page?.desc, access: showAccess ? page?.access ?? [] : [],
      crumbs: crumbs ?? usual)
  }

  /// The header with the caller's `actions` and what goes under it (`extra`), drawn only when given.
  static func header(
    _ key: String, title: String? = nil, sub: String? = nil, crumbs: [Crumb]? = nil, showAccess: Bool = true,
    actions: AnyView? = nil, extra: AnyView? = nil
  ) -> PageHeader {
    PageHeader(model(key, title: title, sub: sub, crumbs: crumbs, showAccess: showAccess), actions: actions, extra: extra)
  }
}


/// `RowSkeleton`: rows of bones while a list loads, pulsing (still under
/// Reduce Motion). An even row has two lines of words, an odd one one, each
/// row as tall as its bones. `.hub-row-main { flex: 1 1 320px }` beside the
/// action bones needs 400 of row, which no phone has: there the action
/// bones go under the words' bones, 8 down, and those take the full width.
struct RowSkeleton: View {
  @Environment(\.virgaTheme) private var theme
  var rows = 3
  var actions = 0

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(0..<rows, id: \.self) { i in
        row(i)
          .padding(.vertical, theme.rowPad)
          .frame(maxWidth: .infinity, alignment: .leading)
          .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: Measure.Section.hairline) }
      }
    }
    .hubBonePulse()
    .accessibilityHidden(true)
  }

  @ViewBuilder
  private func row(_ i: Int) -> some View {
    if theme.isPhone {
      VStack(alignment: .leading, spacing: Measure.Hub.rowRowGap) {
        words(i)
        if actions > 0 { actionBones }
      }
    } else {
      HStack(alignment: .top, spacing: Measure.Templates.rowColumnGap) {
        words(i)
        if actions > 0 { actionBones }
      }
    }
  }

  /// A line or two of words, then a meta line, at the widths the web gives them.
  private func words(_ i: Int) -> some View {
    let second = i % 2 == 0
    let lines: CGFloat = second ? 2 : 1
    let height = Measure.Templates.rowBoneHeight * lines + Measure.Templates.metaBoneHeight + Measure.Templates.boneGap * lines
    return GeometryReader { geometry in
      VStack(alignment: .leading, spacing: Measure.Templates.boneGap) {
        bone(geometry.size.width * Measure.Templates.boneWidths[i % 5], Measure.Templates.rowBoneHeight)
        if second {
          bone(geometry.size.width * Measure.Templates.secondBoneWidths[i % 3], Measure.Templates.rowBoneHeight)
        }
        bone(geometry.size.width * Measure.Templates.metaBoneWidths[i % 4], Measure.Templates.metaBoneHeight)
      }
    }
    .frame(height: height)
  }

  private var actionBones: some View {
    HStack(spacing: Measure.Templates.rowGap) {
      ForEach(0..<actions, id: \.self) { _ in
        Capsule().fill(theme.line).frame(width: Measure.Templates.buttonBone.width, height: Measure.Templates.buttonBone.height)
      }
    }
  }

  private func bone(_ width: CGFloat, _ height: CGFloat) -> some View {
    RoundedRectangle(cornerRadius: theme.radiusSm).fill(theme.line).frame(width: width, height: height)
  }
}

/// `.hub-bone { animation: hub-pulse 1.6s ease-in-out infinite }`, to 45% at
/// its middle; none under Reduce Motion.
struct HubBonePulse: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  @State private var dim = false

  func body(content: Content) -> some View {
    content
      .opacity(dim ? Measure.Templates.pulseLow : 1)
      .onAppear {
        guard !theme.reduceMotion else { return }
        withAnimation(.easeInOut(duration: Measure.Templates.pulseSeconds / 2).repeatForever(autoreverses: true)) { dim = true }
      }
  }
}

extension View {
  /// The bones' pulse (HubBonePulse).
  func hubBonePulse() -> some View {
    modifier(HubBonePulse())
  }
}

/// `LoadError`: what happened, in a sentence, and Try again; `role="alert"`,
/// so VoiceOver reads the sentence as it appears.
struct LoadError: View {
  @Environment(\.virgaTheme) private var theme
  let message: String
  var onRetry: (() -> Void)?

  var body: some View {
    // `.hub-error { align-items: center }`: the triangle, the sentence and
    // Try again centred on one another, the callout's 10 between each (the
    // triangle's 2 above it kept, as the web's margin-top is).
    Callout(tone: .danger, alert: message) {
      HStack(alignment: .center, spacing: theme.points(ThemeKit.calloutGap)) {
        Image(systemName: "exclamationmark.triangle")
          .virgaGlyph(Measure.Section.calloutIcon, beside: theme.textSm)
          .padding(.top, Measure.Section.calloutIconSpaceAbove)
          .accessibilityHidden(true)
        Text(message).frame(maxWidth: .infinity, alignment: .leading)
        if let onRetry {
          Button("Try again", action: onRetry)
            .buttonStyle(.virga(size: .small))
        }
      }
    }
    .accessibilityIdentifier("posting-load-error")
  }
}

extension View {
  /// `ConfirmDialog`: the question every delete asks first. `onConfirm`
  /// may throw: the button shows busy until it settles, and a failure's
  /// message is shown in the dialog, which stays open.
  func postingConfirm<Message: View>(
    isPresented: Binding<Bool>, title: String, confirmLabel: String = "Delete", busyLabel: String = "Deleting…",
    onConfirm: @escaping @MainActor () async throws -> Void, @ViewBuilder message: @escaping () -> Message
  ) -> some View {
    modifier(PostingConfirm(isPresented: isPresented, title: title, confirmLabel: confirmLabel, busyLabel: busyLabel, onConfirm: onConfirm, message: message))
  }
}

struct PostingConfirm<Message: View>: ViewModifier {
  @Binding var isPresented: Bool
  let title: String
  let confirmLabel: String
  let busyLabel: String
  let onConfirm: @MainActor () async throws -> Void
  let message: () -> Message
  @State private var busy = false
  @State private var error = ""

  func body(content: Content) -> some View {
    content
      // It opens on Cancel (`data-autofocus`), the safe choice.
      .virgaDialog(
        isPresented: Binding(get: { isPresented }, set: { if !busy { isPresented = $0 } }), title: title, autofocus: true
      ) {
        VStack(alignment: .leading, spacing: Measure.Hub.confirmGap) {
          message()
          if !error.isEmpty {
            // `role="alert"`: read out as it appears.
            Callout(tone: .danger, error)
          }
        }
        .fixedSize(horizontal: false, vertical: true)
        // `onClose={busy ? undefined : onClose}`: no swipe away while it works.
        .interactiveDismissDisabled(busy)
      } actions: {
        Button("Cancel") { isPresented = false }
          .buttonStyle(.virga)
          .disabled(busy)
          .dialogAutofocus()
        Button(busy ? busyLabel : confirmLabel) { Task { await confirm() } }
          .buttonStyle(.virga(.danger))
          .disabled(busy)
          .accessibilityIdentifier("posting-confirm")
      }
      .onChange(of: isPresented) { _, open in if open { error = "" } }
  }

  private func confirm() async {
    busy = true
    error = ""
    defer { busy = false }
    do {
      try await onConfirm()
      isPresented = false
    } catch {
      let said = (error as? LocalizedError)?.errorDescription ?? ""
      self.error = said.isEmpty ? "That didn’t work. Try again." : said
    }
  }
}
#endif
