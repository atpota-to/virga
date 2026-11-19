// Ports src/lib/locale.js
//
// A language tag read the way `new Intl.Locale(tag)` reads it, for the
// parts of src/lib/locale.js that ask it questions: is the tag well formed
// (Intl.Locale throws a RangeError if not), what are its language, script
// and region once deprecated codes are replaced (iw is he, UK is GB), and
// what region does `maximize()` give a tag without one (de is DE, zh-Hant
// TW). The data behind it comes from the same Intl (LocaleData+Table.swift).

import Foundation

public struct LanguageTag: Hashable, Sendable {
  /// The language as written, lower-cased (`iw`, `eng`).
  public let rawLanguage: String
  /// The canonical language (`he`, `en`); nil for `und`.
  public let language: String?
  /// The script, title-cased (`Latn`), if the tag or its language's alias has one.
  public let script: String?
  /// The canonical region (`GB` for `UK`), if the tag or its alias has one.
  public let region: String?
  /// The variants, lower-cased, in the order written.
  public let variants: [String]

  /// Parses `tag`, or nil where `new Intl.Locale(tag)` throws: anything but
  /// hyphen-separated ASCII subtags in BCP 47's order (a language of 2–3 or
  /// 5–8 letters, a 4-letter script, a 2-letter or 3-digit region,
  /// variants, extensions and private use), a repeated variant or
  /// extension, or `root`.
  public init?(_ tag: String) {
    let subtags = tag.split(separator: "-", omittingEmptySubsequences: false).map(String.init)
    guard !subtags.isEmpty else { return nil }
    for subtag in subtags {
      guard (1...8).contains(subtag.utf8.count), subtag.utf8.allSatisfy(Self.isAlphaNumeric) else { return nil }
    }
    var index = 0
    let first = subtags[0].lowercased()
    guard first.utf8.allSatisfy(Self.isAlpha), [2, 3, 5, 6, 7, 8].contains(first.utf8.count) else { return nil }
    index = 1
    var script: String?
    var region: String?
    var variants: [String] = []
    if index < subtags.count, subtags[index].utf8.count == 4, subtags[index].utf8.allSatisfy(Self.isAlpha) {
      script = subtags[index].prefix(1).uppercased() + subtags[index].dropFirst().lowercased()
      index += 1
    }
    if index < subtags.count {
      let s = subtags[index]
      if (s.utf8.count == 2 && s.utf8.allSatisfy(Self.isAlpha)) || (s.utf8.count == 3 && s.utf8.allSatisfy(Self.isDigit)) {
        region = s.uppercased()
        index += 1
      }
    }
    while index < subtags.count {
      let s = subtags[index].lowercased()
      let bytes = Array(s.utf8)
      let isVariant = (5...8).contains(bytes.count) || (bytes.count == 4 && Self.isDigit(bytes[0]))
      guard isVariant else { break }
      guard !variants.contains(s) else { return nil }
      variants.append(s)
      index += 1
    }
    // Extensions: a singleton and at least one subtag of 2–8; private use
    // (x) last, with subtags of 1–8. No singleton twice.
    var singletons = Set<String>()
    while index < subtags.count {
      let singleton = subtags[index].lowercased()
      guard singleton.utf8.count == 1 else { return nil }
      guard !singletons.contains(singleton) else { return nil }
      singletons.insert(singleton)
      index += 1
      let start = index
      if singleton == "x" {
        guard index < subtags.count else { return nil }
        index = subtags.count
        break
      }
      while index < subtags.count, subtags[index].utf8.count >= 2 {
        index += 1
      }
      guard index > start else { return nil }
      if singleton == "u", !Self.validUnicodeExtension(Array(subtags[start..<index])) { return nil }
    }

    let languages = LocaleData.table.languages
    var language: String? = first
    if let alias = languages.aliases[first] {
      let parts = alias.split(separator: "-").map(String.init)
      language = parts[0]
      for part in parts.dropFirst() {
        if part.count == 4, script == nil { script = part }
        if part.count == 2 || part.count == 3, region == nil { region = part }
      }
    }
    if language == "und" { language = nil }
    if let current = region, let alias = languages.regionAliases[current] { region = alias }
    self.rawLanguage = first
    self.language = language
    self.script = script
    self.region = region
    self.variants = variants
  }

  /// `locale.maximize().region`: the tag's own region, else the likeliest
  /// one for its language (in its script, where that differs), else nil.
  public var maximizedRegion: String? {
    if let region { return region }
    let languages = LocaleData.table.languages
    if let script, let found = languages.scriptRegions["\(rawLanguage)-\(script)"] { return found }
    if let found = languages.likelyRegions[rawLanguage] { return found }
    if let language, let script, let found = languages.scriptRegions["\(language)-\(script)"] { return found }
    if let language { return languages.likelyRegions[language] }
    return nil
  }

  /// Whether Intl formats in this language at all (supportedLocalesOf).
  public var isSupported: Bool {
    LocaleData.supportedLanguages.contains(rawLanguage)
  }

  static func isAlpha(_ byte: UInt8) -> Bool { (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A) }
  static func isDigit(_ byte: UInt8) -> Bool { byte >= 0x30 && byte <= 0x39 }
  static func isAlphaNumeric(_ byte: UInt8) -> Bool { isAlpha(byte) || isDigit(byte) }

  /// A `-u-` extension: attributes (3–8) first, then keywords, each a
  /// 2-character key (alphanumeric then a letter) and any 3–8 types.
  static func validUnicodeExtension(_ subtags: [String]) -> Bool {
    subtags.allSatisfy { subtag in
      let bytes = Array(subtag.utf8)
      return bytes.count == 2 ? isAlpha(bytes[1]) : (3...8).contains(bytes.count)
    }
  }
}
