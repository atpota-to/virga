// Ports src/posting/lib/linkCard.js
//
// Link cards: the preview a post shows for an external link. The page's
// title, description and image come from Bluesky's card service (cardyb); the
// image is fetched, shrunk under the thumbnail limit and uploaded as the write
// account when the post is published.
//
// The web's options are `{ fetch, signal, compress, decode }`: here the
// transport is VirgaNetwork's HTTPTransport, the re-encode is the app's
// ImageEncoder, a caller's AbortSignal.timeout is `deadlineMs` (the request
// gets the sooner of it and the service's own ten seconds, as AbortSignal.any
// does) and an abort is the task's cancellation.

import Foundation
import VirgaCore
import VirgaNetwork

/// A card image that couldn't be had: the web's `new Error(message)`.
public struct LinkCardError: Error, LocalizedError, Hashable, Sendable {
  public var message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

public enum LinkCard {
  public static let cardybOrigin = "https://cardyb.bsky.app"
  public static let cardTitleMax = 200
  public static let cardDescriptionMax = 500
  static let cardTimeoutMs: Double = 10_000

  /// getEmbedExternalView resolves at most four AT-URIs per card.
  public static let maxAssociatedRefs = Embeds.maxAssociatedRefs

  /// `external.associatedRefs`: strongRefs to the records behind a linked
  /// page (standard.site documents and publications), which the AppView
  /// hydrates into a richer card. Coerced to `at://` URIs with a CID,
  /// deduped, capped; nil when there are none. (embeds.js imports this one
  /// function from linkCard.js; posting-text ported it as
  /// Embeds.normalizeAssociatedRefs, which this is.)
  public static func normalizeAssociatedRefs(_ raw: JSONValue?) -> [JSONValue]? {
    Embeds.normalizeAssociatedRefs(raw)
  }

  /// `timeoutSignal(signal, ms)`'s deadline: the sooner of the caller's and `ms`.
  static func deadline(_ callerMs: Double?, _ ms: Double) -> Double {
    guard let callerMs else { return ms }
    return Swift.min(callerMs, ms)
  }

  /// Whether a failure is the caller's signal having aborted: the task was
  /// cancelled, or the caller's deadline (no later than the service's own)
  /// ran out.
  static func callerAborted(_ error: any Error, deadlineMs: Double?) -> Bool {
    if Task.isCancelled || error is CancellationError { return true }
    if let deadlineMs, deadlineMs <= cardTimeoutMs, case HTTPTransportError.timedOut = error { return true }
    return false
  }

  /// The card for `url`, in the composer's card shape (`{ url, title,
  /// description, thumb, associatedRefs? }`, `thumb` the image's address or
  /// null), or nil when the service has nothing or can't be reached. `url`
  /// stays the address the writer gave, not the one the service settled on.
  /// Throws only when the caller called it off (cancelled, or its
  /// `deadlineMs` ran out).
  public static func fetchLinkCard(
    _ url: String?, deadlineMs: Double? = nil, transport: any HTTPTransport = HTTP.transport
  ) async throws -> JSONValue? {
    guard let url, RichText.safeExternalUrl(url) != nil else { return nil }
    do {
      let request = HTTPRequest(
        url: "\(cardybOrigin)/v1/extract?url=\(JSURI.encodeURIComponent(url))",
        timeoutMs: deadline(deadlineMs, cardTimeoutMs))
      let response = try await transport.send(request)
      if !response.ok { return nil }
      let data = try response.json()
      if !data.isTruthy || data["error"]?.isTruthy == true { return nil }
      var card: JSONValue = [
        "url": .string(url),
        "title": .string(text(data["title"]).jsSlice(0, cardTitleMax)),
        "description": .string(text(data["description"]).jsSlice(0, cardDescriptionMax)),
        "thumb": RichText.safeExternalUrl(data["image"]).map(JSONValue.string) ?? .null,
      ]
      if let refs = normalizeAssociatedRefs(data["associated_refs"]) { card["associatedRefs"] = .array(refs) }
      return card
    } catch {
      if callerAborted(error, deadlineMs: deadlineMs) { throw error }
      return nil
    }
  }

  /// fetchLinkCard as the library's (and drafts') injected card fetcher:
  /// `(url) async throws -> card?`.
  public static func fetchLinkCard(transport: any HTTPTransport = HTTP.transport) -> @Sendable (String) async throws
    -> JSONValue?
  {
    { url in try await fetchLinkCard(url, transport: transport) }
  }

  /// `String(value || '')`.
  static func text(_ value: JSONValue?) -> String {
    guard let value, value.isTruthy else { return "" }
    return value.jsString
  }

