// Ports src/people/people.jsx (cardFor, displayName, profileUrl, useWantActors, useFollow, FollowButton, PersonRow: as the tools use them)
// Ports src/reports/PostRow.jsx (postText, postUrl, postWhen, PostMeta, PostRow: as the tools use them)
// Ports src/tools/tools.css (what the tool pages share: the statement, the filter cards, the facts, the timeline, the line over a table, the inline select)
//
// What more than one tool draws. People: a person's card (the resolved
// profile, else their follower row), their name, the way to their profile,
// asking the archive for the cards a list is missing, the Follow button
// with its own busy and error state, and a person's row (face, name,
// handle, "follows you", the row's own fact, the way to your history with
// them, Follow, and one thing after it). Posts: a post's words (or what
// kind of post it is), its address, when it went out, and its row with the
// meta line of its counts. Then the tools' own bits: what a page found, in
// a sentence; figures that are also a filter; a list of facts; a timeline;
// "Show 30 more" under a list; a select with its words beside it; the
// system's exporter for a file the archive writes.
//
// The people and post rows are written for the tools here; people.jsx and
// PostRow.jsx are the reports' too, and those may want them where they are
// ported (the names here are the tools' own so the two can't collide).

#if canImport(UIKit)
import SwiftUI
import UniformTypeIdentifiers
import VirgaArchive
import VirgaCore
import VirgaInsights
import VirgaNetwork

/// The glyphs the tools draw that the shell's Glyph doesn't name, each the
/// SF Symbol for the lucide glyph the web imports.
enum ToolGlyph {
  /// Heart, Repeat2, MessageCircle, Quote, AtSign
  static let like = Icons.sfSymbol(lucide: "Heart")
  static let repost = Icons.sfSymbol(lucide: "Repeat2")
  static let reply = "bubble.left"
  static let quote = "quote.bubble"
  static let mention = "at"
  /// ArrowDownLeft (them to you), ArrowUpRight (you to them)
  static let incoming = "arrow.down.left"
  static let outgoing = "arrow.up.right"
  /// History
  static let history = Icons.sfSymbol(lucide: "RotateCcwClock")
  /// Undo2, Eye, EyeOff, Copy, X
  static let undo = "arrow.uturn.backward"
  static let show = Icons.sfSymbol(lucide: "Eye")
  static let hide = "eye.slash"
  static let copy = "doc.on.doc"
  /// ImageUp: Post this chart.
  static let picture = "photo"

  /// `KIND_ICON[kind] || Heart`.
  static func kind(_ kind: String) -> String {
    switch kind {
    case "repost": return repost
    case "reply": return reply
    case "quote": return quote
    case "mention": return mention
    default: return like
    }
  }

  /// `DIRECTION_ICON[dir]`.
  static func direction(_ dir: String) -> String { dir == "out" ? outgoing : incoming }
}

// MARK: - People

/// A person's card as people.jsx reads one: a handle, a name and a face,
/// each nil when it is missing or empty (the web's falsy).
struct ToolPersonCard: Hashable {
  var handle: String?
  var displayName: String?
  var avatar: String?

  init(handle: String?, displayName: String?, avatar: String?) {
    func some(_ s: String?) -> String? { s.flatMap { $0.isEmpty ? nil : $0 } }
    self.handle = some(handle)
    self.displayName = some(displayName)
    self.avatar = some(avatar)
  }

  init(_ card: ActorCard) {
    self.init(handle: card.handle, displayName: card.displayName, avatar: card.avatar)
  }

  init(_ row: FollowerRow) {
    self.init(handle: row.handle, displayName: row.displayName, avatar: row.avatar)
  }

  init(_ entry: FollowerLogEntry) {
    self.init(handle: entry.handle, displayName: entry.displayName, avatar: entry.avatar)
  }

  /// What a face's letter is taken from: `card?.displayName || card?.handle || '?'`.
  var avatarName: String { displayName ?? handle ?? "?" }
}

enum ToolPeople {
  /// `cardFor(archive, did)`: the resolved profile, else the follower row.
  @MainActor
  static func cardFor(_ archive: ArchiveModel, _ did: String, sets: RelationSets) -> ToolPersonCard? {
    if let card = archive.actors[did] { return ToolPersonCard(card) }
    return sets.followerCard(did).map(ToolPersonCard.init)
  }

  @MainActor
  static func cardFor(_ archive: ArchiveModel, _ did: String) -> ToolPersonCard? {
    cardFor(archive, did, sets: ReportModels.relationSets(ReportArchive(archive)))
  }

  /// `displayName(card, did)`: the name, else @handle, else the DID.
  static func displayName(_ card: ToolPersonCard?, _ did: String) -> String {
    card?.displayName ?? card?.handle.map { "@\($0)" } ?? did
  }

