// Ports harness/views.js: its views as VirgaCore's lexicon models, for
// previews and anything else that wants a typed value rather than the JSON
// a fake network serves.
//
// Each decodes the exact JSON the view functions give (Views.swift), so a
// typed value is the web's view read the way the app reads an AppView
// answer. Where the harness's shape is looser than the lexicon (the posts
// reposted into an author feed have no indexedAt, which PostView requires),
// keep to the JSON.

import Foundation
import VirgaCore

extension DemoViews {
  /// `value` as `T`, or nil when it isn't one.
  public static func decode<T: Decodable>(_ value: JSONValue?, as type: T.Type = T.self) -> T? {
    guard let value else { return nil }
    return try? value.decode(T.self)
  }

  /// `person(actor)` as a profile.
  public func profileModel(_ actor: String) -> ProfileViewDetailed? {
    Self.decode(person(actor))
  }

  /// `postView(uri)` as a PostView.
  public func postModel(_ uri: String, now: Double) -> PostView? {
    Self.decode(try? postView(uri, now: now))
  }

  /// Every post of an account's world as PostViews, newest first.
  public func postModels(_ world: AccountWorld, now: Double) -> [PostView] {
    world.posts.compactMap { postModel("at://\(world.me.did)/app.bsky.feed.post/\($0.rkey)", now: now) }
  }

  /// `threadView(uri)` as a ThreadViewPost.
  public func threadModel(_ uri: String, now: Double) -> ThreadViewPost? {
    Self.decode(try? threadView(uri, now: now))
  }

  /// `generatorView(uri)` as a GeneratorView.
  public func generatorModel(_ uri: String) -> GeneratorView? {
    Self.decode(generatorView(uri))
  }

  /// `listView(uri)` as a ListView.
  public func listModel(_ uri: String, now: Double) -> ListView? {
    Self.decode(listView(uri, now: now))
  }
}

extension AccountWorld {
  /// The account's notifications as listNotifications' NotificationViews.
  public var notificationModels: [NotificationView] {
    notifications.compactMap { DemoViews.decode(try? JSONValue(encoding: $0)) }
  }
}
