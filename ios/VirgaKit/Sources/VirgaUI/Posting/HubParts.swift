// Ports src/posting/pages/hubParts.jsx (useLoad)
// Ports src/reports/PostRow.jsx (PostMeta and postWhen, as the posting pages draw them)
// Ports src/posting/pages/hub.css (.hub-row-text, .hub-row-why, .hub-quote, .hub-spinner)
//
// What the overview, Drafts, Posted and Timers pages share beyond
// PostingParts: a read that follows the account and the posting events
// (useLoad, as PostingLoad), a post's words as a row shows them, the line
// under a post (PostMeta), the quote a dialog shows of what it acts on, and
// the spinner a row's ⋯ turns into while it works.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaNetwork
import VirgaPosting

/// `useLoad(load, { key, did, events, enabled })`: `load` run for `key`
/// (again when the key changes), and again whenever one of the posting
/// `events` arrives for `did`. `phase` is `.loading` only until the first
/// answer, so a reload keeps what's on screen; a failed reload keeps the
/// last data and its error. With `enabled` false nothing is read (`.idle`).
@MainActor
@Observable
final class PostingLoad<Value> {
  enum Phase: Equatable {
    case idle, loading, ready, failed
  }

  private(set) var phase: Phase = .loading
  private(set) var data: Value?
  private(set) var error: (any Error)?

  @ObservationIgnored private var key: String?
  @ObservationIgnored private var enabled = true
  @ObservationIgnored private var token = 0
  @ObservationIgnored private var task: Task<Void, Never>?
  @ObservationIgnored private var stops: [PostingEventUnsubscribe] = []
  @ObservationIgnored private var loader: (@MainActor () async throws -> Value)?

  init() {}

  /// Start (or carry on) reading for `key`. Called from the view's `.task`.
  func follow(
    key: String, did: String?, events: [String] = [], enabled: Bool = true,
    _ load: @escaping @MainActor () async throws -> Value
  ) {
    loader = load
    let same = key == self.key
    self.key = key
    self.enabled = enabled
    unlisten()
    guard enabled else {
      cancel()
      phase = .idle
      data = nil
      error = nil
      return
    }
    if !same || phase == .idle {
      phase = .loading
      data = nil
      error = nil
    }
    listen(did: did, events: events)
    reload()
  }

  /// `reload()`: read again, keeping what's on screen meanwhile.
  func reload() {
    guard enabled, let loader else { return }
    token += 1
    let mine = token
    task?.cancel()
    task = Task { @MainActor [weak self] in
      do {
        let value = try await loader()
        guard let self, mine == self.token else { return }
        self.data = value
        self.error = nil
        self.phase = .ready
      } catch {
        guard let self, mine == self.token, !(error is CancellationError) else { return }
        self.error = error
        self.phase = self.data != nil ? .ready : .failed
      }
    }
  }

  /// The view went away: nothing more is read or heard.
  func stop() {
    cancel()
    unlisten()
  }

  private func cancel() {
    token += 1
    task?.cancel()
    task = nil
  }

  private func listen(did: String?, events: [String]) {
    guard let did, !did.isEmpty else { return }
    for name in events {
      let stop = try? PostingEvents.onPostingEvent(name, did: did) { [weak self] _ in
        Task { @MainActor [weak self] in self?.reload() }
      }
      if let stop { stops.append(stop) }
    }
  }

  private func unlisten() {
    for stop in stops { stop() }
    stops = []
  }
}

/// The posting pages' icons (lucide's names, as SF Symbols).
enum HubGlyph {
  static let post = "paperplane"  // Send
  static let schedule = "calendar.badge.clock"  // CalendarClock
  static let trash = "trash"  // Trash2
  static let reply = "bubble.left"  // MessageSquare
  static let quote = "quote.opening"  // Quote
  static let again = "repeat"  // Repeat
  static let gates = "arrowshape.turn.up.left"  // MessageSquareLock
  static let timer = "timer"  // Timer
  static let template = "rectangle.3.offgrid"  // LayoutTemplate
  static let external = "arrow.up.right.square"  // ExternalLink
  static let newPost = "square.and.pencil"  // SquarePen
  static let acted = "checkmark.circle"  // CheckCircle2
  static let skipped = "minus.circle"  // MinusCircle
}

