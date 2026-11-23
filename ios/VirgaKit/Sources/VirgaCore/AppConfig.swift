// Ports src/config.js
//
// App-wide constants. Nothing here is a secret. The web app's build flags
// (VITE_AUTH_MODE, VITE_BACKEND_URL, VITE_DEFENSE, VITE_DEFENSE_MODERATOR)
// are the app's Info.plist keys on iOS (`AppConfig.Flags`), set from
// ios/Config/*.xcconfig.
//
// The permission groups and scopes are what Settings › Permissions shows and
// what a sign-in asks for; ios/parity/cases/core.config.js holds them to the
// web app's, word for word.

import Foundation

public enum AppConfig {
  public static let appName = "Virga"

  /// Public reads go to the public AppView; identity comes from the PLC
  /// directory (or the host itself, for a did:web).
  public static let appview = "https://public.api.bsky.app"
  public static let plcDirectory = "https://plc.directory"

  /// Where the browser's own OAuth flow lands. Not used on iOS, which signs
  /// in through Virga's server; kept for the server's and the web's sake.
  public static let oauthCallbackPath = "/oauth/callback"

  /// Where a sign-in through Virga's server lands. On iOS this is the
  /// https callback ASWebAuthenticationSession waits for.
  public static let oauthReturnPath = "/oauth/return"

  // MARK: Build flags

  /// The web app's build flags, read from the app's Info.plist on iOS.
  public struct Flags: Sendable, Equatable {
    /// The web app's VITE_AUTH_MODE. The iOS app always signs in through
    /// Virga's server ('backend'), because a native app has no browser
    /// origin to hold a browser session for.
    public var authMode: String
    /// Virga's server, without a trailing slash: VITE_BACKEND_URL.
    public var backendURL: String
    /// VITE_DEFENSE == 'on'.
    public var defenseEnabled: Bool
    /// VITE_DEFENSE_MODERATOR == 'on', and only with Defense on.
    public var defenseModeratorEnabled: Bool
    /// iOS only, with no web flag: the app's App Store page, empty when
    /// there isn't one yet. A build made before the Terms of Service or the
    /// Privacy Policy moved on can't record an agreement to the new ones,
    /// so the agreement screen sends the reader here to update.
    public var appStoreURL: String

    public init(
      authMode: String = "backend",
      backendURL: String = "",
      defenseEnabled: Bool = false,
      defenseModeratorEnabled: Bool = false,
      appStoreURL: String = ""
    ) {
      self.authMode = authMode == "browser" ? "browser" : "backend"
      self.backendURL = backendURL.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
      self.defenseEnabled = defenseEnabled
      self.defenseModeratorEnabled = defenseEnabled && defenseModeratorEnabled
      self.appStoreURL = appStoreURL.trimmingCharacters(in: .whitespaces)
    }

    /// From an Info.plist: VirgaBackendURL, VirgaDefense ("on"),
    /// VirgaDefenseModerator ("on"), VirgaAppStoreURL.
    public init(infoDictionary: [String: Any]) {
      func string(_ key: String) -> String { (infoDictionary[key] as? String) ?? "" }
      self.init(
        authMode: "backend",
        backendURL: string("VirgaBackendURL"),
        defenseEnabled: string("VirgaDefense") == "on",
        defenseModeratorEnabled: string("VirgaDefenseModerator") == "on",
        appStoreURL: string("VirgaAppStoreURL")
      )
    }

    /// `appStoreURL` as a link to open: an https or itms-apps address with a
    /// host, or nil (none set, or not one the App Store opens).
    public var appStoreLink: URL? {
      guard let url = URL(string: appStoreURL), let scheme = url.scheme?.lowercased(),
        scheme == "https" || scheme == "itms-apps", url.host?.isEmpty == false
      else { return nil }
      return url
    }
  }

  /// The server's host, for the sentences that name it.
  public static func backendHost(_ base: String) -> String {
    guard !base.isEmpty else { return "" }
    return URL(string: base)?.host ?? base
  }

  // MARK: Permissions

  /// The Bluesky AppView, as the service the signed-in reads are sent to.
  /// `%23` is `#`, encoded as the permission spec writes it in a scope.
  static let bskyAppviewAud = "did:web:api.bsky.app%23bsky_appview"

  static func appviewToken(_ nsid: String) -> String {
    "rpc:\(nsid)?aud=\(bskyAppviewAud)"
  }

  public struct PermissionGroup: Codable, Hashable, Sendable {
    public var key: String
    /// The feature that has to be on for the group to be asked for
    /// ('defense' or 'lists'), or nil for every sign-in.
    public var onlyWith: String?
    public var title: String
    public var text: String
    public var tokens: [String]
  }

