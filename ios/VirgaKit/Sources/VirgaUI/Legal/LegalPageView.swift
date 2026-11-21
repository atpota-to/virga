// Ports src/legal/LegalPage.jsx
// Ports src/legal/LegalDialog.jsx
// Ports src/legal/legal.css (.legal-main, .legal-doc, .legal-nav, .legal-dialog)
//
// A legal document as a page of its own (/terms, /privacy). It stands
// outside the app and outside the sign-in, so it reads the same signed in,
// signed out, or while the agreement screen is waiting, and never waits on
// a session. A link to a section (/privacy#what-virgas-server-keeps)
// scrolls to it once the page is drawn.
//
// LegalDialog is the same document in a dialog, for reading without leaving
// the screen that asks about it (the agreement screen, Settings › About). A
// link from one document to the other changes which is shown, in place, and
// goes to the section it names.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaSession

public struct LegalPageView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(ShellNavigator.self) private var navigator
  private let docKey: String

  public init(docKey: String) {
    self.docKey = docKey
  }

  public var body: some View {
    let document = LegalDocuments.readDocument(docKey)
    ScrollViewReader { proxy in
      ScrollView {
        LandingFrame {
          HStack(alignment: .center) {
            Button { navigate("/") } label: { Brand() }
              .buttonStyle(.plain)
              .accessibilityLabel("\(AppConfig.appName), to the front page")
            Spacer(minLength: theme.space3)
            HStack(spacing: Measure.Legal.navGap) {
              ForEach(LegalDocuments.all, id: \.key) { entry in
                LegalNavLink(entry.short, current: entry.key.jsEquals(docKey)) { navigate(entry.path) }
              }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Legal documents")
          }
        } main: {
          Group {
            if let document {
              LegalDocumentView(document: document, contents: true, scrollTo: { id in
                withAnimation(theme.motion.sheet) { proxy.scrollTo(id, anchor: .top) }
              })
            }
          }
          .frame(maxWidth: theme.characters(Measure.Legal.measure, size: theme.isTablet ? theme.textBase : theme.textMd), alignment: .leading)
          .frame(maxWidth: .infinity)
          .padding(.top, mainSpaceAbove)
          .padding(.bottom, theme.isTablet ? Measure.Legal.tabletSpaceBelow : Measure.Legal.mainSpaceBelow)
        } foot: {
          Button("Back to \(AppConfig.appName)") { navigate("/") }
            .buttonStyle(.plain)
            .underline()
          HStack(spacing: Measure.Legal.navGap) {
            ForEach(LegalDocuments.all, id: \.key) { entry in
              Button(entry.title) { navigate(entry.path) }
                .buttonStyle(.plain)
                .underline()
            }
          }
          .accessibilityElement(children: .contain)
          .accessibilityLabel("Legal")
        }
      }
      .background(PageGround().ignoresSafeArea())
      .onAppear {
        let hash = navigator.hash
        guard hash.count > 1 else { return }
        let raw = String(hash.dropFirst())
        let id = (try? JSURI.decodeURIComponent(raw)) ?? raw
        DispatchQueue.main.async { proxy.scrollTo(id, anchor: .top) }
      }
    }
  }

  private var mainSpaceAbove: CGFloat {
    if theme.isTablet { return Measure.Legal.tabletSpaceAbove }
    return Measure.Legal.mainSpaceAbove.of(theme.windowHeight)
  }
}

/// Terms and Privacy, as two words: the one being read is in ink, 600, with
/// a line under it, as a pressed key is.
struct LegalNavLink: View {
  @Environment(\.virgaTheme) private var theme
  let title: String
  let current: Bool
  let action: () -> Void

  init(_ title: String, current: Bool, action: @escaping () -> Void) {
    self.title = title
    self.current = current
    self.action = action
  }

  var body: some View {
    Button(action: action) {
      Text(title)
        .virgaText(.textBase, weight: current ? VirgaWeight.semibold : VirgaWeight.regular)
        .foregroundStyle(current ? theme.ink : theme.muted)
        .frame(minHeight: Measure.Touch.target)
        .overlay(alignment: .bottom) {
          if current {
            Rectangle().fill(theme.ink).frame(height: abs(theme.points(ThemeKit.segmentedOnUnderline.first?.y ?? .px(-2))))
          }
        }
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(current ? [.isSelected] : [])
  }
}

/// A legal document in a dialog. `docKey` is "terms", "privacy" or nil (closed).
struct LegalDialog: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Binding var docKey: String?
  @State private var shown: (key: String, anchor: String?)?

  func body(content: Content) -> some View {
    content.sheet(
      isPresented: Binding(get: { docKey != nil }, set: { if !$0 { docKey = nil } })
    ) {
      sheet
        .presentationDetents([.large])
        .presentationBackground(theme.surface)
        .presentationCornerRadius(Measure.Dialog.radius)
    }
    .onChange(of: docKey) { _, key in
      if let key { shown = (key, nil) }
    }
  }

  private var sheet: some View {
    let key = shown?.key ?? docKey ?? "terms"
    let document = LegalDocuments.readDocument(key)
    let entry = LegalDocuments.document(key)
    return ScrollViewReader { proxy in
      DialogFrame(title: document?.title ?? "", onClose: { docKey = nil }, hasActions: false) {
        VStack(alignment: .leading, spacing: 0) {
          Button {
            let path = entry?.path ?? "/"
            docKey = nil
            navigate(path)
          } label: {
            HStack(spacing: Measure.Legal.dialogLinkGap) {
              Text("Open as a page").underline()
              Image(systemName: Glyph.externalLink).font(.system(size: Measure.Legal.dialogLinkIcon))
            }
            .virgaText(.textSm)
            .foregroundStyle(theme.ink)
          }
          .buttonStyle(.plain)
          .padding(.bottom, Measure.Legal.dialogLinksSpaceBelow)
          .id("top")
          if let document {
            LegalDocumentView(
              document: document, skipTitle: true, inDialog: true,
              scrollTo: { id in withAnimation(theme.motion.sheet) { proxy.scrollTo(id, anchor: .top) } },
              onOpenDocument: { next, anchor in
                shown = (next, anchor)
                DispatchQueue.main.async { proxy.scrollTo(anchor ?? "top", anchor: .top) }
              })
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(document?.title ?? "")
      } actions: {
        EmptyView()
      }
    }
  }
}

extension View {
  /// LegalDialog over this view, while `docKey` names a document.
  func legalDialog(_ docKey: Binding<String?>) -> some View {
    modifier(LegalDialog(docKey: docKey))
  }
}
#endif
