// Ports src/people/people.jsx
// Ports src/reports/PostRow.jsx
// Ports src/dashboards/dashboards.css (.person-row, .person-meta, .post-row, .post-count)
//
// The people and posts a report or a card lists. A person: their picture,
// their name (a link to their profile on Bluesky), and under it one line,
// cut short at its end, of their handle where the name isn't it, "follows
// you" and a fact, a dot between them; in a list under 600 wide a row with
// a fact leaves "follows you" out, and under 480 the handle too
// (PersonList measures the list). Then the number at the right, the way to
// your history with them (the Interaction lookup; not on a phone, nor in
// a dashboard card 400 wide or less), and Follow where the archive knows
// who you follow, its slot one width so the column lines up. Names come
// from the archive's cards (wantActors fills them in), else the follower
// list, else a card the caller remembers (the unfollows log's). A post:
// its words (a link to it on Bluesky, two lines at most), and a meta line
// of when (relative within a week), whether it was a reply or a quote, and
// its counts by kind, the ones not counted dimmed.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

enum People {
  /// A person's card: `{ handle, displayName, avatar }`.
  typealias Card = (handle: String?, displayName: String?, avatar: String?)

  /// `cardFor(archive, did)`: the archive's card, else the follower row's.
  @MainActor
  static func card(_ archive: ArchiveModel, _ report: ReportArchive, _ did: String) -> Card {
    found(archive, report, did) ?? (nil, nil, nil)
  }

  /// `cardFor(archive, did)`, nil where neither has one.
  @MainActor
  static func found(_ archive: ArchiveModel, _ report: ReportArchive, _ did: String) -> Card? {
    if let card = archive.actors[did] { return (card.handle, card.displayName, card.avatar) }
    if let row = ReportModels.relationSets(report).followerCards[JSKey(did)] {
      return (row.handle.isEmpty ? nil : row.handle, row.displayName.isEmpty ? nil : row.displayName, row.avatar.isEmpty ? nil : row.avatar)
    }
    return nil
  }

  /// `resolved?.handle ? resolved : given?.handle ? given : resolved || given`.
  static func choose(_ resolved: Card?, _ given: Card?) -> Card {
    if let resolved, !(resolved.handle ?? "").isEmpty { return resolved }
    if let given, !(given.handle ?? "").isEmpty { return given }
    return resolved ?? given ?? (nil, nil, nil)
  }

  /// `displayName(card, did)`.
  static func displayName(_ handle: String?, _ name: String?, _ did: String) -> String {
    if let name, !name.isEmpty { return name }
    if let handle, !handle.isEmpty { return "@\(handle)" }
    return did
  }

  /// `profileUrl(card, did)`.
  static func profileUrl(_ handle: String?, _ did: String) -> URL? {
    URL(string: "https://bsky.app/profile/\(JSURI.encodeURIComponent(handle.flatMap { $0.isEmpty ? nil : $0 } ?? did))")
  }
}

private struct PersonListWidthKey: EnvironmentKey {
  static let defaultValue: CGFloat? = nil
}

extension EnvironmentValues {
  /// The width of the list a person row is in (`container: rows`).
  var personListWidth: CGFloat? {
    get { self[PersonListWidthKey.self] }
    set { self[PersonListWidthKey.self] = newValue }
  }
}

/// `.widget-rows`: a list of people, measured, so what the line under each
/// name says goes by the room the list has, the same on every row.
struct PersonList<Content: View>: View {
  @ViewBuilder let content: () -> Content
  @State private var width: CGFloat?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      content()
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      GeometryReader { geometry in
        Color.clear
          .onAppear { width = geometry.size.width }
          .onChange(of: geometry.size.width) { _, next in width = next }
      }
    )
    .environment(\.personListWidth, width)
  }
}

