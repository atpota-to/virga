// JavaScript's Date, for ports that must compute what the web app computes:
// `Date.parse` (V8's parser: the ISO format, and the legacy forms Chrome and
// Node accept), `Date.UTC` and `new Date(y, m, d, ...)` with their overflow
// rules, a moment's local fields (`getFullYear()`, `getDay()`, ...) in an
// explicit zone, and `toISOString()`.
//
// Times are epoch milliseconds in a Double, as in JavaScript; an invalid
// date is NaN. Local time is always an explicit `TimeZone` (PORTING.md:
// logic never reads the device's zone); the web's "local" is the browser's
// zone, which on iOS is `AppLocale.activeTimeZone()`.
//
// ios/parity/cases/core.jsdate.js holds this file to Node's own Date in
// several zones, DST gaps and overlaps included.

import Foundation

public enum JSDate {
  public static let msPerDay: Double = 86_400_000
  /// The largest time a Date holds, either side of the epoch.
  public static let maxTime: Double = 8.64e15

  // MARK: - The spec's abstract operations

  /// TimeClip: NaN outside ±8.64e15, otherwise the time truncated (and never -0).
  public static func timeClip(_ time: Double) -> Double {
    guard time.isFinite, abs(time) <= maxTime else { return .nan }
    return time.rounded(.towardZero) + 0
  }

  /// MakeTime(hour, min, sec, ms), each truncated toward zero.
  public static func makeTime(_ hour: Double, _ minute: Double, _ second: Double, _ ms: Double) -> Double {
    guard hour.isFinite, minute.isFinite, second.isFinite, ms.isFinite else { return .nan }
    return trunc(hour) * 3_600_000 + trunc(minute) * 60_000 + trunc(second) * 1000 + trunc(ms)
  }

  /// MakeDay(year, month, date): the day number of that date, with the
  /// month and date allowed to overflow (month 12 is January next year,
  /// day 0 the last of the month before). `month` is 0-based.
  public static func makeDay(_ year: Double, _ month: Double, _ date: Double) -> Double {
    guard year.isFinite, month.isFinite, date.isFinite else { return .nan }
    let y = trunc(year)
    let m = trunc(month)
    let dt = trunc(date)
    let ym = y + (m / 12).rounded(.down)
    // Well past where TimeClip gives up either way; keeps Int64 safe.
    guard abs(ym) < 1_000_000 else { return .nan }
    let mn = m - (m / 12).rounded(.down) * 12
    let days = daysFromCivil(Int64(ym), Int64(mn) + 1, 1)
    return Double(days) + dt - 1
  }

  /// MakeDate(day, time).
  public static func makeDate(_ day: Double, _ time: Double) -> Double {
    guard day.isFinite, time.isFinite else { return .nan }
    return day * msPerDay + time
  }

  /// Days since the epoch of a proleptic Gregorian date (month 1...12).
  static func daysFromCivil(_ year: Int64, _ month: Int64, _ day: Int64) -> Int64 {
    let y = month <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let mp = (month + 9) % 12
    let doy = (153 * mp + 2) / 5 + day - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146_097 + doe - 719_468
  }

  /// The proleptic Gregorian date of a day number: (year, month 1...12, day).
  static func civilFromDays(_ days: Int64) -> (year: Int64, month: Int64, day: Int64) {
    let z = days + 719_468
    let era = (z >= 0 ? z : z - 146_096) / 146_097
    let doe = z - era * 146_097
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
    let y = yoe + era * 400
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    let mp = (5 * doy + 2) / 153
    let d = doy - (153 * mp + 2) / 5 + 1
    let m = mp < 10 ? mp + 3 : mp - 9
    return (m <= 2 ? y + 1 : y, m, d)
  }

  /// A year as `Date.UTC` and `new Date(y, ...)` read it: 0 to 99 is 1900 to 1999.
  static func fullYear(_ year: Double) -> Double {
    guard year.isFinite else { return year }
    let y = trunc(year)
    return (0...99).contains(y) ? 1900 + y : year
  }

  // MARK: - Constructors

  /// `Date.UTC(year, month, day, hours, minutes, seconds, ms)`: month is
  /// 0-based and every field may overflow.
  public static func utc(
    _ year: Double, _ month: Double = 0, _ day: Double = 1,
    _ hour: Double = 0, _ minute: Double = 0, _ second: Double = 0, _ ms: Double = 0
  ) -> Double {
    timeClip(makeDate(makeDay(fullYear(year), month, day), makeTime(hour, minute, second, ms)))
  }

