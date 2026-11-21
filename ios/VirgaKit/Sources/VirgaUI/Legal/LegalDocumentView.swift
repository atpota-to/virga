// Ports src/legal/LegalDocument.jsx
// Ports src/legal/legal.css (.legal-text, .legal-h1/2/3, .legal-contents, .legal-table)
//
// A legal document, drawn from the blocks VirgaSession's LegalMarkdown read
// out of its Markdown (the same files the web shows, bundled with the app):
// headings, paragraphs, lists, tables and rules, with bold, emphasis, code
// and links inside them. `contents` lists the sections under the opening
// lines; `skipTitle` leaves the first heading out where a frame says it
// already. A link to a place on the page scrolls there; one to the other
// document opens it (`onOpenDocument`, for the dialog) or goes to its page;
// one to another site leaves the app. A table is three columns of
// sentences, which don't fit a phone: from 760 down each row is a block,
// its first cell its name and the rest under it with their headings.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaSession

/// The address a link inside the app's text goes to: `virga-nav:<href>`,
/// read back by the view that shows the text (an internal page, a place on
/// one).
enum InternalLink {
  static let scheme = "virga-nav"

  static func url(_ href: String) -> URL? {
    URL(string: "\(scheme):\(href)")
  }

  /// The href a `virga-nav:` address carries, or nil for any other.
  static func href(_ url: URL) -> String? {
    guard url.scheme == scheme else { return nil }
    let text = url.absoluteString
    return String(text.dropFirst(scheme.count + 1))
  }
}

public struct LegalDocumentView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(\.openURL) private var openURL
  private let document: LegalReadDocument
  private let contents: Bool
  private let skipTitle: Bool
  private let inDialog: Bool
  private let scrollTo: (String) -> Void
  private let onOpenDocument: ((String, String?) -> Void)?

  /// - Parameters:
  ///   - scrollTo: brings the block with that id into view (the scroll
  ///     view's reader, which the caller holds).
  ///   - onOpenDocument: takes a link to the other document (and the
  ///     section it names), for a place that shows them without changing
  ///     the address.
  public init(
    document: LegalReadDocument, contents: Bool = false, skipTitle: Bool = false, inDialog: Bool = false,
    scrollTo: @escaping (String) -> Void, onOpenDocument: ((String, String?) -> Void)? = nil
  ) {
    self.document = document
    self.contents = contents
    self.skipTitle = skipTitle
    self.inDialog = inDialog
    self.scrollTo = scrollTo
    self.onOpenDocument = onOpenDocument
  }

  private var size: CGFloat { inDialog || theme.isTablet ? theme.textBase : theme.textMd }

  public var body: some View {
    let blocks = shownBlocks
    let firstSection = blocks.firstIndex { if case .heading(2, _, _) = $0 { return true } else { return false } }
    let lead = firstSection.map { Array(blocks[..<$0]) } ?? blocks
    let rest = firstSection.map { Array(blocks[$0...]) } ?? []
    let outline = contents ? LegalMarkdown.outlineOf(blocks) : []
    VStack(alignment: .leading, spacing: Measure.Legal.textGap) {
      ForEach(Array(lead.enumerated()), id: \.offset) { _, block in
        LegalBlockView(block: block, size: size, inDialog: inDialog, afterContents: false)
      }
      if outline.count > 1 {
        LegalContents(outline: outline, scrollTo: scrollTo)
      }
      ForEach(Array(rest.enumerated()), id: \.offset) { index, block in
        LegalBlockView(block: block, size: size, inDialog: inDialog, afterContents: index == 0 && outline.count > 1)
      }
    }
    .environment(\.openURL, OpenURLAction { url in open(url) })
  }

  private var shownBlocks: [MarkdownBlock] {
    guard skipTitle, let first = document.blocks.first, case .heading(1, _, _) = first else { return document.blocks }
    return Array(document.blocks.dropFirst())
  }

  /// A link pressed in the text.
  private func open(_ url: URL) -> OpenURLAction.Result {
    guard let href = InternalLink.href(url) else { return .systemAction }
    let target = LegalDocuments.resolveDocumentLink(href)
    let anchor = href.jsIndexOf("#") == -1 ? nil : href.jsSlice(href.jsIndexOf("#") + 1)
    if target.anchor == true {
      if let anchor { scrollTo(anchor) }
      return .handled
    }
    if let key = target.document {
      if key.jsEquals(document.key) {
        if let anchor { scrollTo(anchor) }
      } else if let onOpenDocument {
        onOpenDocument(key, anchor)
      } else if let to = target.href {
        navigate(to)
      }
      return .handled
    }
    if let to = target.href { navigate(to) }
    return .handled
  }
}

/// The text of inline nodes, styled, as one AttributedString.
@MainActor
enum LegalInline {
  struct Style {
    var strong = false
    var em = false
    var code = false
    var link: URL?
  }