  /// `profileUrl(card, did)`.
  static func profileUrl(_ card: ToolPersonCard?, _ did: String) -> URL? {
    URL(string: "https://bsky.app/profile/\(JSURI.encodeURIComponent(card?.handle ?? did))")
  }
}

/// `useWantActors(archive, dids)`: asks for the cards of `dids` the archive
/// doesn't hold with a handle yet, once for each set of them.
struct WantActors: ViewModifier {
  let archive: ArchiveModel
  let dids: [String]

  func body(content: Content) -> some View {
    let wanted = dids.filter { did in (archive.actors[did]?.handle ?? "").isEmpty }
    content.task(id: wanted.joined(separator: "|")) {
      if !wanted.isEmpty { await archive.wantActors(wanted) }
    }
  }
}

extension View {
  func wantActors(_ archive: ArchiveModel, _ dids: [String]) -> some View {
    modifier(WantActors(archive: archive, dids: dids))
  }
}

/// `useFollow(archive)`: following and unfollowing, each person's button
/// with its own state (busy while the write is out, the error under the
/// row if it failed), held while a sync is re-reading the follows.
@MainActor
@Observable
final class FollowWriter {
  struct Pending: Equatable {
    var busy: Bool
    var error: String?
  }

  private(set) var pending: [JSKey: Pending] = [:]

  init() {}

  /// Whether who the account follows has been read.
  func known(_ archive: ArchiveModel) -> Bool { archive.data.meta.following != nil }

  /// While the sync re-reads the follows, which would overwrite a press made now.
  func locked(_ archive: ArchiveModel) -> Bool { archive.sync?.step == "following" }

  func isFollowing(_ archive: ArchiveModel, _ did: String, sets: RelationSets? = nil) -> Bool {
    (sets ?? ReportModels.relationSets(ReportArchive(archive))).isFollowed(did)
  }

  func busy(_ archive: ArchiveModel, _ did: String) -> Bool {
    locked(archive) || (pending[JSKey(did)]?.busy ?? false)
  }

  func error(_ did: String) -> String? { pending[JSKey(did)]?.error }

  /// Follows or unfollows `did` (the other way from now, unless `wantOn`
  /// says); true when the write landed.
  @discardableResult
  func toggle(_ archive: ArchiveModel, _ did: String, _ wantOn: Bool? = nil) async -> Bool {
    let on = wantOn ?? !isFollowing(archive, did)
    pending[JSKey(did)] = Pending(busy: true, error: nil)
    do {
      try await archive.setFollow(did, on)
      pending[JSKey(did)] = nil
      return true
    } catch {
      pending[JSKey(did)] = Pending(busy: false, error: "Couldn’t \(on ? "follow" : "unfollow"): \(jsMessage(error))")
      return false
    }
  }
}

/// `FollowButton`: Follow (or `followLabel`) as the kit's small outline;
/// once done, Following, the word alone.
struct ToolFollowButton: View {
  @Environment(\.virgaTheme) private var theme
  let follow: FollowWriter
  let archive: ArchiveModel
  let did: String
  let name: String
  var followLabel = "Follow"
  /// After a press, whether it landed (the follow-back queue keeps the row).
  var onDone: ((Bool) -> Void)? = nil

  var body: some View {
    if follow.known(archive) {
      let on = follow.isFollowing(archive, did)
      let busy = follow.busy(archive, did)
      let word = on ? "Following" : followLabel
      Button {
        Task {
          let ok = await follow.toggle(archive, did)
          onDone?(ok)
        }
      } label: {
        Text(word)
          .frame(minWidth: theme.isPhone ? nil : Measure.Tools.followMinWidth - 2 * theme.points(ThemeKit.smallButtonPadding.left))
      }
      .buttonStyle(.virga(size: .small, isOn: on))
      .disabled(busy)
      .accessibilityLabel("\(word) \(name)")
      .accessibilityHint(on ? "Unfollow \(name)" : "Follow \(name)")
      .accessibilityAddTraits(on ? .isSelected : [])
    }
  }
}

