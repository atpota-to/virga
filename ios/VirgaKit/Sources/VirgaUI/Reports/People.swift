// Ports src/people/people.jsx
// Ports src/reports/PostRow.jsx
//
// The people and posts a report or a card lists. A person: their picture,
// their name (a link to their profile on Bluesky), their handle where the
// name isn't it, "follows you", a fact, the number at the right, Follow
// where the archive knows who you follow, and the way to your history with
// them (the Interaction lookup). Names come from the archive's cards
// (wantActors fills them in), else the follower list. A post: its words (a
// link to it on Bluesky), when (relative within a week), whether it was a
// reply or a quote, and its counts by kind, the ones not counted dimmed.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

enum People {
  /// `cardFor(archive, did)`: the archive's card, else the follower row's.
  @MainActor
  static func card(_ archive: ArchiveModel, _ report: ReportArchive, _ did: String) -> (handle: String?, displayName: String?, avatar: String?) {
    if let card = archive.actors[did] { return (card.handle, card.displayName, card.avatar) }
    if let row = ReportModels.relationSets(report).followerCards[JSKey(did)] {
      return (row.handle.isEmpty ? nil : row.handle, row.displayName.isEmpty ? nil : row.displayName, row.avatar.isEmpty ? nil : row.avatar)
    }
    return (nil, nil, nil)
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

/// `PersonRow`.
struct PersonRow: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(\.openURL) private var openURL
  @Environment(ArchiveModel.self) private var model: ArchiveModel?
  let archive: ReportArchive
  let did: String
  var meta: String? = nil
  var value: String? = nil
  var follow = false
  var followLabel = "Follow"
  var rel = true
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    let card: (handle: String?, displayName: String?, avatar: String?) =
      model.map { People.card($0, archive, did) } ?? (nil, nil, nil)
    let name = People.displayName(card.handle, card.displayName, did)
    let handle = card.handle.flatMap { h in name.hasPrefix("@") && String(name.dropFirst()).jsEquals(h) ? nil : h }
    let sets = ReportModels.relationSets(archive)
    let followsYou = rel && sets.isFollower(did)
    HStack(spacing: theme.space3) {
      Avatar(src: card.avatar, name: card.displayName ?? card.handle ?? "?", size: .small)
      VStack(alignment: .leading, spacing: 1) {
        Button(name) { if let url = People.profileUrl(card.handle, did) { openURL(url) } }
          .buttonStyle(.plain)
          .virgaText(.textBase, weight: VirgaWeight.medium)
          .foregroundStyle(theme.ink)
          .lineLimit(1)
          .accessibilityAddTraits(.isLink)
        if handle != nil || followsYou || meta != nil {
          MetaLine([handle.map { "@\($0)" }, followsYou ? "follows you" : nil, meta].compactMap { $0 })
        }
        if let error {
          Text(error).virgaText(.textSm).foregroundStyle(theme.danger)
        }
      }
      Spacer(minLength: 0)
      if let value {
        Text(value).virgaText(.textBase, weight: VirgaWeight.semibold).foregroundStyle(theme.ink)
      }
      if follow, archive.meta.following != nil, let model {
        let on = sets.following.contains { $0.jsEquals(did) }
        Button(on ? "Following" : followLabel) {
          busy = true
          Task {
            do {
              try await model.setFollow(did, !on)
              error = nil
            } catch {
              self.error = "Couldn’t \(on ? "unfollow" : "follow"): \(error.localizedDescription)"
            }
            busy = false
          }
        }
        .buttonStyle(.virga(size: .small, isOn: on))
        .disabled(busy || model.sync?.step == "following")
        .accessibilityLabel(on ? "Unfollow \(name)" : "Follow \(name)")
      }
      if !did.jsEquals(archive.did) {
        Button {
          navigate(InteractionModel.lookupHref(did))
        } label: {
          Image(systemName: Glyph.history)
        }
        .buttonStyle(.virga(.ghost, size: .small, icon: true))
        .accessibilityLabel("See your history with \(name)")
      }
    }
    .padding(.vertical, theme.rowPad)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
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
    HStack(alignment: .top, spacing: theme.space3) {
      if let rank {
        Text("\(rank)").virgaText(.textSm).foregroundStyle(theme.muted).frame(minWidth: 18, alignment: .trailing)
      }
      VStack(alignment: .leading, spacing: 2) {
        Button(Self.text(post)) {
          if let rkey = post.rkey, let url = URL(string: "https://bsky.app/profile/\(did)/post/\(JSURI.encodeURIComponent(rkey))") {
            openURL(url)
          }
        }
        .buttonStyle(.plain)
        .virgaText(.textBase)
        .foregroundStyle(theme.ink)
        .lineLimit(2)
        .multilineTextAlignment(.leading)
        .accessibilityAddTraits(.isLink)
        HStack(spacing: theme.space2) {
          Text(Self.when(post.at))
          if post.replyTo != nil { Text("reply") }
          if post.quoteOf != nil { Text("quote") }
          if breakdown {
            ForEach(Self.counts.filter { count($0.key) > 0 }, id: \.key) { c in
              let n = count(c.key)
              HStack(spacing: 2) {
                Image(systemName: c.glyph).font(.system(size: 11))
                Text(Analytics.fmtCompact(Double(n)))
              }
              .opacity(kind != "all" && kind != c.kind ? 0.5 : 1)
              .accessibilityElement(children: .ignore)
              .accessibilityLabel("\(AppLocale.formatNumber(n)) \(n == 1 ? c.one : c.many)")
            }
          }
        }
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
      }
      Spacer(minLength: 0)
      if !breakdown {
        Text(AppLocale.formatNumber(Analytics.engagementOf(post, kind)))
          .virgaText(.textBase, weight: VirgaWeight.semibold)
          .foregroundStyle(theme.ink)
      }
    }
    .padding(.vertical, theme.rowPad)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}
#endif
