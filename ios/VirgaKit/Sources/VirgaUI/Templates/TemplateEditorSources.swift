// Ports src/posting/library/TemplateEditor.jsx (the reads the editor makes)
// Ports src/posting/library/sources.js (fetchOwnPosts, hydrateEmbedViews, resolveRecordLink, resolveExternalLink: as the template editor calls them)
//
// What the template editor reads from the public AppView: the account's
// recent posts to quote, the view of what a template already quotes (or
// that it's gone), and a pasted link to a post, feed or list made into a
// record embed. sources.js is the library's, still to be ported whole into
// VirgaPosting; until it is, these four are written here over VirgaNetwork's
// PublicAppView (publicXrpc, getPosts, resolveHandle) and VirgaPosting's
// PostLink.parseRecordLink, and the library's port should take their place.
//
// A web page's link card is read through linkCard.js's fetchLinkCard
// (Bluesky's card service), which the publish domain hasn't ported yet:
// until it has, `resolveExternalLink` reads nothing, so a link to a web page
// says it couldn't be read.

#if canImport(UIKit)
import Foundation
import VirgaCore
import VirgaNetwork
import VirgaPosting

/// What the editor shows for an attachment: `{ by, title }`.
struct TemplateAttachSummary: Hashable {
  var by: String
  var title: String
}

/// A link read into an embed: `{ embed, title, by, view }`.
struct TemplateFoundLink {
  var embed: JSONValue
  var title: String
  var by: String
  var view: JSONValue?
}

/// What a template's quote reads as: its view, or gone.
enum TemplateEmbedView {
  case view(JSONValue)
  case missing
}

struct TemplateEditorSources {
  let transport: any HTTPTransport
  /// linkCard.js's fetchLinkCard, once it is ported: `{ title, description }`.
  var linkCard: (@Sendable (String) async -> JSONValue?)? = nil

  static let postCollection = "app.bsky.feed.post"
  static let feedCollection = "app.bsky.feed.generator"
  static let listCollection = "app.bsky.graph.list"
  static let recordEmbed = "app.bsky.embed.record"
  static let externalEmbed = "app.bsky.embed.external"
  /// `PAGE.ownPosts`, `OWN_POSTS_WANTED`, `OWN_POSTS_PAGES`.
  static let ownPostsPage = 50
  static let ownPostsWanted = 10
  static let ownPostsPages = 4

  /// `parseAtUri(uri)`: `{ did, collection, rkey }`.
  static func parseAtUri(_ uri: String?) -> (did: String, collection: String, rkey: String)? {
    guard let uri, uri.utf16.starts(with: "at://".utf16) else { return nil }
    let rest = uri.jsSlice(5)
    let parts = rest.components(separatedBy: "/")
    guard parts.count == 3, parts.allSatisfy({ !$0.isEmpty }) else { return nil }
    if parts[2].contains("?") || parts[2].contains("#") { return nil }
    return (parts[0], parts[1], parts[2])
  }

