// Ports src/shell/bits.jsx
// Ports src/shell/shell.css
//
// Small pieces every page uses: the mark (a cloud's arc with rain falling
// from it that never lands, drawn in the colour of the words beside it), the
// brand (the mark and the name), the line a loading page shows, and toasts
// (read out by VoiceOver as they come, as the web's polite live region
// is). The page header is Components/PageHeader.swift; useIsNarrow is the
// theme's `hasSidebar` (the width, not the device); the period picker and
// its range dialog are PeriodPicker.swift.
//
// Not here yet: the five taps on the mark that turn the live sky on (the
// hillside comes later).

#if canImport(UIKit)
import Observation
import SwiftUI
import UIKit
import VirgaCore

/// The mark, on a 24 grid: `M5 11a7 7 0 0 1 14 0M8.5 14.5l-1 4M12.3 14.5l-1.3 6M16 14.5l-.9 3.2`.
public struct LogoMarkShape: Shape {
  public init() {}

  public func path(in rect: CGRect) -> Path {
    let s = min(rect.width, rect.height) / 24
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
    var path = Path()
    // The arc: from (5, 11) over the top to (19, 11), radius 7.
    path.addArc(center: p(12, 11), radius: 7 * s, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
    path.move(to: p(8.5, 14.5))
    path.addLine(to: p(7.5, 18.5))
    path.move(to: p(12.3, 14.5))
    path.addLine(to: p(11, 20.5))
    path.move(to: p(16, 14.5))
    path.addLine(to: p(15.1, 17.7))
    return path
  }
}

public struct LogoMark: View {
  private let size: CGFloat

  public init(size: CGFloat = Measure.Brand.markSize) {
    self.size = size
  }

  public var body: some View {
    LogoMarkShape()
      .stroke(style: StrokeStyle(lineWidth: Measure.Brand.markStroke * size / 24, lineCap: .round))
      .frame(width: size, height: size)
      .accessibilityHidden(true)
  }
}

/// `.brand`: the mark and "Virga", in ink, straight on the sky.
public struct Brand: View {
  @Environment(\.virgaTheme) private var theme
  private let showsName: Bool

  public init(showsName: Bool = true) {
    self.showsName = showsName
  }

  public var body: some View {
    HStack(spacing: Measure.Brand.gap) {
      LogoMark()
      if showsName {
        Text(AppConfig.appName)
          .virgaText(size: Measure.Brand.nameSize, weight: Measure.Brand.nameWeight, tracking: Measure.Brand.nameTracking)
      }
    }
    .foregroundStyle(theme.ink)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(AppConfig.appName)
  }
}

/// `.page-loading`: a page waiting for what it shows.
public struct PageLoading: View {
  @Environment(\.virgaTheme) private var theme
  private let text: String

  public init(_ text: String) {
    self.text = text
  }

  public var body: some View {
    PageColumn {
      Text(text)
        .virgaText(.textMd)
        .foregroundStyle(theme.muted)
        .padding(.vertical, theme.space7)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

// MARK: - Toasts

/// `ToastProvider`: at most three at once, each gone after a few seconds.
@MainActor
@Observable
public final class ToastCenter {
  public struct Toast: Identifiable, Equatable {
    public var id: Int
    public var text: String
    public var danger: Bool
  }

  public private(set) var toasts: [Toast] = []
  @ObservationIgnored private var next = 0

  public init() {}

  /// `toast(text, { tone })`.
  public func push(_ text: String, danger: Bool = false, seconds: Double = Measure.Toast.seconds) {
    next += 1
    let toast = Toast(id: next, text: text, danger: danger)
    toasts = Array(toasts.suffix(2)) + [toast]
    // role="status" aria-live="polite": VoiceOver reads it out.
    UIAccessibility.post(notification: .announcement, argument: text)
    let id = toast.id
    Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
      self?.toasts.removeAll { $0.id == id }
    }
  }
}

/// `.toasts`: in ink, with the page's colour written on it, at the foot of
/// the window (over a phone's tab bar).
public struct ToastStack: View {
  @Environment(\.virgaTheme) private var theme
  private let center: ToastCenter

  public init(center: ToastCenter) {
    self.center = center
  }

  public var body: some View {
    VStack(alignment: theme.hasSidebar ? .trailing : .center, spacing: Measure.Toast.gap) {
      ForEach(center.toasts) { toast in
        Text(toast.text)
          .virgaText(.textBase)
          .foregroundStyle(toast.danger ? Measure.Toast.dangerInk.color : theme.onBtn)
          .padding(Measure.Toast.padding)
          .frame(maxWidth: theme.hasSidebar ? Measure.Toast.maxWidth : .infinity, alignment: .leading)
          .background(
            RoundedRectangle(cornerRadius: theme.radiusLg).fill(toast.danger ? Measure.Toast.dangerFill.color : theme.btn)
          )
          .virgaShadow(theme.shadow(theme.tokens.shadowLg))
          // `toast-in`: in from 6 points down as it fades in.
          .transition(
            .asymmetric(
              insertion: AnyTransition.opacity.combined(with: AnyTransition.offset(y: Measure.Toast.rise)),
              removal: AnyTransition.opacity))
      }
    }
    .padding(theme.hasSidebar ? Measure.Toast.inset : Measure.Toast.phoneInset)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: theme.hasSidebar ? .bottomTrailing : .bottom)
    .allowsHitTesting(false)
    .animation(theme.motion.sheet, value: center.toasts)
    .accessibilityElement(children: .contain)
  }
}

extension Measure.Toast {
  /// `@keyframes toast-in { from { opacity: 0; transform: translateY(6px) } }`
  static let rise: CGFloat = 6
}

#Preview("Brand") {
  VirgaPreviewHost {
    VStack(alignment: .leading, spacing: 20) {
      Brand()
      LogoMark(size: 44)
    }
    .padding()
  }
}
#endif
