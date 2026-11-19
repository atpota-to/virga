// Ports src/lib/locale.js
//
// How Intl writes numbers and dates in English in each region, as data, and
// the two engines that write with it: `formatNumber` (what
// `n.toLocaleString(tag, options)` gives) and `formatDate` (what
// `date.toLocaleDateString(tag, options)` and friends give).
//
// The web app formats with the browser's Intl. Foundation's formatters
// read the device's own ICU, whose CLDR differs from version to version (an
// iPhone on one iOS writes "14. Nov 2026" in en-DE where Chrome writes "14
// Nov 2026", and puts U+202F before "PM" where Chrome puts a space), so
// the port carries the web runtime's data instead: LocaleData+Table.swift,
// written by ios/parity/locale-data.mjs from Node's Intl, and held to it by
// the core.localeData fixture. Every locale Virga activates is English in
// some region (src/lib/locale.js), so the table is `en-<region>` for every
// region; a tag in another language formats as English in its region.

import Foundation

public enum LocaleData {
  // MARK: - The table

  public struct NumberSymbols: Codable, Hashable, Sendable {
    public var decimal: String
    public var group: String
    public var minus: String
    /// The size of every group but the last: 3, or 2 for the Indian
    /// system (12,34,567).
    public var secondaryGrouping: Int
    /// How many digits the leading group needs before a number is grouped
    /// at all: 1 (1,234), or 2 (1234 but 12,345).
    public var minimumGroupingDigits: Int
  }

  public struct Format: Codable, Hashable, Sendable {
    public var number: NumberSymbols
    /// ICU patterns by option-set key (`DateFormatOptions.key`).
    public var patterns: [String: String]
  }

  public struct Names: Codable, Hashable, Sendable {
    public var monthsShort: [String]
    public var monthsLong: [String]
    public var monthsNarrow: [String]
    /// Sunday first, as `getDay()` counts.
    public var weekdaysShort: [String]
    public var weekdaysLong: [String]
    public var weekdaysNarrow: [String]
    public var am: String
    public var pm: String
  }

  public struct Region: Codable, Hashable, Sendable {
    public var format: Int
    public var names: Int
    /// The first day of the week, as a `getDay()` index.
    public var firstDay: Int
    /// 'h12', 'h23', 'h11' or 'h24', as resolvedOptions() says for `{ hour: 'numeric' }`.
    public var hourCycle: String
  }

  public struct Languages: Codable, Hashable, Sendable {
    public var supported: [String]
    public var aliases: [String: String]
    public var likelyRegions: [String: String]
    public var scriptRegions: [String: String]
    public var regionAliases: [String: String]
  }

  public struct Table: Codable, Hashable, Sendable {
    public var formats: [Format]
    public var names: [Names]
    public var regions: [String: Region]
    public var languages: Languages
  }

  /// The table, decoded once from LocaleData+Table.swift.
  public static let table: Table = {
    do {
      return try JSONDecoder().decode(Table.self, from: Data(tableJSON.utf8))
    } catch {
      fatalError("LocaleData+Table.swift is not a valid table: \(error)")
    }
  }()

  static let supportedLanguages = Set(table.languages.supported)

  // MARK: - A locale's data

  /// Everything one locale formats with.
  public struct Profile: Hashable, Sendable {
    public var region: String?
    public var number: NumberSymbols
    public var patterns: [String: String]
    public var names: Names
    public var firstDay: Int
    public var hourCycle: String
  }

  /// The profile for a locale tag: English in the tag's region (or its
  /// language's likeliest), and en-US's where neither is known. A tag with
  /// a script (en-Latn-GB) is plain `en`, as Intl resolves it: ICU has no
  /// English locale with a script, so lookup falls back past the region.
  public static func profile(for tag: String) -> Profile {
    guard let parsed = LanguageTag(tag), parsed.script == nil else { return profile(region: nil) }
    return profile(region: parsed.maximizedRegion)
  }

  /// The profile of `en-<region>`.
  public static func profile(region: String?) -> Profile {
    let entry = region.flatMap { table.regions[$0] } ?? table.regions["US"]!
    let format = table.formats[entry.format]
    return Profile(
      region: region,
      number: format.number,
      patterns: format.patterns,
      names: table.names[entry.names],
      firstDay: entry.firstDay,
      hourCycle: entry.hourCycle
    )
  }

  // MARK: - Numbers