/// `PersonRow`: one person in a list. `meta` is the row's own fact, the
/// reason it is in the list, last on the line under the name after the
/// handle and "follows you" (left out when `rel` is false). `value` sits at
/// the right before the button. The way to your history with them follows,
/// unless `history` is false (a phone leaves it out); `extra` comes last.
struct ToolPersonRow: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(\.openURL) private var openURL
  let archive: ArchiveModel
  let sets: RelationSets
  let did: String
  var card: ToolPersonCard? = nil
  var meta: [String] = []
  var value: String? = nil
  var follow: FollowWriter? = nil
  var followLabel = "Follow"
  var onFollowDone: ((Bool) -> Void)? = nil
  var history = true
  var rel = true
  var extra: AnyView? = nil
  /// `lead`: what comes first, before the face (a scan's band mark).
  var lead: AnyView? = nil
  /// The row picked out (a scan's account found from the radar).
  var picked = false

  var body: some View {
    // A card passed in (someone who has since left the follower list, as
    // the log remembers them) stands in until a fresher one is resolved.
    let resolved = ToolPeople.cardFor(archive, did, sets: sets)
    let card: ToolPersonCard? = resolved?.handle != nil ? resolved : (self.card?.handle != nil ? self.card : (resolved ?? self.card))
    let name = ToolPeople.displayName(card, did)
    let shownName = name.utf16.first == 0x40 ? name.jsSlice(1) : name
    let handle = card?.handle.flatMap { shownName.jsEquals($0) ? nil : $0 }
    let followsYou = rel && sets.isFollower(did)
    var items: [MetaItem] = []
    if let handle { items.append(MetaItem("@\(handle)", id: "handle")) }
    if followsYou { items.append(MetaItem("follows you", id: "rel")) }
    for (i, fact) in meta.enumerated() { items.append(MetaItem(fact, id: "fact-\(i)")) }
    return HStack(alignment: .center, spacing: theme.isPhone ? Measure.Tools.phonePersonRowGap : Measure.Tools.personRowGap) {
      if let lead { lead }
      Avatar(src: card?.avatar, name: card?.avatarName ?? "?")
      VStack(alignment: .leading, spacing: 0) {
        Button {
          if let url = ToolPeople.profileUrl(card, did) { openURL(url) }
        } label: {
          Text(name)
            .virgaText(.textMd, weight: VirgaWeight.medium, lineHeight: Measure.Tools.personLineHeight)
            .foregroundStyle(theme.ink)
            .lineLimit(1)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
        if !items.isEmpty { MetaLine(items) }
        if let error = follow?.error(did) {
          Text(error)
            .virgaText(.textSm)
            .foregroundStyle(theme.danger)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if let value {
        Text(value).virgaText(.textBase, weight: VirgaWeight.semibold).foregroundStyle(theme.ink)
      }
      if history && !did.jsEquals(archive.did) && !theme.isPhone {
        Button {
          navigate(InteractionModel.lookupHref(did))
        } label: {
          Image(systemName: ToolGlyph.history).font(.system(size: Measure.Tools.historyGlyph))
        }
        .buttonStyle(.virga(.ghost, size: .small, icon: true))
        .accessibilityLabel("See your history with \(name)")
      }
      if let follow {
        ToolFollowButton(follow: follow, archive: archive, did: did, name: name, followLabel: followLabel, onDone: onFollowDone)
      }
      if let extra { extra }
    }
    .padding(.vertical, theme.rowPad)
    .background {
      if picked {
        LinearGradient(stops: [.init(color: theme.accentTint, location: 0), .init(color: .clear, location: 0.7)], startPoint: .leading, endPoint: .trailing)
      }
    }
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}

// MARK: - Posts

enum ToolPosts {
  static let weekMs: Double = 7 * 86_400_000

  /// `postText(post)`: its words, or what kind of post it is.
  static func postText(_ post: PostRow) -> String {
    let text = (post.text ?? "").jsTrimmed()
    if !text.isEmpty { return text }
    if post.hasMedia == true { return "(media post)" }
    if !(post.quoteOf ?? "").isEmpty { return "(quote post)" }
    return "(no text)"
  }

  /// `postUrl(did, post)`: by DID, not handle, which can change.
  static func postUrl(_ did: String, _ post: PostRow) -> URL? {
    URL(string: "https://bsky.app/profile/\(did)/post/\(JSURI.encodeURIComponent(post.rkey ?? "undefined"))")
  }

  /// `postWhen(at, now)`: "2d ago" under a week; after that its day ("Oct
  /// 23"), with the year only when it isn't this one.
  static func postWhen(_ at: String?, now: Double) -> String {
    let zone = AppLocale.activeTimeZone()
    let t = JSDate.parse(at ?? "", timeZone: zone)
    guard t.isFinite else { return "" }
    if now - t < weekMs { return Time.relativeTime(t, now: now) }
    let sameYear = JSDate.fields(t, timeZone: zone)?.year == JSDate.fields(now, timeZone: zone)?.year
    return AppLocale.toLocaleDateString(t, DateFormatOptions(year: sameYear ? nil : "numeric", month: "short", day: "numeric"))
  }

  /// `COUNTS`: a post's counts, in the order every list gives them.
  static let counts: [(key: String, kind: String, glyph: String, one: String, many: String)] = [
    ("likes", "like", ToolGlyph.like, "like", "likes"),
    ("reposts", "repost", ToolGlyph.repost, "repost", "reposts"),
    ("replies", "reply", ToolGlyph.reply, "reply", "replies"),
    ("quotes", "quote", ToolGlyph.quote, "quote", "quotes"),
  ]

  static func count(_ post: PostRow, _ key: String) -> Int {
    switch key {
    case "likes": return post.likes
    case "reposts": return post.reposts
    case "replies": return post.replies
    default: return post.quotes
    }
  }
}

/// `PostMeta`: when, what kind of post it is if it isn't a plain one, and
/// its counts above zero with their glyphs.
struct ToolPostMeta: View {
  @Environment(\.virgaTheme) private var theme
  let post: PostRow
  let now: Double

  enum Piece: Hashable {
    case when, reply, quote, counts
  }

  var body: some View {
    let counts = ToolPosts.counts.filter { ToolPosts.count(post, $0.key) > 0 }
    var pieces: [Piece] = [.when]
    if post.replyTo != nil { pieces.append(.reply) }
    if post.quoteOf != nil { pieces.append(.quote) }
    if !counts.isEmpty { pieces.append(.counts) }
    return FlowLayout(spacing: 0, lineSpacing: 0, alignment: .center) {
      ForEach(Array(pieces.enumerated()), id: \.element) { index, piece in
        MetaPiece(isLast: index == pieces.count - 1) {
          switch piece {
          case .when:
            Text(ToolPosts.postWhen(post.at, now: now))
              .accessibilityHint(post.at.map { Time.formatDateShort($0) } ?? "")
          case .reply:
            Text("reply")
          case .quote:
            Text("quote")
          case .counts:
            ToolPostCounts(post: post, counts: counts.map(\.key))
          }
        }
      }
    }
  }
}

/// A post's counts above zero, each with its glyph, read as words.
struct ToolPostCounts: View {
  let post: PostRow
  let counts: [String]

  var body: some View {
    HStack(spacing: Measure.Tools.countsGap) {
      ForEach(ToolPosts.counts.filter { counts.contains($0.key) }, id: \.key) { c in
        let n = ToolPosts.count(post, c.key)
        HStack(spacing: Measure.Tools.countInnerGap) {
          Image(systemName: c.glyph).font(.system(size: Measure.Tools.countGlyph))
          Text(Analytics.fmtCompact(Double(n)))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(AppLocale.formatNumber(n)) \(n == 1 ? c.one : c.many)")
      }
    }
  }
}

/// `PostRow`: a post's words (two lines at most), its meta line under them,
/// a rank before it when the list numbers its rows.
struct ToolPostRow: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  let post: PostRow
  let did: String
  let now: Double
  var rank: Int? = nil

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: Measure.Tools.postRowGap) {
      if let rank {
        Text(AppLocale.formatNumber(rank))
          .virgaText(.textBase)
          .foregroundStyle(theme.muted)
          .frame(width: Measure.Tools.postRank, alignment: .leading)
      }
      VStack(alignment: .leading, spacing: Measure.Tools.postMainGap) {
        Button {
          if let url = ToolPosts.postUrl(did, post) { openURL(url) }
        } label: {
          Text(ToolPosts.postText(post))
            .virgaText(.textMd, lineHeight: Measure.Tools.postTextLineHeight)
            .foregroundStyle(theme.ink)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
        .accessibilityHint("Open on Bluesky")
        ToolPostMeta(post: post, now: now)
      }
    }
    .padding(.vertical, theme.rowPad)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}

// MARK: - The tools' own bits

/// `.tool-statement`: what a page found, in a sentence, before the charts
/// it was found in, at the lead step.
struct ToolStatement: View {
  @Environment(\.virgaTheme) private var theme
  let text: String

  var body: some View {
    Text(text)
      .virgaText(
        .textLead, weight: VirgaWeight.medium, lineHeight: Measure.Tools.statementLineHeight, tracking: Measure.Tools.statementTracking)
      .foregroundStyle(theme.ink)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: Measure.Tools.statementMax, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// One of the figures that filter: `{ key, label, count, hint }`.
struct FilterChoice: Identifiable {
  var key: String
  var label: String
  var count: Int
  var hint: String?
  var id: String { key }
}

/// `.filter-cards`: counts that are also the filter; the pressed one has
/// its rule in the accent and its label in ink.
struct FilterCards: View {
  @Environment(\.virgaTheme) private var theme
  let label: String
  let choices: [FilterChoice]
  let selection: String
  let onSelect: (String) -> Void
  /// The row's width, which the counts are sized from.
  @State private var width: CGFloat = 0

  var body: some View {
    let phone = theme.isPhone
    let layout = FiguresLayout(
      columnGap: phone ? Measure.Tools.phoneFilterColumnGap : theme.space6, rowGap: Measure.Tools.filterRowGap,
      minWidth: Measure.Tools.filterMin, phone: phone
    )
    let count = countSize(layout, phone: phone)
    layout {
      ForEach(choices) { choice in
        FilterCardButton(choice: choice, isOn: choice.key == selection, phone: phone, countSize: count) { onSelect(choice.key) }
      }
    }
    .background {
      GeometryReader { geometry in
        Color.clear
          .onAppear { width = geometry.size.width }
          .onChange(of: geometry.size.width) { _, next in width = next }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(label)
  }

  /// `.filter-card-count`'s size: `clamp(1.75rem, 20cqi, 2.75rem)` of each
  /// card; on a phone `clamp(1.75rem, (100cqi - 20px) / 10, 2.75rem)` of the
  /// row, so every card's is the same.
  private func countSize(_ layout: FiguresLayout, phone: Bool) -> CGFloat {
    guard width > 0, !choices.isEmpty else { return Measure.Tools.filterCountMax }
    let share: CGFloat
    if phone {
      share = (width - Measure.Tools.phoneFilterColumnGap) * Measure.Tools.phoneFilterCountShare
    } else {
      let columns = layout.columns(width, count: choices.count)
      let card = (width - layout.columnGap * CGFloat(columns - 1)) / CGFloat(columns)
      share = card * Measure.Tools.filterCountShare
    }
    return Swift.min(Swift.max(share, Measure.Tools.filterCountMin), Measure.Tools.filterCountMax)
  }
}

struct FilterCardButton: View {
  @Environment(\.virgaTheme) private var theme
  let choice: FilterChoice
  let isOn: Bool
  let phone: Bool
  var countSize: CGFloat = Measure.Tools.filterCountMax
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      VStack(alignment: .leading, spacing: Measure.Tools.filterGap) {
        Text(choice.label)
          .virgaText(.textSm, weight: isOn ? VirgaWeight.semibold : VirgaWeight.medium)
          .foregroundStyle(isOn ? theme.ink : theme.ink2)
          .fixedSize(horizontal: false, vertical: true)
        Text(AppLocale.formatNumber(choice.count))
          .virgaText(size: countSize, weight: VirgaWeight.medium, lineHeight: 1, tracking: Measure.Tools.filterCountTracking)
          .foregroundStyle(theme.ink)
          .lineLimit(1)
          // Only a guard: a count too long for its card shrinks rather than cuts.
          .minimumScaleFactor(Measure.Tools.filterCountMin / Measure.Tools.filterCountMax)
        if let hint = choice.hint {
          Text(hint)
            .virgaText(.textSm, lineHeight: Measure.Tools.filterHintLineHeight)
            .foregroundStyle(theme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .padding(.top, phone ? Measure.Tools.phoneFilterPaddingTop : Measure.Tools.filterPaddingTop)
      .overlay(alignment: .top) {
        Rectangle().fill(isOn ? theme.accent : theme.line).frame(height: Measure.Tools.filterRule)
      }
      .contentShape(Rectangle())
      .animation(theme.motion.control, value: isOn)
    }
    .buttonStyle(.plain)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(isOn ? [.isSelected, .isButton] : [.isButton])
  }
}

/// `.kv`: facts, what each is at the left and its value at the right, a
/// hairline under each.
struct KVList<Content: View>: View {
  let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) { content }
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// `.kv-row`: a fact's label and its value (a row of its own words and
/// controls). `inline` keeps a short value on its label's line, at the
/// line's far end, while the list is narrow.
struct KVRow<Value: View>: View {
  @Environment(\.virgaTheme) private var theme
  let label: String
  var inline = false
  let value: Value

  init(_ label: String, inline: Bool = false, @ViewBuilder value: () -> Value) {
    self.label = label
    self.inline = inline
    self.value = value()
  }

  var body: some View {
    let phone = theme.isPhone
    Group {
      if phone && !inline {
        VStack(alignment: .leading, spacing: 0) {
          Text(label).virgaText(.textSm).foregroundStyle(theme.muted)
          HStack(spacing: Measure.Tools.kvValueGap) { value }
        }
        .padding(.vertical, Measure.Tools.phoneKvPadding)
      } else if inline && theme.isTablet {
        HStack(alignment: .center, spacing: Measure.Tools.kvInlineGap) {
          Text(label).foregroundStyle(theme.muted)
          Spacer(minLength: 0)
          HStack(spacing: Measure.Tools.kvValueGap) { value }
            .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, Measure.Tools.kvPadding)
      } else {
        HStack(alignment: .center, spacing: Measure.Tools.kvGap) {
          Text(label).foregroundStyle(theme.muted)
            .frame(width: Measure.Tools.kvLabel, alignment: .leading)
          HStack(spacing: Measure.Tools.kvValueGap) { value }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, Measure.Tools.kvPadding)
      }
    }
    .virgaText(.textBase)
    .foregroundStyle(theme.ink)
    .frame(maxWidth: .infinity, minHeight: Measure.Tools.kvMinHeight, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .combine)
  }
}

/// One step of `.timeline`: its date, and what happened.
struct TimelineStep: Identifiable {
  var id: Int
  var date: String
  var text: String
  var first: Bool
}

/// `.timeline`: what happened, newest first, down a hairline rail with a
/// dot in ink at each step; the very first is fainter.
struct TimelineList: View {
  @Environment(\.virgaTheme) private var theme
  let steps: [TimelineStep]

  var body: some View {
    let phone = theme.isPhone
    VStack(alignment: .leading, spacing: 0) {
      ForEach(steps) { step in
        Group {
          if phone {
            VStack(alignment: .leading, spacing: 0) {
              Text(step.date).virgaText(.textSm).foregroundStyle(theme.muted)
              Text(step.text).foregroundStyle(theme.ink)
            }
          } else {
            HStack(alignment: .firstTextBaseline, spacing: Measure.Tools.timelineGap) {
              Text(step.date).foregroundStyle(theme.muted).frame(width: Measure.Tools.timelineDate, alignment: .leading)
              Text(step.text).foregroundStyle(theme.ink).fixedSize(horizontal: false, vertical: true)
            }
          }
        }
        .virgaText(.textBase)
        .padding(.vertical, Measure.Tools.timelinePadding)
        .padding(.leading, Measure.Tools.timelineLeading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .topLeading) {
          Circle()
            .fill(step.first ? theme.faint : theme.ink2)
            .frame(width: Measure.Tools.timelineDot, height: Measure.Tools.timelineDot)
            .offset(x: -(Measure.Tools.timelineDot / 2), y: Measure.Tools.timelineDotTop)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
      }
    }
    .overlay(alignment: .leading) { Rectangle().fill(theme.line).frame(width: 1) }
    .padding(.top, Measure.Tools.timelineSpaceAbove)
    .padding(.leading, Measure.Tools.timelineInset)
  }
}

/// `.card-foot` under a list: "Show 30 more", and how many of how many.
struct ToolMoreFoot: View {
  let shown: Int
  let total: Int
  let page: Int
  let onMore: () -> Void

  var body: some View {
    if total > shown {
      SectionFoot(count: "\(AppLocale.formatNumber(shown)) of \(AppLocale.formatNumber(total))") {
        Button("Show \(AppLocale.formatNumber(min(page, total - shown))) more", action: onMore)
          .buttonStyle(.virga(.ghost, size: .small))
      }
    }
  }
}

/// `.field-inline`: a select with its words beside it ("Sort  Newest first").
/// A finger's field is 40 tall with its value at 16 (`@media (pointer:
/// coarse)`), and as wide as the value it shows.
struct ToolSelect<Value: Hashable>: View {
  @Environment(\.virgaTheme) private var theme
  let label: String
  let options: [(value: Value, label: String)]
  @Binding var selection: Value
  /// Over a list on a phone the value says what it sorts by, so the word
  /// before it is left to VoiceOver (`.table-bar/.list-toolbar .field-inline
  /// > span:first-child` at 560 and under).
  var hidesLabel = false

  var body: some View {
    let current = options.first { $0.value == selection }?.label ?? ""
    HStack(spacing: Measure.Tools.inlineFieldGap) {
      if !hidesLabel {
        Text(label)
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .fixedSize()
      }
      Menu {
        Picker(label, selection: $selection) {
          ForEach(Array(options.enumerated()), id: \.offset) { _, option in
            Text(option.label).tag(option.value)
          }
        }
      } label: {
        HStack(spacing: theme.space2) {
          Text(current)
            .virgaText(size: theme.points(ThemeKit.touchInputFontSize))
            .foregroundStyle(theme.ink)
            .lineLimit(1)
            .fixedSize()
          Image(systemName: "chevron.up.chevron.down")
            .font(.system(size: Measure.Tools.linkGlyph, weight: .medium))
            .foregroundStyle(theme.muted)
        }
        .padding(.horizontal, Measure.Tools.inlineFieldPadding)
        .frame(minHeight: theme.points(ThemeKit.touchInputHeight))
        .background(RoundedRectangle(cornerRadius: theme.points(ThemeKit.inputRadius)).fill(theme.color(ThemeKit.inputFill)))
        .overlay(
          RoundedRectangle(cornerRadius: theme.points(ThemeKit.inputRadius))
            .strokeBorder(theme.color(ThemeKit.inputBorder), lineWidth: theme.points(ThemeKit.inputBorder)))
        .contentShape(Rectangle())
      }
      .accessibilityLabel(label)
      .accessibilityValue(current)
    }
  }
}

/// The system's exporter for a file the archive writes (exportRows,
/// exportPosts, exportArchive): the web's download.
struct ToolExportSheet: ViewModifier {
  @Binding var file: ExportFile?

  func body(content: Content) -> some View {
    content.fileExporter(
      isPresented: Binding(get: { file != nil }, set: { if !$0 { file = nil } }),
      document: file.map(ExportDocument.init), contentType: file.map(ExportDocument.contentType) ?? .plainText,
      defaultFilename: file?.filename
    ) { _ in
      file = nil
    }
  }
}

extension View {
  func toolExporter(_ file: Binding<ExportFile?>) -> some View {
    modifier(ToolExportSheet(file: file))
  }
}

/// `.card-caption`: what a section needs said about it, under what it says.
struct ToolCaption: View {
  @Environment(\.virgaTheme) private var theme
  let text: String

  init(_ text: String) {
    self.text = text
  }

  var body: some View {
    Text(text)
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: theme.measure, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.top, theme.points(ThemeKit.cardCaptionSpaceAbove))
  }
}

/// `.report-split`: two sections side by side where each has its room
/// (`minColumn`), one under the other where they don't; `shares` sets the
/// columns' proportions (equal by default), `mins` each column's least
/// width (`minmax(300px, 1fr)`: the columns side by side whenever those
/// fit), `stacked` keeps them one under the other whatever the width (a
/// media query's narrowing).
struct ToolSplit: Layout {
  var minColumn: CGFloat = Measure.Tools.splitMin
  var columnGap: CGFloat
  var rowGap: CGFloat
  var shares: [CGFloat]? = nil
  var mins: [CGFloat]? = nil
  var stacked = false

  func floors(_ count: Int) -> [CGFloat] {
    (0..<count).map { index in
      guard let mins, index < mins.count else { return 0 }
      return mins[index]
    }
  }

  func sideBySide(_ width: CGFloat, _ count: Int) -> Bool {
    if stacked || count < 2 { return false }
    let gaps = CGFloat(count - 1) * columnGap
    if mins != nil { return width >= floors(count).reduce(0, +) + gaps }
    return width >= CGFloat(count) * minColumn + gaps
  }

  /// The columns' widths as CSS grid shares `fr` among `minmax(min, Nfr)`
  /// columns: a column whose share would be under its least width is held
  /// at it, and the others share what is left.
  func widths(_ width: CGFloat, _ count: Int) -> [CGFloat] {
    let room = Swift.max(0, width - CGFloat(count - 1) * columnGap)
    let given = shares.map { Array($0.prefix(count)) } ?? []
    let parts = given.count == count ? given : Array(repeating: 1, count: count)
    let least = floors(count)
    var held = Array(repeating: false, count: count)
    var out = Array(repeating: CGFloat(0), count: count)
    for _ in 0..<count {
      let free = room - out.indices.filter { held[$0] }.map { out[$0] }.reduce(0, +)
      let flex = parts.indices.filter { !held[$0] }.map { parts[$0] }.reduce(0, +)
      if flex <= 0 { break }
      var changed = false
      for index in parts.indices where !held[index] {
        let share = free * parts[index] / flex
        if share < least[index] {
          out[index] = least[index]
          held[index] = true
          changed = true
        } else {
          out[index] = share
        }
      }
      if !changed { break }
    }
    return out
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? 800
    if sideBySide(width, subviews.count) {
      let w = widths(width, subviews.count)
      let height = subviews.indices.map { subviews[$0].sizeThatFits(ProposedViewSize(width: w[$0], height: nil)).height }.max() ?? 0
      return CGSize(width: width, height: height)
    }
    let heights = subviews.map { $0.sizeThatFits(ProposedViewSize(width: width, height: nil)).height }
    return CGSize(width: width, height: heights.reduce(0, +) + rowGap * CGFloat(max(0, subviews.count - 1)))
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    if sideBySide(bounds.width, subviews.count) {
      let w = widths(bounds.width, subviews.count)
      var x = bounds.minX
      for index in subviews.indices {
        subviews[index].place(at: CGPoint(x: x, y: bounds.minY), proposal: ProposedViewSize(width: w[index], height: nil))
        x += w[index] + columnGap
      }
      return
    }
    var y = bounds.minY
    for subview in subviews {
      let height = subview.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil)).height
      subview.place(at: CGPoint(x: bounds.minX, y: y), proposal: ProposedViewSize(width: bounds.width, height: nil))
      y += height + rowGap
    }
  }
}

/// `display: flex; flex-wrap: wrap; justify-content: space-between`: two
/// things on one line, the first at its start and the second at its far
/// end, or the second under the first when they don't both fit (the line
/// over a table, the activity check). `basis` is the first's least width
/// on a shared line, which it grows from (`flex: 1 1 360px`), `firstMax`
/// its widest (`max-width: 68ch`); without a basis it keeps its own width.
/// On a shared line `centred` centres the two on each other, and `lift`
/// moves the second up from the line's top (`--check-lift`).
struct ToolSpreadRow: Layout {
  var columnGap: CGFloat
  var rowGap: CGFloat
  var basis: CGFloat? = nil
  var firstMax: CGFloat? = nil
  var centred = false
  var lift: CGFloat = 0

  struct Plan {
    var oneLine: Bool
    var first: CGFloat
    var second: CGSize
  }

  func plan(_ width: CGFloat, _ subviews: Subviews) -> Plan {
    let cap = firstMax ?? .infinity
    let ideal = subviews[0].sizeThatFits(.unspecified).width
    let second = subviews[1].sizeThatFits(.unspecified)
    let least = Swift.min(basis ?? ideal, cap)
    if !width.isFinite { return Plan(oneLine: true, first: Swift.min(ideal, cap), second: second) }
    if least + columnGap + second.width <= width {
      let room = width - columnGap - second.width
      return Plan(oneLine: true, first: basis == nil ? Swift.min(ideal, cap, room) : Swift.min(cap, room), second: second)
    }
    return Plan(oneLine: false, first: Swift.min(cap, width), second: second)
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    if subviews.isEmpty { return .zero }
    let width = proposal.width ?? .infinity
    if subviews.count == 1 {
      return subviews[0].sizeThatFits(ProposedViewSize(width: proposal.width, height: nil))
    }
    let p = plan(width, subviews)
    let firstHeight = subviews[0].sizeThatFits(ProposedViewSize(width: p.first, height: nil)).height
    if p.oneLine {
      let height = centred ? Swift.max(firstHeight, p.second.height) : Swift.max(firstHeight, p.second.height + lift)
      return CGSize(width: width.isFinite ? width : p.first + columnGap + p.second.width, height: height)
    }
    let secondHeight = subviews[1].sizeThatFits(ProposedViewSize(width: width, height: nil)).height
    return CGSize(width: width, height: firstHeight + rowGap + secondHeight)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    if subviews.isEmpty { return }
    if subviews.count == 1 {
      subviews[0].place(at: CGPoint(x: bounds.minX, y: bounds.minY), proposal: ProposedViewSize(width: bounds.width, height: nil))
      return
    }
    let p = plan(bounds.width, subviews)
    let firstHeight = subviews[0].sizeThatFits(ProposedViewSize(width: p.first, height: nil)).height
    if p.oneLine {
      let line = Swift.max(firstHeight, p.second.height)
      let firstY = centred ? (line - firstHeight) / 2 : 0
      let secondY = centred ? (line - p.second.height) / 2 : lift
      subviews[0].place(at: CGPoint(x: bounds.minX, y: bounds.minY + firstY), proposal: ProposedViewSize(width: p.first, height: nil))
      subviews[1].place(
        at: CGPoint(x: bounds.maxX - p.second.width, y: bounds.minY + secondY),
        proposal: ProposedViewSize(width: p.second.width, height: p.second.height))
      return
    }
    subviews[0].place(at: CGPoint(x: bounds.minX, y: bounds.minY), proposal: ProposedViewSize(width: p.first, height: nil))
    subviews[1].place(
      at: CGPoint(x: bounds.minX, y: bounds.minY + firstHeight + rowGap), proposal: ProposedViewSize(width: bounds.width, height: nil))
  }
}

/// `<Menu variant="link" label="Export" icon={Download}>`: a link action
/// that opens a short list of what to export.
struct ToolExportMenu: View {
  @Environment(\.virgaTheme) private var theme
  let entries: [MenuEntry]

  var body: some View {
    VirgaMenu(accessibilityLabel: "Export", entries: entries) {
      HStack(spacing: theme.points(ThemeKit.linkActionGap)) {
        Image(systemName: Glyph.download)
          .font(.system(size: theme.points(ThemeKit.linkActionIconSize)))
        Text("Export")
          .underline(true)
      }
      .virgaText(size: theme.points(ThemeKit.linkActionFontSize), weight: ThemeKit.linkActionWeight)
      .foregroundStyle(theme.ink)
      .lineLimit(1)
      .touchReach(horizontal: Measure.LinkAction.reachSides, vertical: Measure.LinkAction.reachAbove)
    }
  }
}

/// The words of a text split as `text.split(/\s+/)` splits them (JavaScript's
/// whitespace), the empty word a leading space makes kept.
enum ToolText {
  static func words(_ text: String) -> [String] {
    var out: [String] = []
    var current = String.UnicodeScalarView()
    var inSpace = false
    for scalar in text.unicodeScalars {
      if JSWhitespace.contains(scalar) {
        if !inSpace {
          out.append(String(current))
          current = String.UnicodeScalarView()
        }
        inSpace = true
      } else {
        current.append(scalar)
        inSpace = false
      }
    }
    out.append(String(current))
    return out
  }

  /// `haystack.includes(needle)`, by code units.
  static func includes(_ haystack: String, _ needle: String) -> Bool {
    haystack.jsIndexOf(needle) != -1
  }
}

/// A row of a table's cells as `exportRows` takes them.
enum ToolExport {
  static func row(_ cells: [String]) -> [JSONValue?] { cells.map { .string($0) } }
  static func rows(_ rows: [[String]]) -> [[JSONValue?]] { rows.map(row) }
}
#endif
