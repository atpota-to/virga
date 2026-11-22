// Ports src/posting/pages/hubParts.jsx (RowSkeleton, LoadError, ConfirmDialog)
// Ports src/posting/ui/PostingHeader.jsx (the header's model)
// Ports src/posting/pages/hub.css (.hub-skeleton, .hub-bone, .hub-error, .hub-confirm, .hub-notice)
//
// What the posting pages share: the bones a list loads under, a read that
// failed with Try again, and the question every delete asks first. Also
// countPhrase (src/posting/pages/hubModel.js).

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaInsights

/// `PostingHeader`: Posting in the crumbs (except on the overview), the
/// page's title and line, and what it touches.
enum PostingHeader {
  static func model(_ key: String, showAccess: Bool = true) -> PageHeaderModel {
    let page = PostingRoutes.postingPageByKey[key] ?? PostingRoutes.postingPageByKey["hub"]
    let crumbs = page?.key == "hub" || page == nil ? [] : [Crumb("Posting", to: PostingRoutes.postingBase)]
    return PageHeaderModel(title: page?.title ?? "Posting", sub: page?.desc, access: showAccess ? page?.access ?? [] : [], crumbs: crumbs)
  }
}


/// `countPhrase(n, one, many)`: "3 templates", "1 template".
enum PostingWords {
  static func countPhrase(_ n: Int, _ one: String, _ many: String? = nil) -> String {
    "\(AppLocale.formatNumber(n)) \(n == 1 ? one : (many ?? "\(one)s"))"
  }
}

/// `RowSkeleton`: rows of bones while a list loads, pulsing (still under
/// Reduce Motion).
struct RowSkeleton: View {
  @Environment(\.virgaTheme) private var theme
  var rows = 3
  var actions = 0
  @State private var dim = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(0..<rows, id: \.self) { i in
        HStack(alignment: .top, spacing: Measure.Templates.rowColumnGap) {
          GeometryReader { geometry in
            VStack(alignment: .leading, spacing: Measure.Templates.boneGap) {
              bone(geometry.size.width * Measure.Templates.boneWidths[i % 5], Measure.Templates.rowBoneHeight)
              if i % 2 == 0 {
                bone(geometry.size.width * Measure.Templates.secondBoneWidths[i % 3], Measure.Templates.rowBoneHeight)
              }
              bone(geometry.size.width * Measure.Templates.metaBoneWidths[i % 4], Measure.Templates.metaBoneHeight)
            }
          }
          .frame(height: Measure.Templates.rowBoneHeight * 2 + Measure.Templates.metaBoneHeight + Measure.Templates.boneGap * 2)
          if actions > 0 {
            HStack(spacing: Measure.Templates.rowGap) {
              ForEach(0..<actions, id: \.self) { _ in
                Capsule().fill(theme.line).frame(width: Measure.Templates.buttonBone.width, height: Measure.Templates.buttonBone.height)
              }
            }
          }
        }
        .padding(.vertical, theme.rowPad)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
      }
    }
    .opacity(dim ? Measure.Templates.pulseLow : 1)
    .onAppear {
      guard !theme.reduceMotion else { return }
      withAnimation(.easeInOut(duration: Measure.Templates.pulseSeconds / 2).repeatForever(autoreverses: true)) { dim = true }
    }
    .accessibilityHidden(true)
  }

  private func bone(_ width: CGFloat, _ height: CGFloat) -> some View {
    RoundedRectangle(cornerRadius: theme.radiusSm).fill(theme.line).frame(width: width, height: height)
  }
}

/// `LoadError`: what happened, in a sentence, and Try again.
struct LoadError: View {
  @Environment(\.virgaTheme) private var theme
  let message: String
  var onRetry: (() -> Void)?

  var body: some View {
    Callout(tone: .danger, systemImage: "exclamationmark.triangle") {
      HStack(alignment: .center, spacing: theme.space3) {
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
      .virgaDialog(isPresented: Binding(get: { isPresented }, set: { if !busy { isPresented = $0 } }), title: title) {
        VStack(alignment: .leading, spacing: Measure.Settings.rowGap) {
          message()
          if !error.isEmpty {
            Callout(tone: .danger) { Text(error) }
          }
        }
        .fixedSize(horizontal: false, vertical: true)
      } actions: {
        Button("Cancel") { isPresented = false }
          .buttonStyle(.virga)
          .disabled(busy)
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
