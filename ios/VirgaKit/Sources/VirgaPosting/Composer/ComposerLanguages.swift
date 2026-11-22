// Ports src/posting/composer/languages.js
//
// The languages a post can say it's written in (ISO 639-1, which is what
// Bluesky's language filters read), named in the reader's language, and
// the self-labels the composer offers.
//
// The web names languages with Intl.DisplayNames. Its English names are
// tables here (ComposerLanguageNames, ComposerLanguages+Names.swift, from
// Node 22's ICU, held to it by composer.editor's fixture): every code it
// names, CLDR's names for the tags people post in (pt-BR "Brazilian
// Portuguese"), and the script and region names for a tag it names as
// "Language (Script, Region)". A locale that isn't English names through
// Foundation, which can differ from ICU's. Names sort with localeCompare
// (LocaleCompare, through `compareNames`).

import Foundation
import VirgaCore

/// A language the picker offers: `{ code, name }`.
public struct LanguageChoice: Codable, Hashable, Sendable {
  public var code: String
  public var name: String
}

/// A self-label the composer offers: `{ value, label, hint }`.
public struct SelfLabelOption: Codable, Hashable, Sendable {
  public var value: String
  public var label: String
  public var hint: String
}

public enum ComposerLanguages {
  public static let languageCodes: [String] =
    ("aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy "
    + "da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht "
    + "hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky "
    + "la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny "
    + "oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss "
    + "st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo "
    + "za zh zu").components(separatedBy: " ")

  /// The one sort the module makes, `a.localeCompare(b)` in the runtime's
  /// locale. One place, so the port of localeCompare can be switched here.
  static func compareNames(_ a: String, _ b: String) -> Int {
    LocaleCompare.compare(a, b, locale: "en-US")
  }

  /// "English" for "en", in `locale`; the code itself when there's no name.
  public static func languageName(_ code: JSONValue?, locale: String = "en") -> String {
    let clean = PostingQueue.text(code).jsTrimmed()
    if clean.isEmpty { return "" }
    if let name = displayName(clean, locale: locale), !name.jsLowercased().jsEquals(clean.jsLowercased()) {
      let units = Array(name.utf16)
      let first = String(decoding: units.prefix(1), as: UTF16.self).jsUppercased()
      return first + String(decoding: units.dropFirst(), as: UTF16.self)
    }
    return clean
  }

  public static func languageName(_ code: String?, locale: String = "en") -> String {
    languageName(code.map(JSONValue.string), locale: locale)
  }

  /// Intl.DisplayNames(locale, { type: 'language' }).of(code), or nil where
  /// it has no name or throws.
  static func displayName(_ code: String, locale: String) -> String? {
    let english = locale.jsLowercased() == "en" || PostingJS.hasPrefix(locale.jsLowercased(), "en-")
    let lower = code.jsLowercased()
    if english {
      if locale.jsLowercased() == "en-gb", lower == "ff" { return "Fulah" }
      if let name = ComposerLanguageNames.english[lower] { return name }
      if let name = ComposerLanguageNames.regional.first(where: { $0.key.jsLowercased() == lower })?.value {
        return name
      }
      return englishTagName(code)
    }
    // Another locale's names come from Foundation, which can differ from
    // ICU's: "Language (Script, Region)", or nil for a variant.
    let parts = PostingQueue.split(code, 0x2D)
    guard parts.count >= 2, let base = displayName(parts[0], locale: locale) else {
      return Locale(identifier: locale).localizedString(forLanguageCode: code)
    }
    let speaker = Locale(identifier: locale)
    var names: [String] = []
    for part in parts.dropFirst() {
      let name: String?
      switch subtagKind(part) {
      case .script: name = speaker.localizedString(forScriptCode: titlecased(part))
      case .region: name = speaker.localizedString(forRegionCode: part.jsUppercased())
      default: name = nil
      }
      guard let name else { return nil }
      names.append(name)
    }
    return "\(base) (\(names.joined(separator: ", ")))"
  }

  enum SubtagKind { case script, region, variant, other }

  /// What a subtag after the language is, by its shape (BCP 47).
  static func subtagKind(_ part: String) -> SubtagKind {
    let units = Array(part.utf16)
    func letter(_ u: UInt16) -> Bool { (u | 0x20) >= 0x61 && (u | 0x20) <= 0x7A }
    func digit(_ u: UInt16) -> Bool { u >= 0x30 && u <= 0x39 }
    if units.count == 4 && units.allSatisfy(letter) { return .script }
    if (units.count == 2 && units.allSatisfy(letter)) || (units.count == 3 && units.allSatisfy(digit)) {
      return .region
    }
    let alnum = units.allSatisfy { letter($0) || digit($0) }
    if alnum && ((5...8).contains(units.count) || (units.count == 4 && digit(units[0]))) { return .variant }
    return .other
  }

  static func titlecased(_ part: String) -> String {
    String(part.prefix(1)).uppercased() + part.dropFirst().lowercased()
  }

