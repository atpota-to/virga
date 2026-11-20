// Every area and action of Virga's server (api/*/[action].js), and what the
// iOS app does with each: the Swift service that calls it, or why the app
// never does. ios/parity/cases/api.surface.js reads the routers themselves,
// and APISurfaceParityTests holds this table to that fixture exactly, so a
// route added to the server fails `swift test` until it is classified here.

import Foundation

public enum APISurface {
  public enum Use: Sendable, Hashable {
    /// The app calls it, through `service` (a type in `target`, the port of
    /// the web module `web`).
    case app(service: String, target: String, web: String)
    /// Only the server's own callers use it.
    case serverOnly(reason: String)

    public var isApp: Bool {
      if case .app = self { return true }
      return false
    }
  }

  public struct Route: Sendable, Hashable {
    public var area: String
    public var action: String
    public var use: Use

    /// `/api/<area>/<action>`.
    public var path: String { VirgaBackend.path(area: area, action: action) }
  }

  static let cron = "A cron: called every minute by Vercel Cron with CRON_SECRET (or by the worker), never by a client."
  static let oauthMetadata =
    "The OAuth client's published metadata and keys, read by authorization servers, never by the app."

  static func ai(_ action: String) -> Route {
    Route(area: "ai", action: action, use: .app(service: "AIService", target: "VirgaPosting", web: "src/posting/adviser/aiService.js"))
  }
  static func defense(_ action: String) -> Route {
    Route(area: "defense", action: action, use: .app(service: "DefenseService", target: "VirgaDefense", web: "src/defense/defenseService.js"))
  }
  static func schedule(_ action: String) -> Route {
    Route(
      area: "schedule", action: action,
      use: .app(service: "ScheduleService", target: "VirgaPosting", web: "src/posting/schedule/scheduleService.js"))
  }
  static func timer(_ action: String) -> Route {
    Route(
      area: "self-destruct", action: action,
      use: .app(service: "TimerService", target: "VirgaPosting", web: "src/posting/timers/timerService.js"))
  }
  static func terms(_ action: String) -> Route {
    Route(area: "terms", action: action, use: .app(service: "TermsService", target: "VirgaSession", web: "src/legal/termsService.js"))
  }
  static func oauth(_ action: String, _ service: String) -> Route {
    Route(area: "oauth", action: action, use: .app(service: service, target: "VirgaNetwork", web: "src/session/backendClient.js"))
  }
  static func server(_ area: String, _ action: String, _ reason: String) -> Route {
    Route(area: area, action: action, use: .serverOnly(reason: reason))
  }

  public static let routes: [Route] = [
    ai("alt-text"),
    ai("analyze-post"),
    ai("synthesize-style"),

    defense("approve"),
    defense("history"),
    defense("keep"),
    defense("link"),
    defense("link-code"),
    defense("link-list"),
    defense("list-create"),
    defense("lists"),
    server(
      "defense", "moderator",
      "The worker's calls for the moderator it runs on the droplet, signed with DEFENSE_WORKER_SECRET (server/defense/handlers/moderator.js)."
    ),
    defense("plan"),
    server("defense", "run", "The list writer: " + cron),
    defense("undo"),
    defense("unkeep"),
    defense("unlink"),

    Route(
      area: "limits", action: "status",
      use: .app(service: "ScheduleService", target: "VirgaPosting", web: "src/posting/schedule/scheduleService.js")),

    server(
      "oauth", "callback",
      "Where the authorization server sends the browser back; it redirects to /oauth/return, which the app reads with BackendClient.readBackendReturn."
    ),
    server("oauth", "client-metadata", oauthMetadata),
    server("oauth", "client-metadata.json", oauthMetadata),
    server("oauth", "jwks", oauthMetadata),
    server("oauth", "jwks.json", oauthMetadata),
    oauth("login", "BackendClient.startBackendSignIn"),
    oauth("logout", "BackendClient.backendSignOut"),
    oauth("proxy", "BackendFetchHandler"),
    oauth("session", "BackendClient.checkBackendSession"),
    oauth("upload-blob", "BackendFetchHandler"),

    schedule("cancel"),
    schedule("create"),
    schedule("get"),
    schedule("list"),
    schedule("media"),
    schedule("reorder"),
    server("schedule", "run", "The scheduled-posts worker: " + cron),
    schedule("update"),

    timer("cancel"),
    timer("create"),
    timer("list"),
    server("self-destruct", "run", "The timers' worker: " + cron),

    terms("accept"),
    terms("status"),
  ]

  /// The route for an area and action.
  public static func route(area: String, action: String) -> Route? {
    routes.first { $0.area == area && $0.action == action }
  }

  /// Every action by area, sorted, as the api.surface fixture lists them.
  public static var areas: [String: [String]] {
    Dictionary(grouping: routes, by: \.area).mapValues { $0.map(\.action).sorted() }
  }
}