  /// `new Date(year, month, day, hours, minutes, seconds, ms).getTime()` with
  /// local time in `timeZone`. A wall time that a clock change skips or
  /// repeats is read with the offset from before the change, as the spec
  /// says (2:30 on a spring-forward night is 3:30 after it).
  public static func local(
    _ year: Double, _ month: Double = 0, _ day: Double = 1,
    _ hour: Double = 0, _ minute: Double = 0, _ second: Double = 0, _ ms: Double = 0,
    timeZone: TimeZone
  ) -> Double {
    let wall = makeDate(makeDay(fullYear(year), month, day), makeTime(hour, minute, second, ms))
    guard wall.isFinite, abs(wall) <= maxTime + msPerDay else { return .nan }
    return timeClip(localToUTC(wall, timeZone: timeZone))
  }

  // MARK: - Local time

  /// The zone's offset from UTC at instant `time`, in milliseconds (east positive).
  public static func offsetMs(at time: Double, timeZone: TimeZone) -> Double {
    Double(timeZone.secondsFromGMT(for: Date(timeIntervalSince1970: time / 1000))) * 1000
  }

  /// `date.getTimezoneOffset()`: whole minutes west of UTC (V8 truncates
  /// an offset with seconds in it, such as a zone's local mean time before
  /// standard time: New York's -4:56:02 is 296).
  public static func timezoneOffset(_ time: Double, timeZone: TimeZone) -> Double {
    guard time.isFinite else { return .nan }
    return -(offsetMs(at: time, timeZone: timeZone) / 60_000).rounded(.towardZero) + 0
  }

  /// UTC(t) for a wall-clock time `wall` in `timeZone`: the offset in force
  /// before a transition wins where the wall time is skipped or repeated.
  public static func localToUTC(_ wall: Double, timeZone: TimeZone) -> Double {
    guard wall.isFinite else { return .nan }
    let before = offsetMs(at: wall - msPerDay, timeZone: timeZone)
    let after = offsetMs(at: wall + msPerDay, timeZone: timeZone)
    let early = wall - before
    if offsetMs(at: early, timeZone: timeZone) == before { return early }
    let late = wall - after
    if offsetMs(at: late, timeZone: timeZone) == after { return late }
    // Neither reading is a real moment: a skipped wall time, or two
    // transitions inside a day. Settle on the offset at a first guess.
    if before == after {
      let guess = wall - offsetMs(at: wall, timeZone: timeZone)
      return wall - offsetMs(at: guess, timeZone: timeZone)
    }
    return early
  }

  /// A moment's fields in a zone, as `getFullYear()`, `getMonth()` (0-based),
  /// `getDate()`, `getDay()` (0 is Sunday), `getHours()` and the rest read them.
  public struct Fields: Hashable, Sendable {
    public var year: Int
    public var month: Int
    public var date: Int
    public var day: Int
    public var hours: Int
    public var minutes: Int
    public var seconds: Int
    public var milliseconds: Int
  }

  /// The local fields of `new Date(time)` in `timeZone` (the time clipped
  /// as the constructor clips it), or nil for an invalid date.
  public static func fields(_ time: Double, timeZone: TimeZone) -> Fields? {
    let t = timeClip(time)
    guard t.isFinite else { return nil }
    return wallFields(t + offsetMs(at: t, timeZone: timeZone))
  }

  /// The UTC fields of `new Date(time)` (`getUTCFullYear()` and the rest).
  public static func utcFields(_ time: Double) -> Fields? {
    let t = timeClip(time)
    guard t.isFinite else { return nil }
    return wallFields(t)
  }

  /// The calendar fields of a wall-clock time in milliseconds.
  static func wallFields(_ time: Double) -> Fields? {
    guard time.isFinite else { return nil }
    let days = (time / msPerDay).rounded(.down)
    let inDay = Int64(time - days * msPerDay)
    let (y, m, d) = civilFromDays(Int64(days))
    let weekday = Int(((Int64(days) + 4) % 7 + 7) % 7)
    return Fields(
      year: Int(y), month: Int(m) - 1, date: Int(d), day: weekday,
      hours: Int(inDay / 3_600_000), minutes: Int(inDay / 60_000 % 60),
      seconds: Int(inDay / 1000 % 60), milliseconds: Int(inDay % 1000)
    )
  }