/// `PersonRow`.
struct PersonRow: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(\.openURL) private var openURL
  @Environment(\.personListWidth) private var listWidth
  /// The dashboard card the row is in, if it is in one (`@container widget`).
  @Environment(\.widgetWidth) private var widgetWidth
  @Environment(ArchiveModel.self) private var model: ArchiveModel?
  let archive: ReportArchive
  let did: String
  /// A card the caller remembers (someone who has since left the follower
  /// list, as the log has them), until a fresher one is resolved.
  var card: People.Card? = nil
  var meta: String? = nil
  var value: String? = nil
  var follow = false
  var followLabel = "Follow"
  var rel = true
  /// After a follow or an unfollow went through (People's kept rows).
  var onFollowed: ((String) -> Void)? = nil
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    let resolved = model.flatMap { People.found($0, archive, did) }
    let face = People.choose(resolved, card)
    let name = People.displayName(face.handle, face.displayName, did)
    // `name.replace(/^@/, '') !== card.handle`: no handle under a name that already is it.
    let bare = name.hasPrefix("@") ? String(name.dropFirst()) : name
    let handle = face.handle.flatMap { h in h.isEmpty || bare.jsEquals(h) ? nil : h }
    let sets = ReportModels.relationSets(archive)
    let followsYou = rel && sets.isFollower(did)
    let phone = theme.isPhone
    HStack(spacing: phone ? Measure.Dashboard.phonePersonGap : Measure.Dashboard.personGap) {
      Avatar(src: face.avatar, name: Avatar.named(face.displayName, face.handle))
      // `.person-main { line-height: 1.35 }`: each single line in its box.
      VStack(alignment: .leading, spacing: 0) {
        Button(name) { if let url = People.profileUrl(face.handle, did) { openURL(url) } }
          .buttonStyle(.plain)
          .virgaText(.textMd, weight: VirgaWeight.medium, lineHeight: Measure.Dashboard.personLineHeight, lineBox: true)
          .foregroundStyle(theme.ink)
          .lineLimit(1)
          .truncationMode(.tail)
          .accessibilityAddTraits(.isLink)
        if let line = metaLine(handle: handle, followsYou: followsYou) {
          Text(line)
            .virgaText(.textSm, lineHeight: Measure.Dashboard.personLineHeight, lineBox: true)
            .foregroundStyle(theme.muted)
            .lineLimit(1)
            .truncationMode(.tail)
        }
        if let error {
          Text(error).virgaText(.textSm).foregroundStyle(theme.danger).fixedSize(horizontal: false, vertical: true)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if let value {
        Text(value).virgaText(.textBase, weight: VirgaWeight.semibold).foregroundStyle(theme.ink).fixedSize()
      }
      // A phone gives the name the room: the way to your history goes; so
      // does a dashboard card 400 wide or less, room for a name, a count
      // and Follow.
      if !phone, (widgetWidth ?? .infinity) > Measure.Dashboard.personHistoryHiddenAt, !did.jsEquals(archive.did) {
        Button {
          navigate(InteractionModel.lookupHref(did))
        } label: {
          Image(systemName: Glyph.history)
        }
        .buttonStyle(.virga(.ghost, size: .small, icon: true))
        .accessibilityLabel("See your history with \(name)")
      }
      if follow, archive.meta.following != nil, let model {
        followButton(model, sets: sets, name: name, phone: phone)
      }
    }
    .padding(.vertical, theme.rowPad)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }

  /// `.person-meta`: the handle, "follows you" and the fact, a dot between
  /// them, on one line; a narrow list keeps the fact.
  private func metaLine(handle: String?, followsYou: Bool) -> String? {
    let width = listWidth ?? .infinity
    let keepRel = meta == nil || width > Measure.Dashboard.personRelHiddenAt
    let keepHandle = meta == nil || width > Measure.Dashboard.personHandleHiddenAt
    var parts: [String] = []
    if let handle, keepHandle { parts.append("@\(handle)") }
    if followsYou, keepRel { parts.append("follows you") }
    if let meta { parts.append(meta) }
    // The dot 6 from both words: an en space either side.
    return parts.isEmpty ? nil : parts.joined(separator: "\u{2002}·\u{2002}")
  }

  /// FollowButton: the kit's small outline, Following the word alone; one
  /// slot wide above a phone, so the column of them lines up. On a phone
  /// Following is a quiet word flush with the row's end
  /// (`.follow-button.is-on { padding-inline: 0 }`).
  private func followButton(_ model: ArchiveModel, sets: RelationSets, name: String, phone: Bool) -> some View {
    let on = sets.following.contains { $0.jsEquals(did) }
    let slot: CGFloat? = phone ? nil : max(0, Measure.Dashboard.followMinWidth - 2 * theme.points(ThemeKit.smallButtonPadding.left))
    return Button {
      busy = true
      Task {
        do {
          try await model.setFollow(did, !on)
          error = nil
          onFollowed?(did)
        } catch {
          self.error = "Couldn’t \(on ? "unfollow" : "follow"): \(error.localizedDescription)"
        }
        busy = false
      }
    } label: {
      Text(on ? "Following" : followLabel)
        .fixedSize()
        .frame(minWidth: slot)
        // Cancels the button body's own padding.
        .padding(.horizontal, phone && on ? -theme.points(ThemeKit.smallButtonPadding.left) : 0)
    }
    .buttonStyle(.virga(size: .small, isOn: on))
    .disabled(busy || model.sync?.step == "following")
    .accessibilityLabel(on ? "Unfollow \(name)" : "Follow \(name)")
  }
}

