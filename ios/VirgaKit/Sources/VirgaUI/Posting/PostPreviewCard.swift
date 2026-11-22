// Ports src/posting/ui/PostPreview.jsx
// Ports src/posting/posting.css (.post-preview)
//
// A post, small: who wrote it, its words, what's attached, when, and its
// counts when there are any, over VirgaPosting's PostPreview model. Takes a
// post view, a bare record, or both (`uri` names it when only a record is
// known). `compact` is the one-line version, for a reply's "Replying to" or
// a row in a list. A hairline round it, as round any post shown inside
// something else.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting

struct PostPreviewCard: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  var view: JSONValue? = nil
  var record: JSONValue? = nil
  var uri: String? = nil
  var compact = false

  var body: some View {
    let m = PostPreview.postPreviewModel(view: view, record: record, uri: uri.map(JSONValue.string), compact: compact)
    let handle = m.author?.handle?.stringValue
    let name = m.author?.displayName ?? handle.map { "@\($0)" }
    let at = m.at?.stringValue
    let hasCounts = m.counts != nil && !compact
    let hasLink = m.url != nil && !compact
    VStack(alignment: .leading, spacing: compact ? Measure.Posting.previewCompactGap : Measure.Posting.previewGap) {
      if let author = m.author {
        HStack(spacing: Measure.Posting.previewHeadGap) {
          Avatar(src: author.avatar?.stringValue, name: name, size: .small)
          HStack(alignment: .firstTextBaseline, spacing: Measure.Posting.previewWhoGap) {
            if let name {
              Text(name).virgaText(.textSm, weight: VirgaWeight.semibold).foregroundStyle(theme.ink).lineLimit(1)
            }
            if let handle, author.displayName != nil {
              Text("@\(handle)").virgaText(.textSm).foregroundStyle(theme.muted).lineLimit(1)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          if let at { time(at) }
        }
      }
      if !m.text.isEmpty {
        Text(m.text)
          .virgaText(compact ? .textSm : .textBase, lineHeight: Measure.Posting.previewLineHeight)
          .foregroundStyle(theme.ink)
          .fixedSize(horizontal: false, vertical: true)
      } else if m.embed == nil {
        Text("No text").virgaText(compact ? .textSm : .textBase).foregroundStyle(theme.muted)
      }
      if m.embed != nil || (m.author == nil && at != nil) || hasCounts || hasLink {
        FlowLayout(spacing: Measure.Posting.previewFootGap, lineSpacing: Measure.Posting.previewFootRowGap) {
          if let embed = m.embed {
            Label(embed, systemImage: "paperclip").labelStyle(PreviewLabelStyle())
          }
          if m.author == nil, let at { time(at) }
          if hasCounts, let counts = m.counts {
            HStack(spacing: Measure.Posting.previewCountsGap) {
              count(Glyph.reply, counts.replies, "Replies")
              count(Glyph.repost, counts.reposts, "Reposts")
              count(Glyph.quote, counts.quotes, "Quotes")
              count(Glyph.heart, counts.likes, "Likes")
            }
          }
          if hasLink, let url = m.url.flatMap(URL.init(string:)) {
            Button {
              openURL(url)
            } label: {
              Label("Bluesky", systemImage: Glyph.externalLink).labelStyle(PreviewLabelStyle())
                .foregroundStyle(theme.ink)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
          }
        }
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
      }
    }
    .padding(compact ? Measure.Posting.previewCompactPadding : Measure.Posting.previewPadding)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: Measure.Posting.previewRadius).strokeBorder(theme.line, lineWidth: 1))
    .accessibilityElement(children: .contain)
  }

  private func time(_ at: String) -> some View {
    Text(Time.relativeTime(at, now: SyncStatus.now()))
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
      .lineLimit(1)
      .help(Time.formatDateShort(at))
  }

  private func count(_ symbol: String, _ value: JSONValue, _ word: String) -> some View {
    let n = value.jsNumber
    let shown = AppLocale.formatNumber(n.isFinite ? n : 0)
    return Label(shown, systemImage: symbol)
      .labelStyle(PreviewLabelStyle())
      .help(word)
      .accessibilityLabel("\(word) \(shown)")
  }
}

/// `.post-preview-embed`, `.post-preview-counts > span`: a glyph and its words, 4 apart.
struct PreviewLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: Measure.Posting.previewIconGap) {
      configuration.icon.font(.system(size: Measure.Posting.previewIcon))
      configuration.title
    }
  }
}

extension Measure {
  /// posting.css's measures (the long-session notice, a post shown small).
  public enum Posting {
    /// `.needs-backend { gap: 14px }`, its icon 18 and 2 down, its words `gap: 10px; max-width: 70ch`.
    public static let needsBackendGap: CGFloat = 14
    public static let needsBackendIcon: CGFloat = 18
    public static let needsBackendIconTop: CGFloat = 2
    public static let needsBackendTextGap: CGFloat = 10
    public static let needsBackendMeasure: CGFloat = 70
    /// `.post-preview { gap: 6px; padding: 12px 14px; border-radius: 12px }`, compact `gap: 4px; padding: 9px 12px`.
    public static let previewGap: CGFloat = 6
    public static let previewCompactGap: CGFloat = 4
    public static let previewPadding = EdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14)
    public static let previewCompactPadding = EdgeInsets(top: 9, leading: 12, bottom: 9, trailing: 12)
    public static let previewRadius: CGFloat = 12
    /// `.post-preview-head { gap: 8px }`, `.post-preview-who { gap: 6px }`, the words' line 1.45.
    public static let previewHeadGap: CGFloat = 8
    public static let previewWhoGap: CGFloat = 6
    public static let previewLineHeight: Double = 1.45
    /// `.post-preview-foot { gap: 6px 14px }`, `.post-preview-counts { gap: 12px }`, a glyph 13 and 4 from its words.
    public static let previewFootGap: CGFloat = 14
    public static let previewFootRowGap: CGFloat = 6
    public static let previewCountsGap: CGFloat = 12
    public static let previewIcon: CGFloat = 13
    public static let previewIconGap: CGFloat = 4
  }
}
#endif