  /// `date.toISOString()`, or nil where JavaScript throws (an invalid date).
  public static func toISOString(_ time: Double) -> String? {
    guard time.isFinite, abs(time) <= maxTime, let f = utcFields(time) else { return nil }
    let year: String
    if f.year >= 0 && f.year <= 9999 {
      year = pad(f.year, 4)
    } else {
      year = (f.year < 0 ? "-" : "+") + pad(abs(f.year), 6)
    }
    return "\(year)-\(pad(f.month + 1, 2))-\(pad(f.date, 2))T\(pad(f.hours, 2)):\(pad(f.minutes, 2)):\(pad(f.seconds, 2)).\(pad(f.milliseconds, 3))Z"
  }

  static func pad(_ n: Int, _ width: Int) -> String {
    let s = String(n)
    return s.count >= width ? s : String(repeating: "0", count: width - s.count) + s
  }

  // MARK: - Date.parse

  /// `Date.parse(text)`: epoch milliseconds, or NaN. A port of V8's
  /// DateParser: the ES date-time format first (date-only forms are UTC,
  /// date-times without an offset local), then the legacy forms browsers
  /// accept ("Mar 15 2026", "3/15/2026 2:30 PM", "Sun, 15 Mar 2026 12:00:00
  /// GMT", what `toString()` writes), local unless they name a zone.
  public static func parse(_ text: String, timeZone: TimeZone) -> Double {
    var parser = DateParser(units: Array(text.utf16))
    guard let out = parser.parse() else { return .nan }
    let day = makeDay(Double(out.year), Double(out.month), Double(out.day))
    let time = makeTime(Double(out.hour), Double(out.minute), Double(out.second), Double(out.millisecond))
    var date = makeDate(day, time)
    if let offset = out.utcOffsetSeconds {
      date -= Double(offset) * 1000
      guard abs(date) <= maxTime else { return .nan }
    } else {
      // V8's kMaxTimeBeforeUTCInMs: ten days' grace either side.
      guard date.isFinite, abs(date) <= maxTime + 864_000_000 else { return .nan }
      date = localToUTC(date, timeZone: timeZone)
    }
    return timeClip(date)
  }

  /// The web's `toMs` helpers (`typeof date === 'number' ? date :
  /// Date.parse(date)`): a number is already a time; anything else is
  /// `Date.parse(String(value))`, so a string is parsed, an array is parsed
  /// as its joined text (`['2026-03-15']` is that day), and null, a
  /// boolean, an object or nothing at all is NaN.
  public static func toMs(_ value: JSONValue?, timeZone: TimeZone) -> Double {
    switch value {
    case .number(let n): return n
    case .string(let s): return parse(s, timeZone: timeZone)
    case .array: return parse(value!.jsString, timeZone: timeZone)
    default: return .nan
    }
  }
}

// MARK: - V8's DateParser

/// A port of V8's src/date/dateparser (DateStringTokenizer, DayComposer,
/// TimeComposer, TimeZoneComposer and ParseES5DateTime), over UTF-16 code
/// units as V8 reads a two-byte string.
private struct DateParser {
  struct Output {
    var year = 0, month = 0, day = 0
    var hour = 0, minute = 0, second = 0, millisecond = 0
    var utcOffsetSeconds: Int?
  }

  static let none = Int.min
  static let maxSignificantDigits = 9

  enum KeywordType { case invalid, monthName, timeZoneName, timeSeparator, amPm }

  struct Token {
    enum Tag { case invalid, unknown, number, symbol, whiteSpace, keyword, endOfInput }
    var tag: Tag
    var length = 0
    var value = 0
    var keywordType: KeywordType = .invalid

    static let invalid = Token(tag: .invalid)
    static let unknown = Token(tag: .unknown)
    static let endOfInput = Token(tag: .endOfInput)

    var isInvalid: Bool { tag == .invalid }
    var isUnknown: Bool { tag == .unknown }
    var isNumber: Bool { tag == .number }
    var isSymbol: Bool { tag == .symbol }
    var isWhiteSpace: Bool { tag == .whiteSpace }
    var isEndOfInput: Bool { tag == .endOfInput }
    var isKeyword: Bool { tag == .keyword }
    func isFixedLengthNumber(_ n: Int) -> Bool { isNumber && length == n }
    func isSymbol(_ c: UInt16) -> Bool { isSymbol && value == Int(c) }
    func isKeywordType(_ t: KeywordType) -> Bool { isKeyword && keywordType == t }
    var isKeywordZ: Bool { isKeyword && keywordType == .timeZoneName && length == 1 && value == 0 }
    var isAsciiSign: Bool { isSymbol && (value == 0x2D || value == 0x2B) }
    /// '+' is 1 and '-' is -1, as 44 - c.
    var asciiSign: Int { 44 - value }
  }