/// `PostRow`, with `PostMeta`.
struct PostRowView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  let post: PostRow
  let did: String
  var kind = "all"
  var rank: Int? = nil
  var breakdown = true

  static let weekMs: Double = 7 * 86_400_000
  static let counts: [(key: String, kind: String, glyph: String, one: String, many: String)] = [
    ("likes", "like", Glyph.heart, "like", "likes"), ("reposts", "repost", Glyph.repost, "repost", "reposts"),
    ("replies", "reply", Glyph.reply, "reply", "replies"), ("quotes", "quote", Glyph.quote, "quote", "quotes"),
  ]

  /// `postText(post)`.
  static func text(_ post: PostRow) -> String {
    let words = (post.text ?? "").jsTrimmed()
    if !words.isEmpty { return words }
    return post.hasMedia == true ? "(media post)" : post.quoteOf != nil ? "(quote post)" : "(no text)"
  }

  /// `postWhen(at, now)`.
  static func when(_ at: String?, now: Double = SyncStatus.now()) -> String {
    let t = JSDate.parse(at ?? "", timeZone: AppLocale.activeTimeZone())
    guard t.isFinite else { return "" }
    if now - t < weekMs { return Time.relativeTime(t, now: now) }
    let zone = AppLocale.activeTimeZone()
    let sameYear = JSDate.fields(t, timeZone: zone)?.year == JSDate.fields(now, timeZone: zone)?.year
    return AppLocale.toLocaleDateString(t, DateFormatOptions(year: sameYear ? nil : "numeric", month: "short", day: "numeric"))
  }

  private func count(_ key: String) -> Int {
    switch key {
    case "likes": return post.likes
    case "reposts": return post.reposts
    case "replies": return post.replies
    default: return post.quotes
    }
  }

  var body: some View {
    HStack(alignment: .top, spacing: Measure.Dashboard.postGap) {
      if let rank {
        Text("\(rank)").virgaText(.textBase).foregroundStyle(theme.muted).frame(width: Measure.Dashboard.postRank, alignment: .leading)
      }
      VStack(alignment: .leading, spacing: Measure.Dashboard.postMainGap) {
        Button(Self.text(post)) {
          if let rkey = post.rkey, let url = URL(string: "https://bsky.app/profile/\(did)/post/\(JSURI.encodeURIComponent(rkey))") {
            openURL(url)
          }
        }
        .buttonStyle(.plain)
        .virgaText(.textMd, lineHeight: Measure.Dashboard.postTextLineHeight)
        .foregroundStyle(theme.ink)
        .lineLimit(2)
        .multilineTextAlignment(.leading)
        .accessibilityAddTraits(.isLink)
        meta
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if !breakdown {
        Text(AppLocale.formatNumber(Analytics.engagementOf(post, kind)))
          .virgaText(.textBase, weight: VirgaWeight.semibold)
          .foregroundStyle(theme.ink)
      }
    }
    .padding(.vertical, theme.rowPad)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }

  /// `PostMeta`: when · reply · quote · the counts, 12 apart with no dots.
  private var meta: some View {
    let shown = breakdown ? Self.counts.filter { count($0.key) > 0 } : []
    let words = [Self.when(post.at)] + (post.replyTo != nil ? ["reply"] : []) + (post.quoteOf != nil ? ["quote"] : [])
    return FlowLayout(spacing: 0, lineSpacing: 0, alignment: .center) {
      ForEach(Array(words.enumerated()), id: \.offset) { index, word in
        MetaPiece(isLast: shown.isEmpty && index == words.count - 1) { Text(word) }
      }
      if !shown.isEmpty {
        MetaPiece(isLast: true) {
          HStack(spacing: theme.points(ThemeKit.metaGroupGap)) {
            ForEach(shown, id: \.key) { c in
              let n = count(c.key)
              HStack(spacing: Measure.Dashboard.postCountGap) {
                Image(systemName: c.glyph).font(.system(size: Measure.Dashboard.postCountIcon))
                Text(Analytics.fmtCompact(Double(n)))
              }
              .opacity(kind != "all" && kind != c.kind ? Measure.Dashboard.postCountDim : 1)
              .accessibilityElement(children: .ignore)
              .accessibilityLabel("\(AppLocale.formatNumber(n)) \(n == 1 ? c.one : c.many)")
            }
          }
        }
      }
    }
  }
}
#endif
