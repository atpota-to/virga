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
// goes to the section it names; VoiceOver is taken to its title. "Open as a
// page" is the web's new tab: the page over the screen the dialog is on
// (LegalPageCover), which stays as it was under it.

#if canImport(UIKit)
import SwiftUI
import UIKit
import VirgaCore
import VirgaSession

public struct LegalPageView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(ShellNavigator.self) private var navigator
  private let docKey: String
  /// The section to open at: the address's hash, unless given.
  private let hash: String?
  /// Closes the page where it was opened over the app (a dialog's "Open as a
  /// page"); nil when the page is the app's address, and "Back to Virga"
  /// goes to the front.
  private let onBack: (() -> Void)?

  public init(docKey: String) {
    self.init(docKey: docKey, hash: nil, onBack: nil)
  }

  init(docKey: String, hash: String?, onBack: (() -> Void)?) {
    self.docKey = docKey
    self.hash = hash
    self.onBack = onBack
  }

  private func back() {
    if let onBack {
      onBack()
    } else {
      navigate("/")
    }
  }

  public var body: some View {
    let document = LegalDocuments.readDocument(docKey)
    ScrollViewReader { proxy in
      ScrollView {
        LandingFrame {
          HStack(alignment: .center) {
            Button { back() } label: { Brand() }
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
          Button("Back to \(AppConfig.appName)") { back() }
            .buttonStyle(.plain)
            .underline()
            .footTarget()
          HStack(spacing: Measure.Legal.navGap) {
            ForEach(LegalDocuments.all, id: \.key) { entry in
              Button(entry.title) { navigate(entry.path) }
                .buttonStyle(.plain)
                .underline()
                .footTarget()
            }
          }
          .accessibilityElement(children: .contain)
          .accessibilityLabel("Legal")
        }
      }
      .background(PageGround().ignoresSafeArea())
      .onAppear {
        let hash = self.hash ?? navigator.hash
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
  @Binding var docKey: String?
  @State private var shown: (key: String, anchor: String?)?
  /// The document opened as a page, over the dialog.
  @State private var asPage: String?

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
            asPage = entry?.key ?? key
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
                DispatchQueue.main.async {
                  proxy.scrollTo(anchor ?? "top", anchor: .top)
                  // The new document, by its title (the dialog's first element).
                  UIAccessibility.post(notification: .screenChanged, argument: nil)
                }
              })
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(document?.title ?? "")
      } actions: {
        EmptyView()
      }
      .fullScreenCover(isPresented: Binding(get: { asPage != nil }, set: { if !$0 { asPage = nil } })) {
        LegalPageCover(docKey: asPage ?? key) { asPage = nil }
      }
    }
  }
}

/// A legal document opened as a page from its dialog (the web's new tab):
/// over the screen the dialog was opened from, which stays as it was under
/// it. Back to Virga and the mark close it; a link to either document shows
/// that one here, at the section it names; any other link closes it and
/// goes there.
struct LegalPageCover: View {
  @Environment(\.navigate) private var navigate
  @State private var shown: (key: String, hash: String)
  private let onClose: () -> Void

  init(docKey: String, onClose: @escaping () -> Void) {
    _shown = State(initialValue: (key: docKey, hash: ""))
    self.onClose = onClose
  }

  var body: some View {
    let outside = navigate
    let close = onClose
    LegalPageView(docKey: shown.key, hash: shown.hash, onBack: onClose)
      .id("\(shown.key)\(shown.hash)")
      .environment(\.navigate, NavigateAction { href in
        let cut = href.jsIndexOf("#")
        let path = cut == -1 ? href : href.jsSlice(0, cut)
        if let key = LegalDocuments.documentFor(path) {
          shown = (key: key, hash: cut == -1 ? "" : href.jsSlice(cut))
        } else {
          close()
          outside(href)
        }
      })
  }
}

extension View {
  /// LegalDialog over this view, while `docKey` names a document.
  func legalDialog(_ docKey: Binding<String?>) -> some View {
    modifier(LegalDialog(docKey: docKey))
  }
}
#endif