  // The input reader.
  let units: [UInt16]
  var position = 0
  var ch: UInt16 { position < units.count ? units[position] : 0 }
  var atEnd: Bool { position >= units.count }

  init(units: [UInt16]) {
    self.units = units
  }

  mutating func next() { if position < units.count { position += 1 } }

  var isAsciiDigit: Bool { ch >= 0x30 && ch <= 0x39 }
  var isAsciiAlphaOrAbove: Bool { ch >= 0x41 }
  var isWhiteSpaceChar: Bool {
    guard let scalar = Unicode.Scalar(UInt32(ch)) else { return false }
    return JSWhitespace.contains(scalar)
  }

  mutating func skip(_ c: UInt16) -> Bool {
    if ch == c && !atEnd { next(); return true }
    return false
  }

  mutating func readUnsignedNumeral() -> Int {
    var n = 0
    var i = 0
    while ch == 0x30 && !atEnd { next() }
    while isAsciiDigit && !atEnd {
      if i < Self.maxSignificantDigits { n = n * 10 + Int(ch - 0x30) }
      i += 1
      next()
    }
    return n
  }

  mutating func readWord() -> (prefix: [UInt32], length: Int) {
    var prefix: [UInt32] = [0, 0, 0]
    var length = 0
    while isAsciiAlphaOrAbove && !isWhiteSpaceChar && !atEnd {
      if length < 3 { prefix[length] = UInt32(ch | 0x20) }
      next()
      length += 1
    }
    return (prefix, length)
  }

  mutating func skipWhiteSpace() -> Bool {
    if isWhiteSpaceChar && !atEnd { next(); return true }
    return false
  }

  mutating func skipParentheses() -> Bool {
    guard ch == 0x28, !atEnd else { return false }
    var balance = 0
    repeat {
      if ch == 0x29 { balance -= 1 } else if ch == 0x28 { balance += 1 }
      next()
    } while balance > 0 && !atEnd
    return true
  }

  // The keyword table: a word matches on its first three letters, and only
  // a month name may run longer than its prefix.
  struct Keyword {
    let prefix: [UInt32]
    let type: KeywordType
    let value: Int

    init(_ word: String, _ type: KeywordType, _ value: Int) {
      var prefix = word.unicodeScalars.map(\.value)
      while prefix.count < 3 { prefix.append(0) }
      self.prefix = prefix
      self.type = type
      self.value = value
    }
  }

  static let keywords: [Keyword] = [
    Keyword("jan", .monthName, 1), Keyword("feb", .monthName, 2), Keyword("mar", .monthName, 3),
    Keyword("apr", .monthName, 4), Keyword("may", .monthName, 5), Keyword("jun", .monthName, 6),
    Keyword("jul", .monthName, 7), Keyword("aug", .monthName, 8), Keyword("sep", .monthName, 9),
    Keyword("oct", .monthName, 10), Keyword("nov", .monthName, 11), Keyword("dec", .monthName, 12),
    Keyword("am", .amPm, 0), Keyword("pm", .amPm, 12),
    Keyword("ut", .timeZoneName, 0), Keyword("utc", .timeZoneName, 0), Keyword("z", .timeZoneName, 0),
    Keyword("gmt", .timeZoneName, 0), Keyword("cdt", .timeZoneName, -5), Keyword("cst", .timeZoneName, -6),
    Keyword("edt", .timeZoneName, -4), Keyword("est", .timeZoneName, -5), Keyword("mdt", .timeZoneName, -6),
    Keyword("mst", .timeZoneName, -7), Keyword("pdt", .timeZoneName, -7), Keyword("pst", .timeZoneName, -8),
    Keyword("t", .timeSeparator, 0),
  ]

  static func lookup(_ prefix: [UInt32], _ length: Int) -> (KeywordType, Int) {
    for entry in keywords where entry.prefix == prefix {
      if length <= 3 || entry.type == .monthName { return (entry.type, entry.value) }
    }
    return (.invalid, 0)
  }

  // The tokenizer, with one token of lookahead.
  var lookahead: Token?