  /// `value.toLocaleString(locale, { minimumFractionDigits, maximumFractionDigits })`
  /// with these symbols: the shortest decimal that reads back as `value`,
  /// rounded half away from zero (Intl's halfExpand), grouped, and signed
  /// whenever the value is negative (-0 is "-0").
  public static func formatNumber(
    _ value: Double,
    symbols: NumberSymbols,
    minimumFractionDigits: Int = 0,
    maximumFractionDigits: Int = 3
  ) -> String {
    if value.isNaN { return "NaN" }
    let negative = value.sign == .minus
    let sign = negative ? symbols.minus : ""
    if value.isInfinite { return sign + "∞" }
    var (digits, point) = decimalDigits(abs(value))
    // Round to the kept fraction digits, half away from zero.
    let keep = point + maximumFractionDigits
    if keep < digits.count {
      let roundUp = keep >= 0 && digits[keep] >= 5
      digits = keep > 0 ? Array(digits[0..<keep]) : []
      if roundUp {
        var i = digits.count - 1
        while i >= 0 && digits[i] == 9 {
          digits[i] = 0
          i -= 1
        }
        if i >= 0 {
          digits[i] += 1
        } else {
          digits.insert(1, at: 0)
          point += 1
        }
      } else if keep < 0 {
        digits = []
        point = 0
      }
    }
    // Split into whole and fraction digits around the point.
    var whole: [UInt8] = []
    var fraction: [UInt8] = []
    for (i, d) in digits.enumerated() {
      if i < point { whole.append(d) } else { fraction.append(d) }
    }
    if point > digits.count { whole.append(contentsOf: repeatElement(0, count: point - digits.count)) }
    if point < 0 { fraction.insert(contentsOf: repeatElement(0, count: -point), at: 0) }
    while let first = whole.first, first == 0, whole.count > 1 { whole.removeFirst() }
    if whole.isEmpty { whole = [0] }
    while fraction.count > minimumFractionDigits, fraction.last == 0 { fraction.removeLast() }
    while fraction.count < minimumFractionDigits { fraction.append(0) }

    let wholeText = group(whole.map { String($0) }.joined(), symbols)
    let fractionText = fraction.map { String($0) }.joined()
    return sign + wholeText + (fractionText.isEmpty ? "" : symbols.decimal + fractionText)
  }

  /// The shortest round-tripping decimal digits of a finite, non-negative
  /// value, and where the point falls (value = 0.d₁d₂… × 10^point).
  static func decimalDigits(_ value: Double) -> ([UInt8], Int) {
    if value == 0 { return ([], 1) }
    let text = "\(value)"
    var mantissa = Substring(text)
    var exponent = 0
    if let e = text.firstIndex(where: { $0 == "e" || $0 == "E" }) {
      mantissa = text[..<e]
      exponent = Int(text[text.index(after: e)...]) ?? 0
    }
    let pieces = mantissa.split(separator: ".", omittingEmptySubsequences: false)
    let intPart = pieces[0]
    let fracPart = pieces.count > 1 ? pieces[1] : ""
    var digits = (intPart + fracPart).utf8.map { $0 - 0x30 }
    var point = intPart.count + exponent
    while let first = digits.first, first == 0 {
      digits.removeFirst()
      point -= 1
    }
    while let last = digits.last, last == 0 { digits.removeLast() }
    return (digits, point)
  }

  static func group(_ whole: String, _ symbols: NumberSymbols) -> String {
    let chars = Array(whole)
    guard chars.count >= 3 + symbols.minimumGroupingDigits else { return whole }
    var groups: [String] = [String(chars.suffix(3))]
    var end = chars.count - 3
    while end > 0 {
      let start = max(0, end - symbols.secondaryGrouping)
      groups.insert(String(chars[start..<end]), at: 0)
      end = start
    }
    return groups.joined(separator: symbols.group)
  }

  // MARK: - Dates