/// `.hub-row-text`: a post's words, two lines at most (a draft's three),
/// or what stands in for them, muted.
struct HubRowText: View {
  @Environment(\.virgaTheme) private var theme
  let text: String
  let placeholder: String
  var lines = Measure.Hub.rowTextLines

  var body: some View {
    let words = text.jsTrimmed()
    Text(words.isEmpty ? placeholder : words)
      .virgaText(.textMd, lineHeight: Measure.Hub.rowTextLineHeight)
      .foregroundStyle(words.isEmpty ? theme.muted : theme.ink)
      .lineLimit(lines)
      .multilineTextAlignment(.leading)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// `.hub-row-why` (muted), `.hub-row-note` (in the warning's colour) and
/// `.sched-row-why` (in red): what to know about a row before acting on it.
struct HubRowWhy: View {
  enum Tone {
    case muted, warn, danger
  }

  @Environment(\.virgaTheme) private var theme
  let text: String
  var tone = Tone.muted

  var body: some View {
    Text(text)
      .virgaText(.textSm, lineHeight: Measure.Hub.whyLineHeight)
      .foregroundStyle(tone == .warn ? theme.warn : tone == .danger ? theme.danger : theme.muted)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// `.hub-quote`: the words of what a dialog acts on, under a rule.
struct HubQuote: View {
  @Environment(\.virgaTheme) private var theme
  let text: String

  var body: some View {
    Text(text)
      .virgaText(.textBase)
      .foregroundStyle(theme.ink2)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.vertical, Measure.Hub.quotePadding)
      .padding(.leading, Measure.Hub.quoteInset)
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay(alignment: .leading) {
        Rectangle().fill(theme.line2).frame(width: Measure.Hub.quoteRule)
      }
  }
}

/// `.hub-spinner`: in place of a row's dots while it works (still under
/// Reduce Motion).
struct HubSpinner: View {
  @Environment(\.virgaTheme) private var theme
  @State private var turned = false

  var body: some View {
    ZStack {
      Circle().stroke(theme.line2, lineWidth: Measure.Hub.spinnerLine)
      Circle()
        .trim(from: 0, to: 0.25)
        .stroke(theme.ink, lineWidth: Measure.Hub.spinnerLine)
        .rotationEffect(.degrees(turned ? 360 : 0))
    }
    .frame(width: Measure.Hub.spinnerSize, height: Measure.Hub.spinnerSize)
    .onAppear {
      guard !theme.reduceMotion else { return }
      withAnimation(.linear(duration: Measure.Hub.spinnerSeconds).repeatForever(autoreverses: false)) { turned = true }
    }
    .accessibilityHidden(true)
  }
}

/// `PostMeta`: when (a week old or more, its day), what kind of post it is
/// if it isn't a plain one, and its counts above zero, as a meta line.
/// `extra` ends it ("Not in the archive yet").
struct HubPostMeta: View {
  let post: PostRow
  let now: Double
  var extra: String? = nil

  enum Piece: Hashable {
    case when, reply, quote, counts, extra
  }

  static let weekMs: Double = 7 * 86_400_000
  /// `COUNTS`, in the order every list gives them.
  static let counts: [(key: String, glyph: String, one: String, many: String)] = [
    ("likes", Glyph.heart, "like", "likes"), ("reposts", Glyph.repost, "repost", "reposts"),
    ("replies", Glyph.reply, "reply", "replies"), ("quotes", Glyph.quote, "quote", "quotes"),
  ]

  static func count(_ post: PostRow, _ key: String) -> Int {
    switch key {
    case "likes": return post.likes
    case "reposts": return post.reposts
    case "replies": return post.replies
    default: return post.quotes
    }
  }

  /// `postWhen(at, now)`: "2d ago" under a week; after that its day.
  static func postWhen(_ at: String?, now: Double) -> String {
    let zone = AppLocale.activeTimeZone()
    let t = JSDate.parse(at ?? "", timeZone: zone)
    guard t.isFinite else { return "" }
    if now - t < weekMs { return Time.relativeTime(t, now: now) }
    let sameYear = JSDate.fields(t, timeZone: zone)?.year == JSDate.fields(now, timeZone: zone)?.year
    return AppLocale.toLocaleDateString(t, DateFormatOptions(year: sameYear ? nil : "numeric", month: "short", day: "numeric"))
  }

  var body: some View {
    let shown = Self.counts.filter { Self.count(post, $0.key) > 0 }
    var pieces: [Piece] = [.when]
    if post.replyTo != nil { pieces.append(.reply) }
    if post.quoteOf != nil { pieces.append(.quote) }
    if !shown.isEmpty { pieces.append(.counts) }
    if extra != nil { pieces.append(.extra) }
    return FlowLayout(spacing: 0, lineSpacing: 0, alignment: .center) {
      ForEach(Array(pieces.enumerated()), id: \.element) { index, piece in
        MetaPiece(isLast: index == pieces.count - 1) {
          content(piece, shown: shown)
        }
      }
    }
  }

  @ViewBuilder
  private func content(_ piece: Piece, shown: [(key: String, glyph: String, one: String, many: String)]) -> some View {
    switch piece {
    case .when:
      Text(Self.postWhen(post.at, now: now))
        .accessibilityHint(post.at.map { Time.formatDateShort($0) } ?? "")
    case .reply:
      Text("reply")
    case .quote:
      Text("quote")
    case .counts:
      HubPostCounts(post: post, keys: shown.map(\.key))
    case .extra:
      Text(extra ?? "")
    }
  }
}

/// A post's counts above zero, each with its glyph, read as words.
struct HubPostCounts: View {
  @Environment(\.virgaTheme) private var theme
  let post: PostRow
  let keys: [String]

  var body: some View {
    HStack(spacing: theme.space3) {
      ForEach(HubPostMeta.counts.filter { keys.contains($0.key) }, id: \.key) { c in
        let n = HubPostMeta.count(post, c.key)
        HStack(spacing: Measure.Posting.previewIconGap) {
          Image(systemName: c.glyph).font(.system(size: Measure.Posting.previewIcon))
          Text(Analytics.fmtCompact(Double(n)))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(AppLocale.formatNumber(n)) \(n == 1 ? c.one : c.many)")
      }
    }
  }
}

/// The posting pages' services that the web reaches through its window and
/// its stores: this device's id for drafts, the account's posting settings,
/// and the network the session reads through.
@MainActor
enum PostingPages {
  /// `postingDeviceId()`.
  static func deviceId(_ app: AppModel) -> String? {
    Drafts.postingDeviceId(app.stores.keyValue)
  }

  /// The account's posting settings as the web's usePostingSettings has
  /// them (read once; a page that changes them has its own model).
  static func settings(_ app: AppModel, _ did: String?) -> PostingSettings {
    PostingSettingsStore.readPostingSettings(did, store: app.stores.keyValue, language: Locale.preferredLanguages.first.map(JSONValue.string))
  }

  /// The archive's posts as rows (`archive.posts`), when it is `did`'s.
  static func archivePosts(_ archive: ArchiveModel?, _ did: String?) -> [JSONValue] {
    guard let archive, let did, archive.did.jsEquals(did) else { return [] }
    return archive.data.posts.map(\.json)
  }

  /// The author feed's latest posts and replies as archive rows
  /// (`publicXrpc('app.bsky.feed.getAuthorFeed', …)`), reposts left out.
  static func authorFeed(
    _ did: String, limit: Int, cursor: String? = nil, transport: any HTTPTransport
  ) async throws -> (rows: [JSONValue], cursor: String?) {
    var params: QueryParams = ["actor": .string(did), "limit": .number(Double(limit)), "filter": "posts_with_replies"]
    if let cursor { params = QueryParams(params.items.map { ($0.name, $0.value) } + [("cursor", .string(cursor))]) }
    let body = try await PublicAppView.publicXrpc("app.bsky.feed.getAuthorFeed", params, transport: transport)
    let rows = (body["feed"]?.arrayValue ?? [])
      .filter { !($0["reason"]?.isTruthy ?? false) }
      .compactMap { HubModel.rowFromPostView($0["post"], did) }
    let next = body["cursor"]?.stringValue
    return (rows, next.flatMap { $0.isEmpty ? nil : $0 })
  }
}
#endif