  mutating func scan() -> Token {
    let start = position
    if atEnd { return .endOfInput }
    if isAsciiDigit {
      let n = readUnsignedNumeral()
      return Token(tag: .number, length: position - start, value: n)
    }
    for symbol: UInt16 in [0x3A, 0x2D, 0x2B, 0x2E, 0x29] {
      if skip(symbol) { return Token(tag: .symbol, length: 1, value: Int(symbol)) }
    }
    if isAsciiAlphaOrAbove && !isWhiteSpaceChar {
      let (prefix, length) = readWord()
      let (type, value) = Self.lookup(prefix, length)
      return Token(tag: .keyword, length: length, value: value, keywordType: type)
    }
    if skipWhiteSpace() { return Token(tag: .whiteSpace, length: position - start) }
    if skipParentheses() { return .unknown }
    next()
    return .unknown
  }

  mutating func nextToken() -> Token {
    if let token = lookahead {
      lookahead = nil
      return token
    }
    return scan()
  }

  mutating func peek() -> Token {
    if let token = lookahead { return token }
    let token = scan()
    lookahead = token
    return token
  }

  mutating func skipSymbol(_ c: UInt16) -> Bool {
    if peek().isSymbol(c) {
      _ = nextToken()
      return true
    }
    return false
  }

  // MARK: Composers

  struct DayComposer {
    var comp = [0, 0, 0]
    var index = 0
    var namedMonth = DateParser.none
    var isISODate = false
    var isEmpty: Bool { index == 0 }

    mutating func add(_ n: Int) -> Bool {
      guard index < 3 else { return false }
      comp[index] = n
      index += 1
      return true
    }

    static func isMonth(_ x: Int) -> Bool { (1...12).contains(x) }
    static func isDay(_ x: Int) -> Bool { (1...31).contains(x) }

    mutating func write(_ out: inout Output) -> Bool {
      guard index >= 1 else { return false }
      // Day and month default to 1.
      while index < 3 {
        comp[index] = 1
        index += 1
      }
      var year = 0  // Default year is 0 (=> 2000) for KJS compatibility.
      var month = DateParser.none
      var day = DateParser.none
      if namedMonth == DateParser.none {
        if isISODate || (index == 3 && !Self.isDay(comp[0])) {
          year = comp[0]
          month = comp[1]
          day = comp[2]
        } else {
          month = comp[0]
          day = comp[1]
          if index == 3 { year = comp[2] }
        }
      } else {
        month = namedMonth
        if index == 1 {
          day = comp[0]
        } else if !Self.isDay(comp[0]) {
          year = comp[0]
          day = comp[1]
        } else {
          day = comp[0]
          year = comp[1]
        }
      }
      if !isISODate {
        if (0...49).contains(year) {
          year += 2000
        } else if (50...99).contains(year) {
          year += 1900
        }
      }
      guard Self.isMonth(month), Self.isDay(day) else { return false }
      out.year = year
      out.month = month - 1
      out.day = day
      return true
    }
  }

  struct TimeComposer {
    var comp = [0, 0, 0, 0]
    var index = 0
    var hourOffset = DateParser.none
    var isEmpty: Bool { index == 0 }

    static func isMinute(_ x: Int) -> Bool { (0...59).contains(x) }
    static func isHour(_ x: Int) -> Bool { (0...23).contains(x) }
    static func isSecond(_ x: Int) -> Bool { (0...59).contains(x) }
    static func isHour12(_ x: Int) -> Bool { (0...12).contains(x) }
    static func isMillisecond(_ x: Int) -> Bool { (0...999).contains(x) }

    func isExpecting(_ n: Int) -> Bool {
      (index == 1 && Self.isMinute(n)) || (index == 2 && Self.isSecond(n)) || (index == 3 && Self.isMillisecond(n))
    }

    mutating func add(_ n: Int) -> Bool {
      guard index < 4 else { return false }
      comp[index] = n
      index += 1
      return true
    }

    mutating func addFinal(_ n: Int) -> Bool {
      guard add(n) else { return false }
      while index < 4 {
        comp[index] = 0
        index += 1
      }
      return true
    }