  /// Lays out the ICU `pattern` for `time` (epoch ms) in `timeZone`, with
  /// these names. The fields the web's patterns use: y yy M MM MMM MMMM
  /// MMMMM d dd EEE EEEE EEEEE h hh H HH K KK k kk m mm s ss a, with
  /// literals in single quotes.
  public static func render(pattern: String, time: Double, timeZone: TimeZone, names: Names) -> String {
    guard let f = JSDate.fields(time, timeZone: timeZone) else { return "Invalid Date" }
    let h12 = f.hours % 12 == 0 ? 12 : f.hours % 12
    let h11 = f.hours % 12
    let h24 = f.hours == 0 ? 24 : f.hours
    func pad(_ n: Int) -> String { n < 10 && n >= 0 ? "0\(n)" : String(n) }
    func value(_ token: String) -> String {
      switch token {
      case "y": return String(f.year)
      case "yy": return pad(((f.year % 100) + 100) % 100)
      case "M": return String(f.month + 1)
      case "MM": return pad(f.month + 1)
      case "MMM": return names.monthsShort[f.month]
      case "MMMM": return names.monthsLong[f.month]
      case "MMMMM": return names.monthsNarrow[f.month]
      case "d": return String(f.date)
      case "dd": return pad(f.date)
      case "EEE": return names.weekdaysShort[f.day]
      case "EEEE": return names.weekdaysLong[f.day]
      case "EEEEE": return names.weekdaysNarrow[f.day]
      case "H": return String(f.hours)
      case "HH": return pad(f.hours)
      case "h": return String(h12)
      case "hh": return pad(h12)
      case "K": return String(h11)
      case "KK": return pad(h11)
      case "k": return String(h24)
      case "kk": return pad(h24)
      case "m": return String(f.minutes)
      case "mm": return pad(f.minutes)
      case "s": return String(f.seconds)
      case "ss": return pad(f.seconds)
      case "a": return f.hours < 12 ? names.am : names.pm
      default: return token
      }
    }
    let chars = Array(pattern)
    var out = ""
    var i = 0
    while i < chars.count {
      let ch = chars[i]
      if ch == "'" {
        if i + 1 < chars.count && chars[i + 1] == "'" {
          out.append("'")
          i += 2
          continue
        }
        var j = i + 1
        while j < chars.count && chars[j] != "'" { j += 1 }
        out += String(chars[(i + 1)..<min(j, chars.count)])
        i = j + 1
      } else if ch.isASCII && ch.isLetter {
        var j = i
        while j < chars.count && chars[j] == ch { j += 1 }
        out += value(String(chars[i..<j]))
        i = j
      } else {
        out.append(ch)
        i += 1
      }
    }
    return out
  }
}

/// The options of `Intl.DateTimeFormat` the web app formats with, by their
/// JavaScript names and values (`month: "short"`, `hour12: false`).
public struct DateFormatOptions: Hashable, Sendable {
  public var weekday: String?
  public var year: String?
  public var month: String?
  public var day: String?
  public var hour: String?
  public var minute: String?
  public var second: String?
  public var hour12: Bool?
  public var dateStyle: String?
  public var timeStyle: String?

  public init(
    weekday: String? = nil, year: String? = nil, month: String? = nil, day: String? = nil,
    hour: String? = nil, minute: String? = nil, second: String? = nil, hour12: Bool? = nil,
    dateStyle: String? = nil, timeStyle: String? = nil
  ) {
    self.weekday = weekday
    self.year = year
    self.month = month
    self.day = day
    self.hour = hour
    self.minute = minute
    self.second = second
    self.hour12 = hour12
    self.dateStyle = dateStyle
    self.timeStyle = timeStyle
  }

  /// The options as JavaScript passes them, from a JSON object (the parity
  /// fixtures' inputs). Unknown members are ignored.
  public init(json: JSONValue?) {
    self.init(
      weekday: json?["weekday"]?.stringValue, year: json?["year"]?.stringValue,
      month: json?["month"]?.stringValue, day: json?["day"]?.stringValue,
      hour: json?["hour"]?.stringValue, minute: json?["minute"]?.stringValue,
      second: json?["second"]?.stringValue, hour12: json?["hour12"]?.boolValue,
      dateStyle: json?["dateStyle"]?.stringValue, timeStyle: json?["timeStyle"]?.stringValue
    )
  }

  /// The table's key: the options sorted by name, `name=value` joined by
  /// commas (ios/parity/cases/_localeData.js optionKey).
  public var key: String {
    var pairs: [(String, String)] = []
    if let day { pairs.append(("day", day)) }
    if let dateStyle { pairs.append(("dateStyle", dateStyle)) }
    if let hour { pairs.append(("hour", hour)) }
    if let hour12 { pairs.append(("hour12", hour12 ? "true" : "false")) }
    if let minute { pairs.append(("minute", minute)) }
    if let month { pairs.append(("month", month)) }
    if let second { pairs.append(("second", second)) }
    if let timeStyle { pairs.append(("timeStyle", timeStyle)) }
    if let weekday { pairs.append(("weekday", weekday)) }
    if let year { pairs.append(("year", year)) }
    return pairs.sorted { $0.0 < $1.0 }.map { "\($0.0)=\($0.1)" }.joined(separator: ",")
  }