  static func text(_ nodes: [MarkdownInline], theme: VirgaTheme, size: CGFloat, style: Style = Style()) -> AttributedString {
    var out = AttributedString()
    for node in nodes {
      switch node {
      case .text(let value):
        out += piece(value, theme: theme, size: size, style: style)
      case .code(let value):
        var inner = style
        inner.code = true
        out += piece(value, theme: theme, size: size, style: inner)
      case .strong(let children):
        var inner = style
        inner.strong = true
        out += text(children, theme: theme, size: size, style: inner)
      case .em(let children):
        var inner = style
        inner.em = true
        out += text(children, theme: theme, size: size, style: inner)
      case .link(let href, let children):
        let target = LegalDocuments.resolveDocumentLink(href)
        guard let to = target.href else {
          out += text(children, theme: theme, size: size, style: style)
          continue
        }
        var inner = style
        inner.link = target.external ? URL(string: to) : InternalLink.url(to)
        out += text(children, theme: theme, size: size, style: inner)
      }
    }
    return out
  }

  static func piece(_ value: String, theme: VirgaTheme, size: CGFloat, style: Style) -> AttributedString {
    var piece = AttributedString(value)
    if style.code {
      piece.font = theme.codeFont(around: size)
    } else {
      let font = theme.font(size: size, weight: style.strong ? VirgaWeight.semibold : VirgaWeight.regular)
      piece.font = style.em ? font.italic() : font
    }
    if style.strong || style.link != nil {
      piece.foregroundColor = theme.ink
    }
    if let link = style.link {
      piece.link = link
      piece.underlineStyle = Text.LineStyle.single
    }
    return piece
  }
}

struct LegalBlockView: View {
  @Environment(\.virgaTheme) private var theme
  let block: MarkdownBlock
  let size: CGFloat
  let inDialog: Bool
  /// The first section after the contents brings no rule of its own.
  let afterContents: Bool

  var body: some View {
    switch block {
    case .heading(let level, let id, let children):
      heading(level, id: id, children)
    case .paragraph(let children):
      paragraph(children)
    case .list(let list):
      LegalListView(list: list, size: size)
    case .table(let head, let rows):
      LegalTableView(head: head, rows: rows, size: size)
    case .rule:
      Rectangle().fill(theme.line).frame(height: 1).padding(.vertical, Measure.Legal.ruleSpace)
    }
  }

  private func paragraph(_ children: [MarkdownInline]) -> some View {
    Text(LegalInline.text(children, theme: theme, size: size))
      .virgaText(size: size, lineHeight: Measure.Legal.lineHeight)
      .foregroundStyle(theme.ink2)
      .tint(theme.ink)
      .fixedSize(horizontal: false, vertical: true)
  }

  @ViewBuilder
  private func heading(_ level: Int, id: String, _ children: [MarkdownInline]) -> some View {
    let words = LegalMarkdown.inlineText(children)
    switch level {
    case 1:
      Text(words)
        .virgaText(size: theme.points(Measure.Legal.h1Size), weight: VirgaWeight.semibold, tracking: Measure.Legal.h1Tracking)
        .foregroundStyle(theme.ink)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.bottom, Measure.Legal.h1SpaceBelow)
        .accessibilityAddTraits(.isHeader)
        .id(id)
    case 2:
      let space = inDialog ? Measure.Legal.dialogH2SpaceAbove : Measure.Legal.h2SpaceAbove
      let ruleSpace = inDialog ? Measure.Legal.dialogH2RuleSpace : Measure.Legal.h2RuleSpace
      VStack(alignment: .leading, spacing: 0) {
        if !afterContents {
          Rectangle().fill(theme.line).frame(height: 1).padding(.bottom, ruleSpace)
        }
        Text(words)
          .virgaText(inDialog ? .textLg : .textXl, weight: VirgaWeight.semibold, lineHeight: ThemeKit.headingLineHeight, tracking: Measure.Legal.h2Tracking)
          .foregroundStyle(theme.ink)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
      }
      .padding(.top, afterContents ? 0 : space)
      .id(id)
    default:
      Text(words)
        .virgaText(.textMd, weight: VirgaWeight.semibold)
        .foregroundStyle(theme.ink)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, Measure.Legal.h3SpaceAbove)
        .accessibilityAddTraits(.isHeader)
        .id(id)
    }
  }
}

struct LegalListView: View {
  @Environment(\.virgaTheme) private var theme
  let list: MarkdownList
  let size: CGFloat

  var body: some View {
    VStack(alignment: .leading, spacing: Measure.Legal.listGap) {
      ForEach(Array(list.items.enumerated()), id: \.offset) { index, item in
        HStack(alignment: .firstTextBaseline, spacing: 0) {
          Text(list.ordered ? "\((list.start ?? 1) + index)." : "•")
            .virgaText(size: size, lineHeight: Measure.Legal.lineHeight)
            .foregroundStyle(theme.ink2)
            .frame(width: size * Measure.Legal.listIndentEm, alignment: .leading)
            .accessibilityHidden(true)
          VStack(alignment: .leading, spacing: Measure.Legal.listGap) {
            Text(LegalInline.text(item.children, theme: theme, size: size))
              .virgaText(size: size, lineHeight: Measure.Legal.lineHeight)
              .foregroundStyle(theme.ink2)
              .tint(theme.ink)
              .fixedSize(horizontal: false, vertical: true)
            if let sub = item.sub {
              LegalListView(list: sub, size: size)
            }
          }
        }
      }
    }
  }
}