    mutating func write(_ out: inout Output) -> Bool {
      while index < 4 {
        comp[index] = 0
        index += 1
      }
      var hour = comp[0]
      let minute = comp[1], second = comp[2], millisecond = comp[3]
      if hourOffset != DateParser.none {
        guard Self.isHour12(hour) else { return false }
        hour %= 12
        hour += hourOffset
      }
      if !Self.isHour(hour) || !Self.isMinute(minute) || !Self.isSecond(second) || !Self.isMillisecond(millisecond) {
        // A 24th hour is allowed if minutes, seconds and milliseconds are 0.
        if hour != 24 || minute != 0 || second != 0 || millisecond != 0 { return false }
      }
      out.hour = hour
      out.minute = minute
      out.second = second
      out.millisecond = millisecond
      return true
    }
  }

  struct TimeZoneComposer {
    var sign = DateParser.none
    var hour = DateParser.none
    var minute = DateParser.none

    mutating func set(_ offsetInHours: Int) {
      sign = offsetInHours < 0 ? -1 : 1
      hour = offsetInHours * sign
      minute = 0
    }

    mutating func setSign(_ s: Int) { sign = s < 0 ? -1 : 1 }
    func isExpecting(_ n: Int) -> Bool { hour != DateParser.none && minute == DateParser.none && TimeComposer.isMinute(n) }
    var isUTC: Bool { hour == 0 && minute == 0 }
    var isEmpty: Bool { hour == DateParser.none }

    mutating func write(_ out: inout Output) -> Bool {
      if sign != DateParser.none {
        if hour == DateParser.none { hour = 0 }
        if minute == DateParser.none { minute = 0 }
        let total = hour * 3600 + minute * 60
        guard total <= 0x3FFF_FFFF else { return false }  // Smi::kMaxValue
        out.utcOffsetSeconds = sign < 0 ? -total : total
      } else {
        out.utcOffsetSeconds = nil
      }
      return true
    }
  }

  static func readMilliseconds(_ token: Token) -> Int {
    var number = token.value
    var length = token.length
    if length < 3 {
      if length == 1 { number *= 100 } else if length == 2 { number *= 10 }
    } else if length > 3 {
      if length > maxSignificantDigits { length = maxSignificantDigits }
      var factor = 1
      repeat {
        factor *= 10
        length -= 1
      } while length > 3
      number /= factor
    }
    return number
  }

  // MARK: Parsing

  mutating func parseES5DateTime(_ day: inout DayComposer, _ time: inout TimeComposer, _ tz: inout TimeZoneComposer) -> Token {
    // Mandatory date: [('-'|'+')yy]yyyy['-'MM['-'DD]]
    if peek().isAsciiSign {
      let signToken = nextToken()
      if !peek().isFixedLengthNumber(6) { return signToken }
      let sign = signToken.asciiSign
      let year = nextToken().value
      if sign < 0 && year == 0 { return signToken }
      _ = day.add(sign * year)
    } else if peek().isFixedLengthNumber(4) {
      _ = day.add(nextToken().value)
    } else {
      return nextToken()
    }
    if skipSymbol(0x2D) {
      if !peek().isFixedLengthNumber(2) || !DayComposer.isMonth(peek().value) { return nextToken() }
      _ = day.add(nextToken().value)
      if skipSymbol(0x2D) {
        if !peek().isFixedLengthNumber(2) || !DayComposer.isDay(peek().value) { return nextToken() }
        _ = day.add(nextToken().value)
      }
    }
    // Optional time: 'T'HH':'mm[':'ss['.'sss]]Z
    if !peek().isKeywordType(.timeSeparator) {
      if !peek().isEndOfInput { return nextToken() }
    } else {
      _ = nextToken()
      if !peek().isFixedLengthNumber(2) || !(0...24).contains(peek().value) { return .invalid }
      // 24:00[:00[.000]] is allowed, but no other time starting with 24.
      let hourIs24 = peek().value == 24
      _ = time.add(nextToken().value)
      if !skipSymbol(0x3A) { return .invalid }
      if !peek().isFixedLengthNumber(2) || !TimeComposer.isMinute(peek().value) || (hourIs24 && peek().value > 0) {
        return .invalid
      }
      _ = time.add(nextToken().value)
      if skipSymbol(0x3A) {
        if !peek().isFixedLengthNumber(2) || !TimeComposer.isSecond(peek().value) || (hourIs24 && peek().value > 0) {
          return .invalid
        }
        _ = time.add(nextToken().value)
        if skipSymbol(0x2E) {
          if !peek().isNumber || (hourIs24 && peek().value > 0) { return .invalid }
          // More or fewer than the mandated three digits are allowed.
          _ = time.add(Self.readMilliseconds(nextToken()))
        }
      }
      // Optional zone: 'Z' | ('+'|'-')hh':'mm | ('+'|'-')hhmm
      if peek().isKeywordZ {
        _ = nextToken()
        tz.set(0)
      } else if peek().isSymbol(0x2B) || peek().isSymbol(0x2D) {
        tz.setSign(nextToken().value == 0x2B ? 1 : -1)
        if peek().isFixedLengthNumber(4) {
          let hourMinute = nextToken().value
          let hour = hourMinute / 100
          let minute = hourMinute % 100
          if !TimeComposer.isHour(hour) || !TimeComposer.isMinute(minute) { return .invalid }
          tz.hour = hour
          tz.minute = minute
        } else {
          if !peek().isFixedLengthNumber(2) || !TimeComposer.isHour(peek().value) { return .invalid }
          tz.hour = nextToken().value
          if !skipSymbol(0x3A) { return .invalid }
          if !peek().isFixedLengthNumber(2) || !TimeComposer.isMinute(peek().value) { return .invalid }
          tz.minute = nextToken().value
        }
      }
      if !peek().isEndOfInput { return .invalid }
    }
    // Date-only forms are UTC; date-time forms without an offset are local.
    if tz.isEmpty && time.isEmpty { tz.set(0) }
    day.isISODate = true
    return .endOfInput
  }

