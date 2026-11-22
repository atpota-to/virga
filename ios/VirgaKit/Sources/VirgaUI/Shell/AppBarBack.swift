// Ports src/shell/MobileNav.jsx (AppBar's back link)
// Ports src/shell/shell.css (.appbar-back)
//
// On a phone's page inside a part (a report, a tool, a setting, a posting
// page), the mark gives way to the way back up: a chevron and the name of
// the page above (routes.js parentOf), in ink at --text-md, 500. It sits in
// the navigation bar's leading place instead of the system's back button,
// which on iOS 26 is a bare chevron in glass that doesn't say where it
// leads. Hiding the system's button also stops the swipe in from the left
// edge, so SwipeBackKeeper gives that back.

#if canImport(UIKit)
import SwiftUI
import UIKit
import VirgaInsights

extension Measure.AppBar {
  /// `.appbar-back { padding-right: 8px }`
  static let backPaddingTrailing: CGFloat = 8
}

/// `.appbar-back`: ‹ Reports, ‹ Settings, ‹ Scheduled posts.
struct AppBarBack: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  let link: ParentLink

  var body: some View {
    Button {
      navigate(link.to)
    } label: {
      label
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm))
    .accessibilityLabel(link.label)
    .accessibilityIdentifier("app-bar-back")
  }

  private var label: some View {
    HStack(spacing: Measure.AppBar.backGap) {
      Image(systemName: Glyph.chevronLeft)
        .font(.system(size: Measure.AppBar.backChevron))
        .accessibilityHidden(true)
      Text(link.label)
        .virgaText(.textMd, weight: VirgaWeight.medium)
        .lineLimit(1)
        .truncationMode(.tail)
    }
    .foregroundStyle(theme.ink)
    .padding(.trailing, Measure.AppBar.backPaddingTrailing)
    .frame(minHeight: Measure.AppBar.iconButton)
    .contentShape(Rectangle())
  }
}

/// Keeps the swipe back from the left edge on a page whose back button is
/// Virga's own: the navigation controller's pop gesture asks the shared
/// delegate below, which lets it begin whenever there is a page to go back to.
struct SwipeBackKeeper: UIViewControllerRepresentable {
  func makeUIViewController(context: Context) -> SwipeBackController {
    SwipeBackController()
  }

  func updateUIViewController(_ controller: SwipeBackController, context: Context) {}
}

final class SwipeBackController: UIViewController {
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    let stack = navigationController ?? SwipeBackDelegate.stack(from: view)
    stack?.interactivePopGestureRecognizer?.delegate = SwipeBackDelegate.shared
  }
}

@MainActor
final class SwipeBackDelegate: NSObject, UIGestureRecognizerDelegate {
  static let shared = SwipeBackDelegate()

  /// The navigation controller a view is in, up its responders.
  static func stack(from view: UIView?) -> UINavigationController? {
    var responder: UIResponder? = view
    while let current = responder {
      if let stack = current as? UINavigationController { return stack }
      responder = current.next
    }
    return nil
  }

  func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    guard let stack = Self.stack(from: gestureRecognizer.view) else { return false }
    return stack.viewControllers.count > 1 && stack.transitionCoordinator == nil
  }
}
#endif
