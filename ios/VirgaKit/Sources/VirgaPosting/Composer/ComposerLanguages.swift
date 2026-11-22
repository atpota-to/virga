// Ports src/posting/composer/languages.js
//
// The languages a post can say it's written in (ISO 639-1, which is what
// Bluesky's language filters read), named in the reader's language, and
// the self-labels the composer offers.
//
// The web names languages with Intl.DisplayNames. Its English names for
// the 184 codes are a table here (ComposerLanguageNames, from Node 22's
// ICU, held to it by composer.composer's fixture), with the regional names
// CLDR has for the tags people post in (pt-BR "Brazilian Portuguese").
// Another tag with a region or script is named "Language (Region)" from
// Foundation's region names, which can differ from ICU's; a locale that
// isn't English names through Foundation. Names sort with localeCompare
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
    }
    // A tag with a region or script: "Language (Region)".
    let parts = PostingQueue.split(code, 0x2D)
    guard parts.count >= 2, let base = displayName(parts[0], locale: locale) else {
      return english ? nil : Locale(identifier: locale).localizedString(forLanguageCode: code)
    }
    let speaker = Locale(identifier: english ? "en_US" : locale)
    let rest = parts[1]
    let region =
      rest.utf16.count == 4
      ? speaker.localizedString(forScriptCode: rest) : speaker.localizedString(forRegionCode: rest.jsUppercased())
    return region.map { "\(base) (\($0))" }
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
      return Array((first + rest).prefix(Swift.max(0, limit)))
    }
    let matches = all.filter { $0.code.jsEquals(q) || $0.name.jsLowercased().jsIndexOf(q) != -1 }
    let sorted = TimerJS.v8Sorted(matches) { a, b in
      let ap = a.code.jsEquals(q) || PostingJS.hasPrefix(a.name.jsLowercased(), q) ? 0 : 1
      let bp = b.code.jsEquals(q) || PostingJS.hasPrefix(b.name.jsLowercased(), q) ? 0 : 1
      return ap != bp ? Double(ap - bp) : Double(compareNames(a.name, b.name))
    }
    return Array(sorted.prefix(Swift.max(0, limit)))
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