  /// What a sign-in asks for, grouped by what it's for. Settings ›
  /// Permissions is written from this list.
  public static let permissionGroups: [PermissionGroup] = [
    PermissionGroup(
      key: "identity",
      title: "Know who you are.",
      text: "Your DID and handle, so Virga knows whose archive to open.",
      tokens: ["atproto"]
    ),
    PermissionGroup(
      key: "followers",
      title: "Read your follower list, as you.",
      text: "Only a signed-in read carries each follower’s follow record, which is what dates the growth curve.",
      tokens: [appviewToken("app.bsky.graph.getFollowers")]
    ),
    PermissionGroup(
      key: "notifications",
      title: "Read your notifications.",
      text: "Who liked, reposted, replied to, quoted and mentioned you.",
      tokens: [appviewToken("app.bsky.notification.listNotifications")]
    ),
    PermissionGroup(
      key: "follow",
      title: "Follow and unfollow, when you press the button.",
      text: "Create and delete follow records, for the Follow buttons, Follow cleanup and the Follow-back queue.",
      tokens: ["repo:app.bsky.graph.follow?action=create&action=delete"]
    ),
    PermissionGroup(
      key: "post",
      title: "Post, reply and delete posts, when you ask it to.",
      text: "Write posts and threads, set who can reply and quote, and delete a post you choose or one whose timer runs out. A scheduled post is written by Virga’s server at the time you picked.",
      tokens: ["repo:app.bsky.feed.post", "repo:app.bsky.feed.threadgate", "repo:app.bsky.feed.postgate"]
    ),
    PermissionGroup(
      key: "templates",
      title: "Keep post templates in your repo.",
      text: "Templates are records in your own repo, where anyone can read them, and where other apps that use the same format find them too.",
      tokens: ["repo:net.anisota.feed.template"]
    ),
    PermissionGroup(
      key: "media",
      title: "Upload images and video for your posts.",
      text: "Pictures and videos go to your PDS, and videos through Bluesky’s video service, which needs a short-lived pass from your PDS.",
      tokens: [
        "blob:image/*",
        "blob:video/*",
        "rpc:com.atproto.repo.uploadBlob?aud=*",
        "rpc:app.bsky.video.getUploadLimits?aud=*",
        "rpc:app.bsky.video.getJobStatus?aud=*",
      ]
    ),
    PermissionGroup(
      key: "drafts",
      title: "Keep drafts with Bluesky.",
      text: "Your drafts are Bluesky’s private drafts, so they’re there in any app that reads them, and only you can see them.",
      tokens: [
        appviewToken("app.bsky.draft.getDrafts"),
        appviewToken("app.bsky.draft.createDraft"),
        appviewToken("app.bsky.draft.updateDraft"),
        appviewToken("app.bsky.draft.deleteDraft"),
      ]
    ),
    PermissionGroup(
      key: "compose",
      title: "Read what a new post needs.",
      text: "Your default reply settings, your saved posts (for the embed library) and post search.",
      tokens: [
        appviewToken("app.bsky.actor.getPreferences"),
        appviewToken("app.bsky.bookmark.getBookmarks"),
        appviewToken("app.bsky.feed.searchPosts"),
      ]
    ),
    PermissionGroup(
      key: "defense",
      onlyWith: "defense",
      title: "Read who you know in common with an account, as you, when Defense is on.",
      text: "A scan sorts everyone who engaged with a post by how many of the people you follow also follow them, and only a signed-in read of their profiles says that. Asked for only after you turn Defense on.",
      tokens: [appviewToken("app.bsky.actor.getProfiles")]
    ),
    PermissionGroup(
      key: "defense-lists",
      onlyWith: "lists",
      title: "Make block lists and add people to them, when you approve it.",
      text: "Create a moderation list in your repo, and add and remove the people on it, for the lists Defense keeps: only the people you approved, never anyone you follow or keep. Asked for only when you make your first list.",
      tokens: ["repo:app.bsky.graph.list?action=create", "repo:app.bsky.graph.listitem?action=create&action=delete"]
    ),
  ]

  /// The order the tokens are asked for in, as the web app and Virga's
  /// server spell it out.
  public static let oauthScope: String = [
    "atproto",
    appviewToken("app.bsky.graph.getFollowers"),
    appviewToken("app.bsky.notification.listNotifications"),
    "repo:app.bsky.graph.follow?action=create&action=delete",
    "repo:app.bsky.feed.post",
    "repo:app.bsky.feed.threadgate",
    "repo:app.bsky.feed.postgate",
    "repo:net.anisota.feed.template",
    "blob:image/*",
    "blob:video/*",
    appviewToken("app.bsky.draft.getDrafts"),
    appviewToken("app.bsky.draft.createDraft"),
    appviewToken("app.bsky.draft.updateDraft"),
    appviewToken("app.bsky.draft.deleteDraft"),
    appviewToken("app.bsky.actor.getPreferences"),
    appviewToken("app.bsky.bookmark.getBookmarks"),
    appviewToken("app.bsky.feed.searchPosts"),
    "rpc:com.atproto.repo.uploadBlob?aud=*",
    "rpc:app.bsky.video.getUploadLimits?aud=*",
    "rpc:app.bsky.video.getJobStatus?aud=*",
  ].joined(separator: " ")

  /// What Defense adds to a sign-in: the signed-in getProfiles.
  public static let defenseTokens = [appviewToken("app.bsky.actor.getProfiles")]

  public static let defenseScope = "\(oauthScope) \(defenseTokens.joined(separator: " "))"

  /// What Defense's lists add on top of that.
  public static let listTokens = [
    "repo:app.bsky.graph.list?action=create",
    "repo:app.bsky.graph.listitem?action=create&action=delete",
  ]

  public static let listsScope = "\(defenseScope) \(listTokens.joined(separator: " "))"

  /// Every token any sign-in may ask for.
  public static let declaredScope = listsScope

  /// How much of Defense a sign-in asks for.
  public enum DefenseLevel: String, Codable, Sendable {
    case scan, lists
  }

  /// The web app's `defenseLevel`: 'scan' (or true), 'lists', else none.
  public static func defenseLevel(_ value: JSONValue?) -> DefenseLevel? {
    switch value {
    case .bool(true), .string("scan"): return .scan
    case .string("lists"): return .lists
    default: return nil
    }
  }

  /// The scope a sign-in asks for at a Defense level.
  public static func signInScope(defense: DefenseLevel?) -> String {
    switch defense {
    case .lists: return listsScope
    case .scan: return defenseScope
    case nil: return oauthScope
    }
  }

  /// The tokens a session must have been granted to post.
  public static let postingTokens = [
    "repo:app.bsky.feed.post",
    "repo:app.bsky.feed.threadgate",
    "repo:app.bsky.feed.postgate",
    "blob:image/*",
  ]
}