  var hasDateField: Bool { weekday != nil || year != nil || month != nil || day != nil }
  var hasTimeField: Bool { hour != nil || minute != nil || second != nil }
  var hasStyle: Bool { dateStyle != nil || timeStyle != nil }

  /// ToDateTimeOptions: what `toLocaleDateString` ("date", "date"),
  /// `toLocaleTimeString` ("time", "time"), `toLocaleString` ("any", "all")
  /// and `Intl.DateTimeFormat` ("any", "date") add when no field is given.
  public enum Required: Sendable { case date, time, any }
  public enum Defaults: Sendable { case date, time, all }

  public func withDefaults(required: Required, defaults: Defaults) -> DateFormatOptions {
    var needDefaults = true
    if required == .date || required == .any, hasDateField { needDefaults = false }
    if required == .time || required == .any, hasTimeField { needDefaults = false }
    if hasStyle { needDefaults = false }
    guard needDefaults else { return self }
    var out = self
    if defaults == .date || defaults == .all {
      out.year = "numeric"
      out.month = "numeric"
      out.day = "numeric"
    }
    if defaults == .time || defaults == .all {
      out.hour = "numeric"
      out.minute = "numeric"
      out.second = "numeric"
    }
    return out
  }
}

extension LocaleData {
  /// `new Intl.DateTimeFormat(locale, options).format(time)` for options
  /// that already name their fields: the pattern from the table, laid out in
  /// `timeZone`. An option set the table doesn't have falls back to
  /// Foundation's pattern for the same fields, which matches the web app's
  /// only as far as the device's CLDR does; add the set to
  /// `DATE_OPTION_SETS` in ios/parity/cases/_localeData.js to make it exact.
  public static func formatDate(_ time: Double, options: DateFormatOptions, locale: String, timeZone: TimeZone) -> String {
    guard time.isFinite, abs(time) <= JSDate.maxTime else { return "Invalid Date" }
    let profile = profile(for: locale)
    let pattern = profile.patterns[options.key] ?? fallbackPattern(options, profile: profile)
    return render(pattern: pattern, time: time, timeZone: timeZone, names: profile.names)
  }

  static func fallbackPattern(_ options: DateFormatOptions, profile: Profile) -> String {
    var template = ""
    switch options.weekday {
    case "long": template += "EEEE"
    case "short": template += "EEE"
    case "narrow": template += "EEEEE"
    default: break
    }
    switch options.year {
    case "2-digit": template += "yy"
    case nil: break
    default: template += "y"
    }
    switch options.month {
    case "long": template += "MMMM"
    case "short": template += "MMM"
    case "narrow": template += "MMMMM"
    case "2-digit": template += "MM"
    case nil: break
    default: template += "M"
    }
    switch options.day {
    case "2-digit": template += "dd"
    case nil: break
    default: template += "d"
    }
    if options.hour != nil {
      let twelve = options.hour12 ?? (profile.hourCycle == "h12" || profile.hourCycle == "h11")
      template += twelve ? (options.hour == "2-digit" ? "hh" : "h") : (options.hour == "2-digit" ? "HH" : "H")
    }
    if options.minute != nil { template += "mm" }
    if options.second != nil { template += "ss" }
    if options.dateStyle != nil { template += options.dateStyle == "long" ? "yMMMMd" : "yMMMd" }
    if options.timeStyle != nil { template += profile.hourCycle == "h12" ? "hmm" : "Hmm" }
    let locale = Locale(identifier: "en_\(profile.region ?? "US")")
    let pattern = DateFormatter.dateFormat(fromTemplate: template, options: 0, locale: locale) ?? template
    // The renderer's fields: stand-alone months and weekdays as their
    // format forms, and a plain space where ICU puts U+202F (as V8 does).
    var out = ""
    var quoted = false
    for ch in pattern {
      if ch == "'" { quoted.toggle() }
      switch (quoted, ch) {
      case (false, "L"): out.append("M")
      case (false, "c"), (false, "e"): out.append("E")
      case (_, "\u{202F}"): out.append(" ")
      default: out.append(ch)
      }
    }
    return out
  }
}
