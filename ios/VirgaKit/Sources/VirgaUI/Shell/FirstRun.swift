// Ports src/shell/FirstRun.jsx
// Ports src/shell/shell.css (.first-run)
//
// Before there is anything to chart, on a page that needs the archive
// (ShellRoutes.needsArchive): what a build reads, where it goes, and the
// one button. While the build runs, its steps (SyncSteps), every one named
// with its own segment. A build that failed says what went wrong under the
// button. The words are the web's, "in this browser" included, for now.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive

struct FirstRunPage: View {
  @Environment(\.virgaTheme) private var theme
  let archive: ArchiveModel

  var body: some View {
    VirgaPage(header: nil, contentTop: theme.pageTop) {
      VStack(alignment: .leading, spacing: Measure.FirstRun.cardGap) {
        Text("Build your archive")
          .virgaText(
            .textTitle, weight: VirgaWeight.semibold, lineHeight: Measure.PageHeader.titleLineHeight,
            tracking: Measure.PageHeader.titleTracking)
          .foregroundStyle(theme.ink)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
          .accessibilityIdentifier("first-run-title")
        Text(
          "Virga works your analytics out in this browser, from your own data. The first build takes a minute or two for most accounts; after that, a sync only fetches what’s new."
        )
        .virgaText(.textMd)
        .foregroundStyle(theme.ink2)
        .fixedSize(horizontal: false, vertical: true)
        list
        if !archive.data.persistent {
          Callout(tone: .warn) {
            Text(
              archive.data.blocked
                ? "Another Virga tab is holding the archive open, so a build here would only last the session. Close that tab, then reload this one to keep it."
                : "This browser is blocking IndexedDB, so the archive will only last the session.")
          }
        }
        if let sync = archive.sync {
          SyncSteps(sync: sync)
        } else {
          Button("Build your archive") {
            Task { await archive.runSync(.full) }
          }
          .buttonStyle(.virga(.primary, size: .large))
          .accessibilityIdentifier("first-run-build")
        }
        if let error = archive.syncError, archive.sync == nil {
          Callout(tone: .danger) {
            Text(error)
          }
          .accessibilityIdentifier("first-run-error")
        }
      }
      .frame(maxWidth: Measure.FirstRun.cardMaxWidth, alignment: .leading)
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Build your archive")
    }
  }

  /// `.first-run-list`: under a rule in ink, a hairline under each.
  private var list: some View {
    VStack(alignment: .leading, spacing: 0) {
      item(Glyph.database, "Your repo", ", every record in every collection, in one download")
      item(Glyph.followers, "Your followers", " and the day each one followed you, and who you follow")
      item(Glyph.shieldCheck, "Who blocks you", ", directly or through a moderation list")
      item(
        Glyph.heart, "Engagement",
        ": the likes, reposts, replies and quotes on every post, and your recent notifications")
      row(Glyph.cloud, Text("It’s kept ") + strong("in this browser") + Text(". Virga’s server never keeps a copy."))
    }
    .overlay(alignment: .top) { Rectangle().fill(theme.rule).frame(height: 1) }
  }

  private func strong(_ words: String) -> Text {
    Text(words).font(theme.font(.textBase, weight: VirgaWeight.semibold)).foregroundStyle(theme.ink)
  }

  private func item(_ glyph: String, _ lead: String, _ rest: String) -> some View {
    row(glyph, strong(lead) + Text(rest))
  }

  private func row(_ glyph: String, _ words: Text) -> some View {
    HStack(alignment: .top, spacing: Measure.FirstRun.itemGap) {
      // Every glyph fits the same 16-point box, as the web's icons do (the
      // two people and the cloud are wider than the rest at a font size).
      Image(systemName: glyph)
        .resizable()
        .scaledToFit()
        .foregroundStyle(theme.ink)
        .frame(width: Measure.FirstRun.icon, height: Measure.FirstRun.icon)
        .padding(.top, Measure.FirstRun.iconSpaceAbove)
        .accessibilityHidden(true)
      // The words run to the column's edge, the one 12-point gap before
      // them (`.first-run-list li { gap: 12px }`).
      words
        .virgaText(.textBase)
        .foregroundStyle(theme.ink2)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.vertical, Measure.FirstRun.itemPadding)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .combine)
  }
}
#endif
