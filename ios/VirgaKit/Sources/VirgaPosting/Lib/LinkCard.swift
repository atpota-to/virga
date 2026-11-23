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
  /// only when the caller called it off: cancelled, or its `deadlineMs` (no
  /// later than the card service's ten seconds) ran out while the page's
  /// image was fetched. (The web's signal reaches the upload too; here the
  /// deadline bounds the fetch and the upload keeps its own.)
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
      // `if (signal?.aborted) throw err`.
      if callerAborted(error, deadlineMs: deadlineMs) { throw error }
      return nil
    }
  }

  // MARK: A response's blob type
  //
  // `(await res.blob()).type` as Node's fetch (undici) gives it: the
  // Content-Type's values split at the commas outside quoted strings
  // (Fetch's "getting, decoding, and splitting"), each parsed as WHATWG MIME
  // Sniffing parses a MIME type, the last that parses and isn't `*/*` taken,
  // with the charset of an earlier value of the same essence carried over
  // (Fetch's "extract a MIME type"), serialized, and lower-cased as the Blob
  // constructor does ('' for a type outside printable ASCII). In code units,
  // as the web's strings are. Undici's HTTP token code points leave out the
  // backtick the spec lists, and so does this.

  /// A parsed MIME type: its essence (`type/subtype`, lower-cased) and its
  /// parameters in the order first given.
  struct MimeType {
    var essence: [UInt16]
    var parameters: [(name: [UInt16], value: [UInt16])]

    func parameter(_ name: [UInt16]) -> [UInt16]? { parameters.first { $0.name == name }?.value }
  }

  static let tokenUnits = Set("!#$%&'*+-.^_|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".utf16)
  static let charsetName = Array("charset".utf16)
  static let anyType = Array("*/*".utf16)

  static func isToken(_ units: [UInt16]) -> Bool { !units.isEmpty && units.allSatisfy(tokenUnits.contains) }

  /// HTTP whitespace: LF, CR, tab, space.
  static func isHTTPWhitespace(_ unit: UInt16) -> Bool { unit == 0x0A || unit == 0x0D || unit == 0x09 || unit == 0x20 }

  /// An HTTP quoted-string token code point: tab, U+0020–U+007E, U+0080–U+00FF.
  static func isQuotedStringToken(_ unit: UInt16) -> Bool {
    unit == 0x09 || (0x20...0x7E).contains(unit) || (0x80...0xFF).contains(unit)
  }

  static func asciiLowercased(_ units: [UInt16]) -> [UInt16] { units.map { (0x41...0x5A).contains($0) ? $0 + 0x20 : $0 } }

  static func trimmed(_ units: [UInt16], leading: Bool = true, _ drop: (UInt16) -> Bool) -> [UInt16] {
    var slice = units[...]
    if leading { while let first = slice.first, drop(first) { slice = slice.dropFirst() } }
    while let last = slice.last, drop(last) { slice = slice.dropLast() }
    return Array(slice)
  }

  static func blobType(_ contentType: String?) -> String {
    guard let contentType, let mime = extractMimeType(Array(contentType.utf16)) else { return "" }
    let serialized = serializeMimeType(mime)
    if serialized.contains(where: { $0 < 0x20 || $0 > 0x7E }) { return "" }
    return String(decoding: asciiLowercased(serialized), as: UTF16.self)
  }

  /// Fetch's "extract a MIME type" from a Content-Type value, or nil for failure.
  static func extractMimeType(_ value: [UInt16]) -> MimeType? {
    var charset: [UInt16]?
    var essence: [UInt16]?
    var found: MimeType?
    for piece in splitHeaderValue(value) {
      guard var mime = parseMimeType(piece), mime.essence != anyType else { continue }
      if mime.essence != essence {
        charset = mime.parameter(charsetName)
        essence = mime.essence
      } else if mime.parameter(charsetName) == nil, let charset {
        mime.parameters.append((charsetName, charset))
      }
      found = mime
    }
    return found
  }

  /// Fetch's "getting, decoding, and splitting": the value split at commas
  /// outside quoted strings, each piece without its leading and trailing tabs
  /// and spaces.
  static func splitHeaderValue(_ input: [UInt16]) -> [[UInt16]] {
    var values: [[UInt16]] = []
    var position = 0
    var piece: [UInt16] = []
    while position < input.count {
      while position < input.count, input[position] != 0x22, input[position] != 0x2C {
        piece.append(input[position])
        position += 1
      }
      if position < input.count {
        if input[position] == 0x22 {
          piece += collectQuotedString(input, &position, extractValue: false)
          if position < input.count { continue }
        } else {
          position += 1
        }
      }
      values.append(trimmed(piece) { $0 == 0x09 || $0 == 0x20 })
      piece = []
    }
    return values
  }

  /// Fetch's "collect an HTTP quoted string" from the quote at `position`:
  /// the value with its escapes undone, or (not `extractValue`) the quoted
  /// string as it was written.
  static func collectQuotedString(_ input: [UInt16], _ position: inout Int, extractValue: Bool) -> [UInt16] {
    let start = position
    var value: [UInt16] = []
    position += 1
    while true {
      while position < input.count, input[position] != 0x22, input[position] != 0x5C {
        value.append(input[position])
        position += 1
      }
      if position >= input.count { break }
      let quoteOrBackslash = input[position]
      position += 1
      if quoteOrBackslash == 0x5C {
        if position >= input.count {
          value.append(0x5C)
          break
        }
        value.append(input[position])
        position += 1
      } else {
        break
      }
    }
    return extractValue ? value : Array(input[start..<position])
  }

  /// WHATWG MIME Sniffing's "parse a MIME type", or nil for failure.
  static func parseMimeType(_ raw: [UInt16]) -> MimeType? {
    let input = trimmed(raw, isHTTPWhitespace)
    var position = 0
    var type: [UInt16] = []
    while position < input.count, input[position] != 0x2F {
      type.append(input[position])
      position += 1
    }
    guard isToken(type) else { return nil }
    position += 1
    var subtype: [UInt16] = []
    while position < input.count, input[position] != 0x3B {
      subtype.append(input[position])
      position += 1
    }
    subtype = trimmed(subtype, leading: false, isHTTPWhitespace)
    guard isToken(subtype) else { return nil }
    var mime = MimeType(essence: asciiLowercased(type) + [0x2F] + asciiLowercased(subtype), parameters: [])
    while position < input.count {
      position += 1
      while position < input.count, isHTTPWhitespace(input[position]) { position += 1 }
      var name: [UInt16] = []
      while position < input.count, input[position] != 0x3B, input[position] != 0x3D {
        name.append(input[position])
        position += 1
      }
      name = asciiLowercased(name)
      if position < input.count {
        if input[position] == 0x3B { continue }
        position += 1
      }
      var value: [UInt16] = []
      if position < input.count, input[position] == 0x22 {
        value = collectQuotedString(input, &position, extractValue: true)
        while position < input.count, input[position] != 0x3B { position += 1 }
      } else {
        while position < input.count, input[position] != 0x3B {
          value.append(input[position])
          position += 1
        }
        value = trimmed(value, leading: false, isHTTPWhitespace)
        if value.isEmpty { continue }
      }
      if isToken(name), value.allSatisfy(isQuotedStringToken), mime.parameter(name) == nil {
        mime.parameters.append((name, value))
      }
    }
    return mime
  }

  /// WHATWG MIME Sniffing's "serialize a MIME type": a value that isn't a
  /// token (or is empty) quoted, its quotes and backslashes escaped.
  static func serializeMimeType(_ mime: MimeType) -> [UInt16] {
    var out = mime.essence
    for (name, value) in mime.parameters {
      out += [0x3B] + name + [0x3D]
      if isToken(value) {
        out += value
      } else {
        out.append(0x22)
        for unit in value {
          if unit == 0x22 || unit == 0x5C { out.append(0x5C) }
          out.append(unit)
        }
        out.append(0x22)
      }
    }
    return out
  }
}