  mutating func parse() -> Output? {
    var tz = TimeZoneComposer()
    var time = TimeComposer()
    var day = DayComposer()

    let first = parseES5DateTime(&day, &time, &tz)
    if first.isInvalid { return nil }
    var hasReadNumber = !day.isEmpty
    var token = first
    while !token.isEndOfInput {
      if token.isNumber {
        hasReadNumber = true
        let n = token.value
        if skipSymbol(0x3A) {
          if skipSymbol(0x3A) {
            // n + "::"
            if !time.isEmpty { return nil }
            _ = time.add(n)
            _ = time.add(0)
          } else {
            // n + ":"
            if !time.add(n) { return nil }
            if peek().isSymbol(0x2E) { _ = nextToken() }
          }
        } else if skipSymbol(0x2E) && time.isExpecting(n) {
          _ = time.add(n)
          if !peek().isNumber { return nil }
          let ms = Self.readMilliseconds(nextToken())
          if ms < 0 { return nil }
          _ = time.addFinal(ms)
        } else if tz.isExpecting(n) {
          tz.minute = n
        } else if time.isExpecting(n) {
          _ = time.addFinal(n)
          // The end, white space, "Z", "+" or "-" must follow a finished time.
          let next = peek()
          if !next.isEndOfInput && !next.isWhiteSpace && !next.isKeywordZ && !next.isAsciiSign { return nil }
        } else {
          if !day.add(n) { return nil }
          _ = skipSymbol(0x2D)
        }
      } else if token.isKeyword {
        if token.keywordType == .amPm && !time.isEmpty {
          time.hourOffset = token.value
        } else if token.keywordType == .monthName {
          day.namedMonth = token.value
          _ = skipSymbol(0x2D)
        } else if token.keywordType == .timeZoneName && hasReadNumber {
          tz.set(token.value)
        } else {
          // Garbage words are illegal once a number has been read, and the
          // first number must be set apart from them.
          if hasReadNumber { return nil }
          if peek().isNumber { return nil }
        }
      } else if token.isAsciiSign && (tz.isUTC || !time.isEmpty) {
        // A UTC offset, only after UTC or a time.
        tz.setSign(token.asciiSign)
        var n = 0
        var length = 0
        if peek().isNumber {
          let number = nextToken()
          length = number.length
          n = number.value
        }
        hasReadNumber = true
        if peek().isSymbol(0x3A) {
          tz.hour = n
          tz.minute = DateParser.none
        } else if length == 2 || length == 1 {
          // GMT-8
          tz.hour = n
          tz.minute = 0
        } else if length == 4 || length == 3 {
          // GMT-0800
          tz.hour = n / 100
          tz.minute = n % 100
        } else {
          return nil
        }
      } else if (token.isAsciiSign || token.isSymbol(0x29)) && hasReadNumber {
        // An extra sign or ')' is illegal once a number has been read.
        return nil
      }
      token = nextToken()
    }

    var out = Output()
    guard day.write(&out), time.write(&out), tz.write(&out) else { return nil }
    return out
  }
}
