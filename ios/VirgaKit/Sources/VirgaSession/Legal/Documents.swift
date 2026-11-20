// Ports src/legal/documents.js
//
// Virga's two legal documents, as the app shows them. The text is the
// Markdown at the repo's root (TERMS_OF_SERVICE.md, PRIVACY_POLICY.md); the
// web brings it in at build time, the iOS app bundles the same two files
// (ios/project.yml) and reads them here with LegalMarkdown, so the pages and
// the files are one piece of writing.
//
// Where the web imports the text, the app loads it: `readDocument(key)` reads
// it through `LegalDocuments.loader` (the app bundle by default), and
// `readDocument(key, source:)` reads text it is given (the tests pass the
// files at the repo's root).

import Foundation
import VirgaCore

/// One of the documents: `{ key, title, short, path, file }` (the web's
/// `source` is loaded instead).
public struct LegalDocument: Sendable, Hashable, Encodable {
  public var key: String
  public var title: String
  public var short: String
  public var path: String
  public var file: String
}

/// `readDocument(key)`'s answer: `{ key, title, path, blocks, problems }`.
public struct LegalReadDocument: Sendable, Hashable, Encodable {
  public var key: String
  public var title: String
  public var path: String
  public var blocks: [MarkdownBlock]
  public var problems: [MarkdownProblem]
}

/// Where a link in a document goes: `{ href, document, external }`, and
/// `anchor: true` for a place on the same page.
public struct LegalDocumentLink: Sendable, Hashable, Encodable {
  /// The address on the site, or nil for a file that isn't one of the documents.
  public var href: String?
  /// The key of the document it opens, or nil for a link that leaves them.
  public var document: String?
  /// An address on another site, or a mailto.
  public var external: Bool
  /// Present (true) only for a `#place` on the same page.
  public var anchor: Bool?

  enum CodingKeys: String, CodingKey { case href, document, external, anchor }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    if let href { try c.encode(href, forKey: .href) } else { try c.encodeNil(forKey: .href) }
    if let document { try c.encode(document, forKey: .document) } else { try c.encodeNil(forKey: .document) }
    try c.encode(external, forKey: .external)
    try c.encodeIfPresent(anchor, forKey: .anchor)
  }
}

public enum LegalDocuments {
  public static let terms = LegalDocument(
    key: "terms", title: "Terms of Service", short: "Terms", path: LegalVersion.termsPath, file: "TERMS_OF_SERVICE.md")
  public static let privacy = LegalDocument(
    key: "privacy", title: "Privacy Policy", short: "Privacy", path: LegalVersion.privacyPath, file: "PRIVACY_POLICY.md")

  /// `Object.values(DOCUMENTS)`, in order.
  public static let all: [LegalDocument] = [terms, privacy]

  /// `DOCUMENTS[key]`.
  public static func document(_ key: String?) -> LegalDocument? {
    guard let key else { return nil }
    return all.first { $0.key.jsEquals(key) }
  }

  /// `documentFor(path)`: which document an address is, or nil: '/terms' →
  /// 'terms'. A trailing slash is the same page.
  public static func documentFor(_ path: String?) -> String? {
    var units = (path ?? "").units
    while units.last == Unit.slash { units.removeLast() }
    let clean = units.isEmpty ? "/" : units.string
    return all.first { $0.path.jsEquals(clean) }?.key
  }

  /// Reads a document's Markdown: by default from the app's bundle, where
  /// ios/project.yml puts both files.
  public static let loader = Locked<@Sendable (LegalDocument) -> String?>({ document in
    let name = document.file.hasSuffix(".md") ? String(document.file.dropLast(3)) : document.file
    guard let url = Bundle.main.url(forResource: name, withExtension: "md") else { return nil }
    return try? String(contentsOf: url, encoding: .utf8)
  })

  static let parsed = Locked<[String: LegalReadDocument]>([:])

  /// `readDocument(key)`: the document read into blocks, once. Nil for a key
  /// that isn't a document, or when its text can't be loaded.
  public static func readDocument(_ key: String) -> LegalReadDocument? {
    guard let doc = document(key) else { return nil }
    if let held = parsed.wrappedValue[doc.key] { return held }
    let load = loader.wrappedValue
    guard let source = load(doc) else { return nil }
    let read = readDocument(doc.key, source: source)
    if let read { parsed.withLock { $0[doc.key] = read } }
    return read
  }

  /// The document `key` read from `source`, its Markdown.
  public static func readDocument(_ key: String, source: String?) -> LegalReadDocument? {
    guard let doc = document(key) else { return nil }
    let read = LegalMarkdown.parseMarkdown(source)
    return LegalReadDocument(key: doc.key, title: doc.title, path: doc.path, blocks: read.blocks, problems: read.problems)
  }

  /// `resolveDocumentLink(href)`: where a link in a document goes. The
  /// documents name each other by file; here a file becomes its page.
  public static func resolveDocumentLink(_ href: String?) -> LegalDocumentLink {
    let value = (href ?? "").units
    if let file = LegalMarkdown.isDocumentFileLink(value) {
      if let doc = all.first(where: { $0.file.units == file.file }) {
        return LegalDocumentLink(href: doc.path + file.anchor.string, document: doc.key, external: false)
      }
      return LegalDocumentLink(href: nil, document: nil, external: false)
    }
    let text = value.string
    if value.first == Unit.hash { return LegalDocumentLink(href: text, document: nil, external: false, anchor: true) }
    let path = Array(value.prefix { $0 != Unit.hash }).string
    if let own = documentFor(path) { return LegalDocumentLink(href: text, document: own, external: false) }
    let external = value.hasPrefix("https:", ignoringCase: true) || value.hasPrefix("mailto:", ignoringCase: true)
    return LegalDocumentLink(href: text, document: nil, external: external)
  }
}
