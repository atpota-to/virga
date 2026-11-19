// Ports src/posting/lib/composeIntent.js
//
// Compose-intent links: a public URL that opens the composer prefilled.
//
//     https://<virga>/intent/compose?text=hello&url=https://example.com&tags=a,b
//
// Mirrors Bluesky's intent links, so callers only swap the host; `url` and
// `tags` are additions. On iOS the same links arrive as universal links (the
// app's associated domain serves /intent/compose).
//
// An intent never posts. Every value comes from whoever wrote the link, so it
// only fills a draft the person must still send; all input is bounded and
// sanitized for the same reason.

import Foundation
import VirgaCore

/// A compose intent, read.
public struct ParsedComposeIntent: Codable, Hashable, Sendable {
  public var hasIntent: Bool
  /// The post text to open with: the prose with the link joined below it,
  /// within the post limit.
  public var text: String
  /// The link on its own (for a link card).
  public var url: String
  public var tags: [String]
  /// Whether the limit forced a cut.
  public var truncated: Bool
}

/// What a compose intent link is built from.
public struct ComposeIntentInput: Hashable, Sendable {
  public enum Tags: Hashable, Sendable {
    case text(String)
    case list([String])
  }

  public var text: String?
  public var url: String?
  public var tags: Tags?

  public init(text: String? = nil, url: String? = nil, tags: Tags? = nil) {
    self.text = text
    self.url = url
    self.tags = tags
  }
}

public enum ComposeIntent {
  /// The canonical path.
  public static let intentComposePath = "/intent/compose"

  /// The post limit in graphemes; intent text is clamped so it arrives postable.
  public static let maxPostGraphemes = 300

  /// Recognized parameters; anything else is ignored. `title` is only a
  /// fallback for `text`.
  public static let composeIntentParams = ["text", "url", "tags", "title"]

  static let emptyIntent = ParsedComposeIntent(hasIntent: false, text: "", url: "", tags: [], truncated: false)

  /// URLSearchParams from a query string or a full URL.
  static func toSearchParams(_ source: String) -> URLSearchParams {
    let queryStart = source.jsIndexOf("?")
    return URLSearchParams(queryStart >= 0 ? source.jsSlice(queryStart + 1) : source)
  }

  /// URLSearchParams from any value the web accepts: a string, an object of
  /// parameters (null values skipped, others made strings), or nothing.
  static func toSearchParams(_ source: JSONValue?) -> URLSearchParams {
    guard let source, source.isTruthy else { return URLSearchParams() }
    switch source {
    case .string(let text):
      return toSearchParams(text)
    case .object(let members):
      var params = URLSearchParams()
      for (key, value) in members.sorted(by: { $0.key < $1.key }) where !value.isNull {
        params.append(key, value.jsString)
      }
      return params
    case .array(let values):
      var params = URLSearchParams()
      for (index, value) in values.enumerated() where !value.isNull {
        params.append(String(index), value.jsString)
      }
      return params
    default:
      return URLSearchParams()
    }
  }

  /// Only http(s) URLs survive; anything else is dropped outright, not escaped.
  static func normalizeUrl(_ raw: String?) -> String {
    let trimmed = (raw ?? "").jsTrimmed()
    guard !trimmed.isEmpty, let parsed = try? WHATWGURL(trimmed) else { return "" }
    guard parsed.protocolString == "http:" || parsed.protocolString == "https:" else { return "" }
    return parsed.href
  }

  /// Join `text` and `url` within the post limit. The prose gives way and
  /// the URL stays whole, unless the URL alone can't fit.
  static func joinWithinLimit(_ text: String, _ url: String) -> (body: String, truncated: Bool) {
    if url.isEmpty || text.jsIndexOf(url) >= 0 {
      let clamped = Graphemes.truncateGraphemes(text, maxPostGraphemes)
      return (clamped, !clamped.utf16.elementsEqual(text.utf16))
    }
    if text.isEmpty {
      let clamped = Graphemes.truncateGraphemes(url, maxPostGraphemes)
      return (clamped, !clamped.utf16.elementsEqual(url.utf16))
    }
    let separator = "\n\n"
    let budget = maxPostGraphemes - Graphemes.countGraphemes(url) - Graphemes.countGraphemes(separator)
    if budget <= 0 {
      return (Graphemes.truncateGraphemes(url, maxPostGraphemes), true)
    }
    let trimmedText = Graphemes.truncateGraphemes(text, budget)
    return (trimmedText + separator + url, !trimmedText.utf16.elementsEqual(text.utf16))
  }

  /// Read a compose intent from URLSearchParams.
  public static func parseComposeIntent(_ params: URLSearchParams) -> ParsedComposeIntent {
    if !composeIntentParams.contains(where: params.has) { return emptyIntent }
    // `title` only when `text` is empty (a share with both usually repeats itself).
    let raw = [params.get("text"), params.get("title")].compactMap { $0 }.first { !$0.isEmpty } ?? ""
    let text = RichText.sanitizeText(raw).jsTrimmed()
    let url = normalizeUrl(params.get("url"))
    let tags = Tags.normalizeTags(params.get("tags"))
    let (body, truncated) = joinWithinLimit(text, url)
    if body.isEmpty, tags.isEmpty { return emptyIntent }
    return ParsedComposeIntent(hasIntent: true, text: body, url: url, tags: tags, truncated: truncated)
  }

  /// Read a compose intent from a query string or a full URL.
  public static func parseComposeIntent(_ search: String?) -> ParsedComposeIntent {
    guard let search, !search.isEmpty else { return emptyIntent }
    return parseComposeIntent(toSearchParams(search))
  }

  /// Read a compose intent from a string or a plain object of parameters.
  public static func parseComposeIntent(_ search: JSONValue?) -> ParsedComposeIntent {
    parseComposeIntent(toSearchParams(search))
  }

  /// The inverse of parseComposeIntent. Omits empty parameters and puts
  /// `text` first (the Bluesky-compatible part). Throws "Invalid URL" for an
  /// origin that can't be a base, as `new URL` does.
  ///
  /// - Parameter origin: the site the link opens; the web defaults to the
  ///   page's own origin, and to `http://localhost` with none.
  public static func buildComposeIntentUrl(_ intent: ComposeIntentInput = ComposeIntentInput(), origin: String? = nil)
    throws -> String
  {
    let base = origin.flatMap { $0.isEmpty ? nil : $0 } ?? "http://localhost"
    var target = try WHATWGURL(intentComposePath, base: base)
    var params = target.searchParams
    if let text = intent.text, !text.isEmpty { params.set("text", text) }
    if let url = intent.url, !url.isEmpty { params.set("url", url) }
    let tagList: String?
    switch intent.tags {
    case .list(let list)?: tagList = list.joined(separator: ", ")
    case .text(let text)?: tagList = text
    case nil: tagList = nil
    }
    if let tagList, !tagList.isEmpty { params.set("tags", tagList) }
    target.setSearchParams(params)
    return target.href
  }
}