  /// `isOwnThreadPost(post)` (library/model.js): a top-level post, or a
  /// reply in a thread the author started and answered themselves.
  static func isOwnThreadPost(_ post: JSONValue) -> Bool {
    let reply = post["record"]?["reply"]
    guard let root = reply?["root"]?["uri"]?.stringValue, !root.isEmpty else { return true }
    let did = post["author"]?["did"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? parseAtUri(post["uri"]?.stringValue)?.did
    guard let did else { return false }
    let parent = reply?["parent"]?["uri"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? root
    let own = "at://\(did)/".utf16
    return root.utf16.starts(with: own) && parent.utf16.starts(with: own)
  }

  /// `isGone(error)`: a 400, a 404 or a not-found from the AppView.
  static func isGone(_ error: any Error) -> Bool {
    if let failed = error as? PublicXrpcError {
      if failed.status == 400 || failed.status == 404 { return true }
      if failed.error?.stringValue == "NotFound" { return true }
      let message = failed.message.jsLowercased()
      return message.contains("not found") || message.contains("notfound") || message.contains("could not find")
        || message.contains("could not locate")
    }
    return false
  }

  /// `fetchOwnPosts(did)`: the account's own posts and its own threads'
  /// continuations, from its public author feed, reading on until there are
  /// ten or four pages have been read.
  func fetchOwnPosts(_ did: String) async throws -> (items: [JSONValue], cursor: String?) {
    var items: [JSONValue] = []
    var next: String?
    var pages = 0
    repeat {
      var pairs: [(String, JSONValue?)] = [
        ("actor", .string(did)), ("limit", .number(Double(Self.ownPostsPage))), ("filter", .string("posts_with_replies")),
      ]
      if let next { pairs.append(("cursor", .string(next))) }
      let params = QueryParams(pairs)
      let body = try await PublicAppView.publicXrpc("app.bsky.feed.getAuthorFeed", params, transport: transport)
      for entry in body["feed"]?.arrayValue ?? [] {
        guard let post = entry["post"], let uri = post["uri"]?.stringValue, !uri.isEmpty else { continue }
        if entry["reason"].truthy != nil { continue }
        if let author = post["author"]?["did"]?.stringValue, !author.isEmpty, !author.jsEquals(did) { continue }
        if Self.isOwnThreadPost(post) { items.append(post) }
      }
      // A cursor handed back unchanged would read the same page forever.
      let cursor = body["cursor"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
      next = cursor.flatMap { Optional($0).jsEquals(next) ? nil : $0 }
      pages += 1
    } while next != nil && items.count < Self.ownPostsWanted && pages < Self.ownPostsPages
    return (items, next)
  }

  /// `hydrateEmbedViews([embed])` for one embed: the view of what it
  /// quotes, `.missing` when the AppView says it's gone, nil when it
  /// couldn't be read (which says nothing either way).
  func embedView(_ embed: JSONValue?) async -> TemplateEmbedView? {
    guard let embed, embed["$type"]?.stringValue == Self.recordEmbed, let uri = embed["record"]?["uri"]?.stringValue,
      let parsed = Self.parseAtUri(uri)
    else { return nil }
    do {
      switch parsed.collection {
      case Self.postCollection:
        let body = try await PublicAppView.publicXrpc("app.bsky.feed.getPosts", ["uris": .array([.string(uri)])], transport: transport)
        let found = (body["posts"]?.arrayValue ?? []).first { $0["uri"]?.stringValue == uri }
        return found.map { TemplateEmbedView.view($0) } ?? .missing
      case Self.feedCollection:
        let body = try await PublicAppView.publicXrpc("app.bsky.feed.getFeedGenerator", ["feed": .string(uri)], transport: transport)
        return body["view"].truthy.map { TemplateEmbedView.view($0) } ?? .missing
      case Self.listCollection:
        let body = try await PublicAppView.publicXrpc(
          "app.bsky.graph.getList", ["list": .string(uri), "limit": .number(1)], transport: transport)
        return body["list"].truthy.map { TemplateEmbedView.view($0) } ?? .missing
      default:
        return nil
      }
    } catch {
      // A post chunk that failed is unknown, not gone; a feed or a list
      // the AppView says isn't there is gone.
      if parsed.collection != Self.postCollection && Self.isGone(error) { return .missing }
      return nil
    }
  }

  /// `readRecord(kind, uri)`.
  private func readRecord(_ kind: String, _ uri: String) async throws -> JSONValue? {
    if kind == "post" {
      let read = await PublicAppView.getPosts([uri], transport: transport)
      if read.failed > 0 { throw read.error ?? TemplateReadError("Couldn’t read that post.") }
      return read.views.first
    }
    do {
      if kind == "feed" {
        return try await PublicAppView.publicXrpc("app.bsky.feed.getFeedGenerator", ["feed": .string(uri)], transport: transport)["view"].truthy
      }
      if kind == "list" {
        return try await PublicAppView.publicXrpc(
          "app.bsky.graph.getList", ["list": .string(uri), "limit": .number(1)], transport: transport)["list"].truthy
      }
    } catch {
      if Self.isGone(error) { return nil }
      throw error
    }
    return nil
  }

  /// `resolveRecordLink(url)`: a bsky.app (or aturi.to, or at://) link to a
  /// post, feed or list, as a record embed with what to call it.
  func resolveRecordLink(_ url: String) async -> TemplateFoundLink? {
    guard let link = PostLink.parseRecordLink(url.jsTrimmed()), ["post", "feed", "list"].contains(link.kind) else { return nil }
    let did: String?
    if let given = link.did, !given.isEmpty {
      did = given
    } else {
      did = await PublicAppView.resolveHandle(link.handle, transport: transport)
    }
    guard let did else { return nil }
    let uri = "at://\(did)/\(link.collection)/\(link.rkey)"
    guard let view = try? await readRecord(link.kind, uri), let viewUri = view["uri"]?.stringValue, !viewUri.isEmpty,
      let cid = view["cid"]?.stringValue, !cid.isEmpty
    else { return nil }
    let summary = Self.summary(kind: link.kind, view)
    return TemplateFoundLink(
      embed: ["$type": .string(Self.recordEmbed), "record": ["uri": .string(viewUri), "cid": .string(cid)]], title: summary.title,
      by: summary.by, view: view)
  }

  /// resolveRecordLink's words for what it found.
  static func summary(kind: String, _ view: JSONValue) -> TemplateAttachSummary {
    switch kind {
    case "post":
      return TemplateAttachSummary(
        by: view["author"]?["handle"]?.stringValue.flatMap { $0.isEmpty ? nil : "Post by @\($0)" } ?? "Post",
        title: TemplateEditorWords.firstLine(view["record"]?["text"]?.stringValue).nonEmpty ?? "Post")
    case "feed":
      return TemplateAttachSummary(
        by: view["creator"]?["handle"]?.stringValue.flatMap { $0.isEmpty ? nil : "Feed by @\($0)" } ?? "Feed",
        title: (view["displayName"]?.stringValue ?? "").nonEmpty ?? "Feed")
    default:
      return TemplateAttachSummary(
        by: view["creator"]?["handle"]?.stringValue.flatMap { $0.isEmpty ? nil : "List by @\($0)" } ?? "List",
        title: (view["name"]?.stringValue ?? "").nonEmpty ?? "List")
    }
  }

  /// `resolveExternalLink(url)`: any other web address as a link card,
  /// `by` its host. Nil until linkCard.js's fetchLinkCard is ported.
  func resolveExternalLink(_ url: String) async -> TemplateFoundLink? {
    let trimmed = url.jsTrimmed()
    guard let parsed = URL(string: trimmed), let scheme = parsed.scheme?.lowercased(), scheme == "https" || scheme == "http",
      var host = parsed.host, !host.isEmpty
    else { return nil }
    if host.utf16.starts(with: "www.".utf16) { host = host.jsSlice(4) }
    guard let linkCard, let card = await linkCard(trimmed) else { return nil }
    let title = card["title"]?.stringValue ?? ""
    return TemplateFoundLink(
      embed: [
        "$type": .string(Self.externalEmbed),
        "external": ["uri": .string(trimmed), "title": .string(title), "description": .string(card["description"]?.stringValue ?? "")],
      ], title: title.isEmpty ? trimmed : title, by: host, view: nil)
  }
}

/// An error with the web's words (`new Error(…)`).
struct TemplateReadError: LocalizedError {
  var message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

extension String {
  /// The string, or nil when it's empty (`x || fallback`).
  var nonEmpty: String? { isEmpty ? nil : self }
}
#endif
