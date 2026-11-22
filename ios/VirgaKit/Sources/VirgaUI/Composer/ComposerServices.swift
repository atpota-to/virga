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
//   Task cancellation is the web's AbortSignal. The app's is
//   PostingPublisher, VirgaPosting's Publish.publish over the composer's
//   temporary files, ImageIO and the session's transport; previews and
//   tests can give UnavailablePublisher, which says publishing isn't here.
// Link cards are VirgaPosting's LinkCard.fetchLinkCard, through
// `ComposerLinkCards.fetchLinkCard`, which reads the card as a ComposerCard.

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
  public static let open = "Opening scheduled posts isn’t in the iOS app yet."
}

/// A publisher that doesn't (previews, tests): it says publishing isn't in
/// the iOS app, after the moment the web spends getting the post ready.
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

/// The app's publisher: publish.js's publish (VirgaPosting's Publish) as
/// the account the composer chose, its files the composer's temporary
/// files, its images prepared by ImageIO.
public struct PostingPublisher: ComposerPublisher {
  let media: PublishMedia

  public init(transport: any HTTPTransport, clock: NetworkClock) {
    media = PublishMedia(files: TemporaryComposerFiles(), encoder: ImageIOEncoder(), transport: transport, clock: clock)
  }

  public func publish(
    _ state: ComposerState, target: SessionTarget, requireAltText: Bool,
    onProgress: @escaping @Sendable (JSONValue) -> Void
  ) async throws -> ComposerPublishResult {
    let result = try await Publish.publish(
      state, PublishTarget(did: target.did, agent: target.agent, pdsUrl: target.pdsUrl), media: media,
      onProgress: onProgress, requireAltText: requireAltText)
    func json<T: Encodable>(_ value: T?) -> JSONValue { value.flatMap { try? JSONValue(encoding: $0) } ?? .null }
    return ComposerPublishResult(
      root: json(result.root), posts: result.posts.map { json($0) }, written: result.written.map { json($0) },
      warnings: result.warnings)
  }
}

/// linkCard.js's fetchLinkCard (VirgaPosting's LinkCard) as the composer
/// reads it: a ComposerCard, or nil.
public enum ComposerLinkCards {
  public static let titleMax = LinkCard.cardTitleMax
  public static let descriptionMax = LinkCard.cardDescriptionMax

  public static func fetchLinkCard(_ url: String, transport: any HTTPTransport) async -> ComposerCard? {
    guard let card = try? await LinkCard.fetchLinkCard(url, transport: transport), card.isTruthy else { return nil }
    return ComposerCard(json: card)
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
  /// A publisher that says publishing isn't in the iOS app.
  public static var unavailable: UnavailablePublisher { UnavailablePublisher() }
}
#endif