struct LegalTableView: View {
  @Environment(\.virgaTheme) private var theme
  let head: [[MarkdownInline]]
  let rows: [[[MarkdownInline]]]
  let size: CGFloat

  var body: some View {
    if theme.isTablet {
      blocks
    } else {
      grid
    }
  }

  private var labels: [String] { head.map { LegalMarkdown.inlineText($0) } }

  private func cell(_ nodes: [MarkdownInline], first: Bool) -> some View {
    Text(LegalInline.text(nodes, theme: theme, size: theme.textBase, style: LegalInline.Style(strong: false)))
      .virgaText(.textBase, weight: first ? VirgaWeight.medium : VirgaWeight.regular, lineHeight: Measure.Legal.contentsLineHeight)
      .foregroundStyle(first ? theme.ink : theme.ink2)
      .tint(theme.ink)
      .fixedSize(horizontal: false, vertical: true)
  }

  private var grid: some View {
    let pad = Measure.Legal.cellPadding
    return Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
      GridRow {
        ForEach(Array(labels.enumerated()), id: \.offset) { c, label in
          Text(label)
            .virgaText(.textSm, weight: VirgaWeight.medium)
            .foregroundStyle(theme.muted)
            .padding(.bottom, pad.bottom)
            .padding(.leading, c == 0 ? 0 : pad.leading)
            .padding(.trailing, c == labels.count - 1 ? 0 : pad.trailing)
        }
      }
      Rectangle().fill(theme.rule).frame(height: 1).gridCellUnsizedAxes(.horizontal)
      ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
        GridRow {
          ForEach(Array(row.enumerated()), id: \.offset) { c, nodes in
            cell(nodes, first: c == 0)
              .padding(.vertical, pad.top)
              .padding(.leading, c == 0 ? 0 : pad.leading)
              .padding(.trailing, c == row.count - 1 ? 0 : pad.trailing)
          }
        }
        Rectangle().fill(theme.line).frame(height: 1).gridCellUnsizedAxes(.horizontal)
      }
    }
  }

  private var blocks: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
        VStack(alignment: .leading, spacing: Measure.Legal.blockCellGap) {
          ForEach(Array(row.enumerated()), id: \.offset) { c, nodes in
            VStack(alignment: .leading, spacing: Measure.Legal.blockLabelGap) {
              if c > 0, c < labels.count {
                Text(labels[c])
                  .virgaText(.textSm, weight: VirgaWeight.medium)
                  .foregroundStyle(theme.muted)
              }
              Text(LegalInline.text(nodes, theme: theme, size: theme.textBase))
                .virgaText(.textBase, weight: c == 0 ? VirgaWeight.semibold : VirgaWeight.regular, lineHeight: Measure.Legal.contentsLineHeight)
                .foregroundStyle(c == 0 ? theme.ink : theme.ink2)
                .tint(theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
          }
        }
        .padding(.vertical, Measure.Legal.blockPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
      }
    }
    .overlay(alignment: .top) { Rectangle().fill(theme.rule).frame(height: 1) }
  }
}

/// `.legal-contents`: the sections, listed, down one column and then the next.
struct LegalContents: View {
  @Environment(\.virgaTheme) private var theme
  let outline: [MarkdownOutlineEntry]
  let scrollTo: (String) -> Void

  var body: some View {
    let columns = theme.isPhone ? 1 : 2
    let perColumn = (outline.count + columns - 1) / columns
    HStack(alignment: .top, spacing: Measure.Legal.contentsColumnGap) {
      ForEach(0..<columns, id: \.self) { column in
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(outline.enumerated()).filter { $0.offset / max(1, perColumn) == column }, id: \.offset) { index, entry in
            Button {
              scrollTo(entry.id)
            } label: {
              HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text("\(index + 1).")
                  .frame(width: theme.textBase * Measure.Legal.contentsIndentEm, alignment: .leading)
                Text(entry.text).underline()
                  .multilineTextAlignment(.leading)
                  .fixedSize(horizontal: false, vertical: true)
              }
              .virgaText(.textBase, lineHeight: Measure.Legal.contentsLineHeight)
              .foregroundStyle(theme.ink)
              .padding(.vertical, Measure.Legal.contentsLinkPadding)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .padding(.vertical, Measure.Legal.contentsPadding)
    .overlay(alignment: .top) { Rectangle().fill(theme.rule).frame(height: 1) }
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .padding(.top, Measure.Legal.contentsSpaceAbove)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Contents")
  }
}
#endif