  /// Fetch a card's image and shrink it under the thumbnail limit (0.95 MB,
  /// 1920 px), without its metadata: the prepared file.
  public static func fetchCardThumbnail(
    _ imageUrl: String?, media: PublishMedia, deadlineMs: Double? = nil
  ) async throws -> ComposerFile {
    guard let safe = RichText.safeExternalUrl(imageUrl) else {
      throw LinkCardError("The card image address isn’t a web address.")
    }
    let response = try await media.transport.send(HTTPRequest(url: safe, timeoutMs: deadline(deadlineMs, cardTimeoutMs)))
    if !response.ok { throw LinkCardError("The card image couldn’t be fetched (\(response.status)).") }
    let blobType = blobType(response.headers.get("content-type"))
    let type = PostingJS.hasPrefix(blobType, "image/") ? blobType : "image/jpeg"
    let file = try await media.files.makeFile(response.body, name: "thumbnail", type: type, lastModified: nil)
    let prepared = try await Images.prepareImage(
      file, budget: Images.cardThumbBudget, encoder: media.encoder, sleep: media.clock.sleep)
    return prepared.file
  }

  /// The thumbnail blob for a card, uploaded as the write account: the
  /// writer's own image (`thumbFile`) or the page's (`thumb`), both shrunk to
  /// the thumbnail limit. A blob already uploaded as this account is reused.
  /// Nil when there is no image or it couldn't be fetched or uploaded: the
  /// card goes out without one rather than holding the post back. Throws
  /// only when the caller called it off.
  public static func uploadCardThumb(
    _ target: PublishTarget, _ card: JSONValue?, media: PublishMedia, deadlineMs: Double? = nil
  ) async throws -> JSONValue? {
    guard let card, card.isTruthy else { return nil }
    if let blob = card["thumbBlob"], blob.isTruthy, card["thumbBlobDid"]?.stringValue?.jsEquals(target.did) == true {
      return blob
    }
    do {
      let file: ComposerFile
      if card["thumbFile"]?.isTruthy == true {
        guard let picked = ComposerFile(json: card["thumbFile"]) else { throw LinkCardError("Not a file.") }
        file = try await Images.prepareImage(
          picked, budget: Images.cardThumbBudget, encoder: media.encoder, sleep: media.clock.sleep
        ).file
      } else if let thumb = card["thumb"], thumb.isTruthy {
        file = try await fetchCardThumbnail(thumb.stringValue, media: media, deadlineMs: deadlineMs)
      } else {
        return nil
      }
      let data = try await media.files.bytes(of: file)
      let blob = try await Blobs.uploadBlob(
        agent: target.agent, data: data, encoding: file.type.isEmpty ? "image/jpeg" : file.type)
      return (try? JSONValue(encoding: blob)) ?? .null
    } catch {
      if Task.isCancelled { throw error }
      return nil
    }
  }

  // MARK: A response's blob type

  static let tokenUnits = Set("!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".utf16)

  static func isToken(_ s: Substring) -> Bool { !s.isEmpty && s.utf16.allSatisfy(tokenUnits.contains) }

  /// `(await res.blob()).type`: the Content-Type parsed as the Fetch
  /// standard extracts a MIME type (the last parsable value of the list),
  /// serialized, and lower-cased as the Blob constructor does ('' for none,
  /// or for a type outside printable ASCII).
  static func blobType(_ contentType: String?) -> String {
    guard let contentType else { return "" }
    var found: String?
    for piece in contentType.split(separator: ",", omittingEmptySubsequences: false) {
      if let parsed = parseMime(piece) { found = parsed }
    }
    guard let found else { return "" }
    if found.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value > 0x7E }) { return "" }
    return found.lowercased()
  }

  /// A MIME type serialized (`type/subtype;name=value`), or nil when it
  /// doesn't parse or is `*/*`.
  static func parseMime(_ raw: Substring) -> String? {
    let text = raw.trimmingCharacters(in: CharacterSet(charactersIn: " \t\r\n"))
    guard let slash = text.firstIndex(of: "/") else { return nil }
    let type = text[..<slash]
    let rest = text[text.index(after: slash)...]
    let parts = rest.split(separator: ";", omittingEmptySubsequences: false)
    let subtype = (parts.first ?? "").trimmingCharacters(in: CharacterSet(charactersIn: " \t\r\n"))
    guard isToken(type), isToken(Substring(subtype)) else { return nil }
    let essence = "\(type)/\(subtype)".lowercased()
    if essence == "*/*" { return nil }
    var params: [(String, String)] = []
    for param in parts.dropFirst() {
      let trimmed = param.drop(while: { $0 == " " || $0 == "\t" || $0 == "\r" || $0 == "\n" })
      guard let eq = trimmed.firstIndex(of: "=") else { continue }
      let name = trimmed[..<eq].lowercased()
      var value = String(trimmed[trimmed.index(after: eq)...])
      if value.hasPrefix("\"") {
        value = String(value.dropFirst().prefix(while: { $0 != "\"" }))
      } else {
        value = value.trimmingCharacters(in: CharacterSet(charactersIn: " \t\r\n"))
        if value.isEmpty { continue }
      }
      guard isToken(Substring(name)), !params.contains(where: { $0.0 == name }) else { continue }
      params.append((name, value))
    }
    var out = essence
    for (name, value) in params {
      let quoted = isToken(Substring(value)) && !value.isEmpty
        ? value : "\"\(value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))\""
      out += ";\(name)=\(quoted)"
    }
    return out
  }
}