  /// A tag CLDR has no name of its own for, as ICU names it in English:
  /// "Language (Script, Region, VARIANT)", each part by its name or, when
  /// ICU has none, its code ("English (XX)", "xx (United States)"). Nil for
  /// one DisplayNames refuses (a subtag out of place or of no known shape)
  /// and for a bare code it can't name. A variant ICU knows by name
  /// ("1996") is written as its code here.
  static func englishTagName(_ code: String) -> String? {
    let parts = PostingQueue.split(code, 0x2D)
    let lang = parts[0].jsLowercased()
    let langUnits = Array(lang.utf16)
    guard (2...3).contains(langUnits.count), langUnits.allSatisfy({ $0 >= 0x61 && $0 <= 0x7A }), parts.count >= 2 else {
      return nil
    }
    var names: [String] = []
    var i = 1
    if i < parts.count, subtagKind(parts[i]) == .script {
      let script = titlecased(parts[i])
      names.append(ComposerLanguageNames.scripts[script] ?? script)
      i += 1
    }
    if i < parts.count, subtagKind(parts[i]) == .region {
      let region = parts[i].jsUppercased()
      names.append(ComposerLanguageNames.regions[region] ?? region)
      i += 1
    }
    while i < parts.count {
      guard subtagKind(parts[i]) == .variant else { return nil }
      names.append(parts[i].jsUppercased())
      i += 1
    }
    let base = ComposerLanguageNames.english[lang] ?? lang
    return "\(base) (\(names.joined(separator: ", ")))"
  }

  /// Languages matching `query` (by name or code), the chosen ones left
  /// out, sorted by name, at most `limit`. With no query, the reader's own
  /// languages (`preferred`) come first.
  public static func searchLanguages(
    _ query: JSONValue?, chosen: [String] = [], locale: String = "en", preferred: [String] = [], limit: Int = 8
  ) -> [LanguageChoice] {
    let q = PostingQueue.text(query).jsTrimmed().jsLowercased()
    let taken = Set(chosen.map(JSKey.init))
    // A code that can't be named is offered only when it's typed exactly.
    let all = languageCodes.filter { !taken.contains(JSKey($0)) }
      .map { LanguageChoice(code: $0, name: languageName($0, locale: locale)) }
      .filter { $0.name != $0.code || $0.code.jsEquals(q) }
    if q.isEmpty {
      let pref = ComposerJS.unique(preferred.map { firstSubtag($0).jsLowercased() })
        .filter { languageCodes.jsIncludes($0) && !taken.contains(JSKey($0)) }
      let first = pref.map { LanguageChoice(code: $0, name: languageName($0, locale: locale)) }
      let rest = TimerJS.v8Sorted(all.filter { !pref.jsIncludes($0.code) }) { Double(compareNames($0.name, $1.name)) }
      return ComposerJS.slice(first + rest, 0, limit)
    }
    let matches = all.filter { $0.code.jsEquals(q) || $0.name.jsLowercased().jsIndexOf(q) != -1 }
    let sorted = TimerJS.v8Sorted(matches) { a, b in
      let ap = a.code.jsEquals(q) || PostingJS.hasPrefix(a.name.jsLowercased(), q) ? 0 : 1
      let bp = b.code.jsEquals(q) || PostingJS.hasPrefix(b.name.jsLowercased(), q) ? 0 : 1
      return ap != bp ? Double(ap - bp) : Double(compareNames(a.name, b.name))
    }
    return ComposerJS.slice(sorted, 0, limit)
  }

  /// `String(tag).split(/[-_]/)[0]`.
  static func firstSubtag(_ tag: String) -> String {
    String(decoding: Array(tag.utf16).prefix { $0 != 0x2D && $0 != 0x5F }, as: UTF16.self)
  }

  /// The self-labels, as the composer offers them.
  public static let adultLabelOptions = [
    SelfLabelOption(value: "sexual", label: "Suggestive", hint: "Revealing, but not explicit"),
    SelfLabelOption(value: "nudity", label: "Nudity", hint: "Artistic or non-sexual nudity"),
    SelfLabelOption(value: "porn", label: "Adult", hint: "Sexually explicit"),
  ]
  public static let graphicLabel = SelfLabelOption(
    value: "graphic-media", label: "Graphic media", hint: "Violence, injury or gore")

  /// "English, Spanish" for the composer's options row.
  public static func langsSummary(_ langs: [JSONValue]?, locale: String = "en") -> String {
    let list = (langs ?? []).map { languageName($0, locale: locale) }
    return list.isEmpty ? "No language set" : list.joined(separator: ", ")
  }

  public static func langsSummary(_ langs: [String], locale: String = "en") -> String {
    langsSummary(langs.map(JSONValue.string), locale: locale)
  }

  /// "Nudity, Graphic media", or ''.
  public static func labelsSummary(_ labels: [JSONValue]?) -> String {
    let all = adultLabelOptions + [graphicLabel]
    return (labels ?? []).compactMap { label in all.first { ComposerJS.strictEquals(.string($0.value), label) }?.label }
      .filter { !$0.isEmpty }
      .joined(separator: ", ")
  }

  public static func labelsSummary(_ labels: [String]) -> String { labelsSummary(labels.map(JSONValue.string)) }
}
