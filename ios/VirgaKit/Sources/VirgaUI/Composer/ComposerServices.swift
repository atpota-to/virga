// Ports src/posting/composer/Composer.jsx (what it calls to publish: the seam publish.js plugs into)
//
// What the composer reaches beyond its own state, as seams the app fills:
//
// - ComposerPublisher: publish.js's `publish(state, target, { onProgress })`.
//   It takes the composer's state and the account's target (its agent, DID
//   and PDS), reports the web's progress events (`{ phase: 'uploading',
//   kind: 'images', done, total }`, `{ phase: 'video', step }`, `{ phase:
//   'writing', count }`, `{ phase: 'uploaded', … }`), and returns the web's
//   result (`{ posts, root, written, warnings }`) or throws what publish
//   throws (a PublishError's code and message, read by publishErrorView).
//   Task cancellation is the web's AbortSignal. Until VirgaPosting's port
//   of publish.js is wired, the app's is UnavailablePublisher: the button
//   shows the web's busy line, then says publishing isn't here yet.
// - ComposerLinkCards: linkCard.js's fetchLinkCard, a stand-in over the
//   session's transport until the publishing port's own replaces it.

#if canImport(UIKit)
import Foundation
import VirgaCore
import VirgaNetwork
import VirgaPosting
import VirgaSession

/// What publish.js returns: `{ posts, root, written, warnings }`.
public struct ComposerPublishResult: Sendable {
  /// `{ uri, cid }` of the first post.
  public var root: JSONValue
  public var posts: [JSONValue]
  /// `[{ uri, cid, record }]`.
  public var written: [JSONValue]
  /// `[{ message }]`.
  public var warnings: [JSONValue]

  public init(root: JSONValue, posts: [JSONValue] = [], written: [JSONValue] = [], warnings: [JSONValue] = []) {
    self.root = root
    self.posts = posts
    self.written = written
    self.warnings = warnings
  }
}

/// publish.js's `publish`, as the composer drives it.
public protocol ComposerPublisher: Sendable {
  /// Publishes `state` as `target`'s account. `onProgress` hears the web's
  /// progress events; cancelling the task is the web's abort.
  func publish(
    _ state: ComposerState, target: SessionTarget, requireAltText: Bool,
    onProgress: @escaping @Sendable (JSONValue) -> Void
  ) async throws -> ComposerPublishResult
}

/// The sentences for what the composer can't do on iOS yet.
public enum ComposerUnported {
  public static let publish = "Publishing isn’t in the iOS app yet."
  public static let schedule = "Scheduling isn’t in the iOS app yet."
  public static let draft = "Saving drafts isn’t in the iOS app yet."
  public static let open = "Opening drafts and scheduled posts isn’t in the iOS app yet."
}

/// The publisher until publish.js's port is wired: it says so, after the
/// moment the web spends getting the post ready.
public struct UnavailablePublisher: ComposerPublisher {
  public init() {}

  struct Unavailable: Error, JSErrorConvertible {
    var jsFields: JSErrorFields { JSErrorFields(name: "PublishError", message: ComposerUnported.publish) }
  }

  public func publish(
    _ state: ComposerState, target: SessionTarget, requireAltText: Bool,
    onProgress: @escaping @Sendable (JSONValue) -> Void
  ) async throws -> ComposerPublishResult {
    try await Task.sleep(nanoseconds: 400_000_000)
    throw Unavailable()
  }
}

/// linkCard.js's fetchLinkCard, until the publishing port's replaces it:
/// cardyb's reading of the page, or nil. `url` stays the address given.
public enum ComposerLinkCards {
  public static let cardyb = "https://cardyb.bsky.app"
  public static let titleMax = 200
  public static let descriptionMax = 500

  /// An http(s) address, or nil.
  static func safeExternalUrl(_ raw: String?) -> String? {
    guard let raw, let parts = URLComponents(string: raw.jsTrimmed()),
      let scheme = parts.scheme?.lowercased(), scheme == "http" || scheme == "https", parts.host != nil
    else { return nil }
    return raw.jsTrimmed()
  }

  public static func fetchLinkCard(_ url: String, transport: any HTTPTransport) async -> ComposerCard? {
    guard safeExternalUrl(url) != nil else { return nil }
    let address = "\(cardyb)/v1/extract?url=\(JSURI.encodeURIComponent(url))"
    guard let response = try? await transport.send(HTTPRequest(method: "GET", url: address, timeoutMs: 10_000)),
      (200..<300).contains(response.status), let data = try? JSONValue.parse(response.body), data.isTruthy,
      !(data["error"]?.isTruthy ?? false)
    else { return nil }
    let title = data["title"]?.stringValue ?? ""
    let description = data["description"]?.stringValue ?? ""
    var card: [String: JSONValue] = [
      "url": .string(url), "title": .string(title.jsSlice(0, titleMax)),
      "description": .string(description.jsSlice(0, descriptionMax)),
    ]
    card["thumb"] = safeExternalUrl(data["image"]?.stringValue).map(JSONValue.string) ?? .null
    return ComposerCard(json: .object(card))
  }
}

/// The composer's icons (lucide's names, as SF Symbols).
enum ComposerGlyph {
  static let images = "photo.badge.plus"  // ImagePlus
  static let video = "film"  // Film
  static let library = "book"  // BookOpen
  static let tags = "number"  // Hash
  static let languages = "character.bubble"  // Languages
  static let replies = "arrowshape.turn.up.left"  // MessageSquareReply
  static let timer = "clock"  // Clock
  static let more = "ellipsis"  // MoreHorizontal
  static let chevronDown = "chevron.down"
  static let chevronRight = "chevron.right"
  static let chevronLeft = "chevron.left"
  static let close = "xmark"  // X
  static let post = "paperplane"  // Send
  static let schedule = "calendar.badge.clock"  // CalendarClock
  static let queue = "text.badge.plus"  // ListPlus
  static let draft = "square.and.arrow.down"  // Save
  static let moveUp = "arrow.up"
  static let moveDown = "arrow.down"
  static let trash = "trash"  // Trash2
  static let split = "scissors"  // Scissors
  static let check = "checkmark"
  static let replyingTo = "arrow.turn.down.right"  // CornerDownRight
  static let retry = "arrow.counterclockwise"  // RotateCcw
  static let edit = "pencil"  // Pencil
  static let feed = "antenna.radiowaves.left.and.right"  // Rss
  static let people = "person.2"  // Users
  static let list = "list.bullet"  // List
  static let noImage = "photo"  // ImageOff
  static let signIn = "arrow.forward.circle"  // LogIn
  static let plus = "plus"
}

extension ComposerPublisher where Self == UnavailablePublisher {
  /// The publisher the app runs until publish.js's port is wired.
  public static var unavailable: UnavailablePublisher { UnavailablePublisher() }
}
#endif