/// Intl.DisplayNames' English names (Node 22's ICU).
enum ComposerLanguageNames {
  static let english: [String: String] = [
    "aa": "Afar",
    "ab": "Abkhazian",
    "ae": "Avestan",
    "af": "Afrikaans",
    "ak": "Akan",
    "am": "Amharic",
    "an": "Aragonese",
    "ar": "Arabic",
    "as": "Assamese",
    "av": "Avaric",
    "ay": "Aymara",
    "az": "Azerbaijani",
    "ba": "Bashkir",
    "be": "Belarusian",
    "bg": "Bulgarian",
    "bi": "Bislama",
    "bm": "Bambara",
    "bn": "Bangla",
    "bo": "Tibetan",
    "br": "Breton",
    "bs": "Bosnian",
    "ca": "Catalan",
    "ce": "Chechen",
    "ch": "Chamorro",
    "co": "Corsican",
    "cr": "Cree",
    "cs": "Czech",
    "cu": "Church Slavic",
    "cv": "Chuvash",
    "cy": "Welsh",
    "da": "Danish",
    "de": "German",
    "dv": "Divehi",
    "dz": "Dzongkha",
    "ee": "Ewe",
    "el": "Greek",
    "en": "English",
    "eo": "Esperanto",
    "es": "Spanish",
    "et": "Estonian",
    "eu": "Basque",
    "fa": "Persian",
    "ff": "Fula",
    "fi": "Finnish",
    "fj": "Fijian",
    "fo": "Faroese",
    "fr": "French",
    "fy": "Western Frisian",
    "ga": "Irish",
    "gd": "Scottish Gaelic",
    "gl": "Galician",
    "gn": "Guarani",
    "gu": "Gujarati",
    "gv": "Manx",
    "ha": "Hausa",
    "he": "Hebrew",
    "hi": "Hindi",
    "ho": "Hiri Motu",
    "hr": "Croatian",
    "ht": "Haitian Creole",
    "hu": "Hungarian",
    "hy": "Armenian",
    "hz": "Herero",
    "ia": "Interlingua",
    "id": "Indonesian",
    "ie": "Interlingue",
    "ig": "Igbo",
    "ii": "Sichuan Yi",
    "ik": "Inupiaq",
    "io": "Ido",
    "is": "Icelandic",
    "it": "Italian",
    "iu": "Inuktitut",
    "ja": "Japanese",
    "jv": "Javanese",
    "ka": "Georgian",
    "kg": "Kongo",
    "ki": "Kikuyu",
    "kj": "Kuanyama",
    "kk": "Kazakh",
    "kl": "Kalaallisut",
    "km": "Khmer",
    "kn": "Kannada",
    "ko": "Korean",
    "kr": "Kanuri",
    "ks": "Kashmiri",
    "ku": "Kurdish",
    "kv": "Komi",
    "kw": "Cornish",
    "ky": "Kyrgyz",
    "la": "Latin",
    "lb": "Luxembourgish",
    "lg": "Ganda",
    "li": "Limburgish",
    "ln": "Lingala",
    "lo": "Lao",
    "lt": "Lithuanian",
    "lu": "Luba-Katanga",
    "lv": "Latvian",
    "mg": "Malagasy",
    "mh": "Marshallese",
    "mi": "Māori",
    "mk": "Macedonian",
    "ml": "Malayalam",
    "mn": "Mongolian",
    "mr": "Marathi",
    "ms": "Malay",
    "mt": "Maltese",
    "my": "Burmese",
    "na": "Nauru",
    "nb": "Norwegian Bokmål",
    "nd": "North Ndebele",
    "ne": "Nepali",
    "ng": "Ndonga",
    "nl": "Dutch",
    "nn": "Norwegian Nynorsk",
    "no": "Norwegian",
    "nr": "South Ndebele",
    "nv": "Navajo",
    "ny": "Nyanja",
    "oc": "Occitan",
    "oj": "Ojibwa",
    "om": "Oromo",
    "or": "Odia",
    "os": "Ossetic",
    "pa": "Punjabi",
    "pi": "Pali",
    "pl": "Polish",
    "ps": "Pashto",
    "pt": "Portuguese",
    "qu": "Quechua",
    "rm": "Romansh",
    "rn": "Rundi",
    "ro": "Romanian",
    "ru": "Russian",
    "rw": "Kinyarwanda",
    "sa": "Sanskrit",
    "sc": "Sardinian",
    "sd": "Sindhi",
    "se": "Northern Sami",
    "sg": "Sango",
    "si": "Sinhala",
    "sk": "Slovak",
    "sl": "Slovenian",
    "sm": "Samoan",
    "sn": "Shona",
    "so": "Somali",
    "sq": "Albanian",
    "sr": "Serbian",
    "ss": "Swati",
    "st": "Southern Sotho",
    "su": "Sundanese",
    "sv": "Swedish",
    "sw": "Swahili",
    "ta": "Tamil",
    "te": "Telugu",
    "tg": "Tajik",
    "th": "Thai",
    "ti": "Tigrinya",
    "tk": "Turkmen",
    "tl": "Filipino",
    "tn": "Tswana",
    "to": "Tongan",
    "tr": "Turkish",
    "ts": "Tsonga",
    "tt": "Tatar",
    "tw": "Akan",
    "ty": "Tahitian",
    "ug": "Uyghur",
    "uk": "Ukrainian",
    "ur": "Urdu",
    "uz": "Uzbek",
    "ve": "Venda",
    "vi": "Vietnamese",
    "vo": "Volapük",
    "wa": "Walloon",
    "wo": "Wolof",
    "xh": "Xhosa",
    "yi": "Yiddish",
    "yo": "Yoruba",
    "za": "Zhuang",
    "zh": "Chinese",
    "zu": "Zulu",
  ]

  /// CLDR's own names for tags with a region or script.
  static let regional: [String: String] = [
    "en-AU": "Australian English",
    "en-CA": "Canadian English",
    "en-GB": "British English",
    "en-US": "American English",
    "es-ES": "European Spanish",
    "es-MX": "Mexican Spanish",
    "es-419": "Latin American Spanish",
    "fr-CA": "Canadian French",
    "fr-CH": "Swiss French",
    "de-AT": "Austrian German",
    "de-CH": "Swiss High German",
    "nl-BE": "Flemish",
    "pt-BR": "Brazilian Portuguese",
    "pt-PT": "European Portuguese",
    "zh-Hans": "Simplified Chinese",
    "zh-Hant": "Traditional Chinese",
    "ro-MD": "Moldavian",
    "sw-CD": "Congo Swahili",
    "ar-001": "Modern Standard Arabic",
    "fa-AF": "Dari",
  ]
}
