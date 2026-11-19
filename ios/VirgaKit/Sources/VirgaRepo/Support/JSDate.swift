// JavaScript's `Date.parse`, as V8 (Node, Chrome) parses: first the ES date
// time string format (`2026-03-15T12:00:00.000Z` and its shorter forms),
// then V8's legacy parser for everything else (`2026-03-15 12:00:00`,
// `Mar 15 2026`, `Sun, 15 Mar 2026 12:00:00 GMT+0100`…). A port of V8's
// src/date/dateparser{.h,.cc,-inl.h} and ParseDateTimeString
// (src/builtins/builtins-date.cc), quirks included, because records in the
// wild date themselves in every one of these shapes and carRepo.js's
// atmosphereRowFromEntry dates them with `Date.parse`.
//
// Forms without a zone are local time in V8: here they are read in the
// `timeZone` passed in (the web's is the browser's own).

import Foundation

public enum JSDate {
  /// `Date.parse(text)`: epoch milliseconds, or NaN when V8 can't read it.
  public static func parse(_ text: String, timeZone: TimeZone) -> Double {
    var out = [Double](repeating: 0, count: Parser.outputSize)
    guard Parser.parse(Array(text.utf16), &out) else { return .nan }
    let day = makeDay(out[Parser.year], out[Parser.month], out[Parser.day])
    let time = makeTime(out[Parser.hour], out[Parser.minute], out[Parser.second], out[Parser.millisecond])
    var date = makeDate(day, time)
    if out[Parser.utcOffset].isNaN {
      guard date >= -maxTimeBeforeUTCInMs, date <= maxTimeBeforeUTCInMs else { return .nan }
      date = toUTC(date, timeZone: timeZone)
    } else {
      date -= out[Parser.utcOffset] * 1000
    }
    return timeClip(date)
  }

  /// `new Date(ms).toISOString()`, or nil for an invalid time.
  public static func toISOString(_ ms: Double) -> String? {
    let clipped = timeClip(ms)
    guard clipped.isFinite else { return nil }
    let msPerDay = 86_400_000.0
    let days = (clipped / msPerDay).rounded(.down)
    var rest = Int(clipped - days * msPerDay)
    let (year, month, day) = civilFromDays(Int(days))
    let millisecond = rest % 1000
    rest /= 1000
    let second = rest % 60
    rest /= 60
    let minute = rest % 60
    let hour = rest / 60
    func pad(_ n: Int, _ width: Int) -> String {
      let digits = String(n)
      return String(repeating: "0", count: Swift.max(0, width - digits.count)) + digits
    }
    let yearText: String
    if (0...9999).contains(year) {
      yearText = pad(year, 4)
    } else {
      yearText = (year < 0 ? "-" : "+") + pad(abs(year), 6)
    }
    return "\(yearText)-\(pad(month, 2))-\(pad(day, 2))T\(pad(hour, 2)):\(pad(minute, 2)):\(pad(second, 2)).\(pad(millisecond, 3))Z"
  }

  // MARK: Time arithmetic (src/date/date.cc)

  static let maxTimeInMs: Double = 864_000_000 * 10_000_000
  static let maxTimeBeforeUTCInMs: Double = maxTimeInMs + 86_400_000 * 30

  static func timeClip(_ time: Double) -> Double {
    guard -maxTimeInMs <= time, time <= maxTimeInMs else { return .nan }
    return time.rounded(.towardZero) + 0
  }

  static func makeDate(_ day: Double, _ time: Double) -> Double {
    guard day.isFinite, time.isFinite else { return .nan }
    return time + day * 86_400_000
  }

  static func makeTime(_ hour: Double, _ minute: Double, _ second: Double, _ ms: Double) -> Double {
    guard hour.isFinite, minute.isFinite, second.isFinite, ms.isFinite else { return .nan }
    return hour.rounded(.towardZero) * 3_600_000 + minute.rounded(.towardZero) * 60_000
      + second.rounded(.towardZero) * 1000 + ms.rounded(.towardZero)
  }

  static func makeDay(_ year: Double, _ month: Double, _ date: Double) -> Double {
    guard -1_000_000 <= year, year <= 1_000_000, -10_000_000 <= month, month <= 10_000_000, date.isFinite else {
      return .nan
    }
    var y = Int(year)
    var m = Int(month)
    y += m / 12
    m %= 12
    if m < 0 {
      m += 12
      y -= 1
    }
    let yearDelta = 399_999
    let baseDay =
      365 * (1970 + yearDelta) + (1970 + yearDelta) / 4 - (1970 + yearDelta) / 100 + (1970 + yearDelta) / 400
    var dayFromYear =
      365 * (y + yearDelta) + (y + yearDelta) / 4 - (y + yearDelta) / 100 + (y + yearDelta) / 400 - baseDay
    let common = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    let leap = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
    if y % 4 != 0 || (y % 100 == 0 && y % 400 != 0) {
      dayFromYear += common[m]
    } else {
      dayFromYear += leap[m]
    }
    return Double(dayFromYear - 1) + date.rounded(.towardZero)
  }

  /// A local wall time (as if it were UTC) to UTC, in `timeZone`. Where a
  /// clock change makes the time ambiguous or skips it, the offset from
  /// before the change applies, as V8's does (ICU's UCAL_TZ_LOCAL_FORMER):
  /// 01:30 on a night the clocks go back is the first 01:30, and 02:30 on a
  /// night they go forward is read in the old offset.
  static func toUTC(_ local: Double, timeZone: TimeZone) -> Double {
    func offset(at instant: Double) -> Double {
      Double(timeZone.secondsFromGMT(for: Date(timeIntervalSince1970: instant / 1000))) * 1000
    }
    let day = 86_400_000.0
    let before = offset(at: local - day)
    let after = offset(at: local + day)
    if before == after { return local - before }
    let former = local - before
    if offset(at: former) == before { return former }
    let latter = local - after
    if offset(at: latter) == after { return latter }
    // In the gap a change opens: the old offset.
    return former
  }

  /// Year, month (1-12) and day of a day count since 1970-01-01.
  static func civilFromDays(_ days: Int) -> (Int, Int, Int) {
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
}

// MARK: - V8's DateParser

private enum Parser {
  static let year = 0, month = 1, day = 2, hour = 3, minute = 4, second = 5, millisecond = 6, utcOffset = 7
  static let outputSize = 8

  /// A missing value (kMaxInt).
  static let none = Int(Int32.max)
  /// Digits past this many are read but not counted.
  static let maxSignificantDigits = 9
  /// Smi::kMaxValue on a 64-bit build without pointer compression (Node's).
  static let smiMaxValue = Int(Int32.max)

  static func between(_ x: Int, _ lo: Int, _ hi: Int) -> Bool {
    UInt32(truncatingIfNeeded: x &- lo) <= UInt32(truncatingIfNeeded: hi &- lo)
  }

  // MARK: Characters (src/strings/char-predicates)

  /// IsWhiteSpace: ECMAScript WhiteSpace (Zs, tab, VT, FF, BOM).
  static func isWhiteSpace(_ c: UInt16) -> Bool {
    switch c {
    case 0x09, 0x0B, 0x0C, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
    default: return false
    }
  }

  /// IsWhiteSpaceOrLineTerminator.
  static func isWhiteSpaceOrLineTerminator(_ c: UInt16) -> Bool {
    isWhiteSpace(c) || c == 0x0A || c == 0x0D || c == 0x2028 || c == 0x2029
  }

  // MARK: InputReader

  struct InputReader {
    let buffer: [UInt16]
    var index = 0
    var ch: UInt16 = 0

    init(_ buffer: [UInt16]) {
      self.buffer = buffer
      next()
    }

    var position: Int { index }

    mutating func next() {
      ch = index < buffer.count ? buffer[index] : 0
      index += 1
    }

    mutating func readUnsignedNumeral() -> Int {
      var n = 0
      var i = 0
      while ch == UInt16(UInt8(ascii: "0")) { next() }
      while isAsciiDigit {
        if i < maxSignificantDigits { n = n * 10 + Int(ch) - 48 }
        i += 1
        next()
      }
      return n
    }

    /// A word (characters from 'A' up, not white space): its length, with
    /// its first three characters lower-cased into `prefix`.
    mutating func readWord(_ prefix: inout [UInt32]) -> Int {
      var length = 0
      while isAsciiAlphaOrAbove && !isWhiteSpace(ch) {
        if length < prefix.count { prefix[length] = UInt32(ch) | 0x20 }
        next()
        length += 1
      }
      if length < prefix.count {
        for i in length..<prefix.count { prefix[i] = 0 }
      }
      return length
    }

    mutating func skip(_ c: UInt16) -> Bool {
      guard ch == c else { return false }
      next()
      return true
    }

    mutating func skipWhiteSpace() -> Bool {
      guard isWhiteSpaceOrLineTerminator(ch) else { return false }
      next()
      return true
    }

    mutating func skipParentheses() -> Bool {
      guard ch == UInt16(UInt8(ascii: "(")) else { return false }
      var balance = 0
      repeat {
        if ch == UInt16(UInt8(ascii: ")")) {
          balance -= 1
        } else if ch == UInt16(UInt8(ascii: "(")) {
          balance += 1
        }
        next()
      } while balance > 0 && ch != 0
      return true
    }

    var isEnd: Bool { ch == 0 }
    var isAsciiDigit: Bool { ch >= 48 && ch <= 57 }
    var isAsciiAlphaOrAbove: Bool { ch >= UInt16(UInt8(ascii: "A")) }
  }

  // MARK: Tokens

  enum KeywordType: Int {
    case invalid = 0, monthName, timeZoneName, timeSeparator, amPm
  }

  struct Token {
    static let invalidTag = -6, unknownTag = -5, whiteSpaceTag = -4, numberTag = -3, symbolTag = -2,
      endOfInputTag = -1

    var tag: Int
    var length: Int
    var value: Int

    var isInvalid: Bool { tag == Self.invalidTag }
    var isNumber: Bool { tag == Self.numberTag }
    var isSymbol: Bool { tag == Self.symbolTag }
    var isWhiteSpace: Bool { tag == Self.whiteSpaceTag }
    var isEndOfInput: Bool { tag == Self.endOfInputTag }
    var isKeyword: Bool { tag >= 0 }
    var number: Int { value }
    var keywordType: KeywordType { KeywordType(rawValue: tag) ?? .invalid }
    var keywordValue: Int { value }

    func isSymbol(_ symbol: Character) -> Bool { isSymbol && value == Int(symbol.asciiValue!) }
    func isKeywordType(_ type: KeywordType) -> Bool { tag == type.rawValue }
    func isFixedLengthNumber(_ n: Int) -> Bool { isNumber && length == n }
    var isAsciiSign: Bool { tag == Self.symbolTag && (value == 45 || value == 43) }
    /// 1 for '+', -1 for '-'.
    var asciiSign: Int { 44 - value }
    var isKeywordZ: Bool { isKeywordType(.timeZoneName) && length == 1 && value == 0 }

    static func keyword(_ type: KeywordType, _ value: Int, _ length: Int) -> Token {
      Token(tag: type.rawValue, length: length, value: value)
    }
    static func number(_ value: Int, _ length: Int) -> Token { Token(tag: numberTag, length: length, value: value) }
    static func symbol(_ c: UInt16) -> Token { Token(tag: symbolTag, length: 1, value: Int(c)) }
    static let endOfInput = Token(tag: endOfInputTag, length: 0, value: -1)
    static func whiteSpace(_ length: Int) -> Token { Token(tag: whiteSpaceTag, length: length, value: -1) }
    static let unknown = Token(tag: unknownTag, length: 1, value: -1)
    static let invalid = Token(tag: invalidTag, length: 0, value: -1)
  }

  // MARK: KeywordTable

  static let keywords: [(prefix: [UInt32], type: KeywordType, value: Int)] = {
    func p(_ s: String) -> [UInt32] {
      var out = s.unicodeScalars.map { $0.value }
      while out.count < 3 { out.append(0) }
      return out
    }
    return [
      (p("jan"), .monthName, 1), (p("feb"), .monthName, 2), (p("mar"), .monthName, 3),
      (p("apr"), .monthName, 4), (p("may"), .monthName, 5), (p("jun"), .monthName, 6),
      (p("jul"), .monthName, 7), (p("aug"), .monthName, 8), (p("sep"), .monthName, 9),
      (p("oct"), .monthName, 10), (p("nov"), .monthName, 11), (p("dec"), .monthName, 12),
      (p("am"), .amPm, 0), (p("pm"), .amPm, 12),
      (p("ut"), .timeZoneName, 0), (p("utc"), .timeZoneName, 0), (p("z"), .timeZoneName, 0),
      (p("gmt"), .timeZoneName, 0), (p("cdt"), .timeZoneName, -5), (p("cst"), .timeZoneName, -6),
      (p("edt"), .timeZoneName, -4), (p("est"), .timeZoneName, -5), (p("mdt"), .timeZoneName, -6),
      (p("mst"), .timeZoneName, -7), (p("pdt"), .timeZoneName, -7), (p("pst"), .timeZoneName, -8),
      (p("t"), .timeSeparator, 0),
    ]
  }()

  /// The keyword a word is, or `.invalid`. A word longer than three
  /// characters is a keyword only if it starts with a month's name.
  static func lookup(_ prefix: [UInt32], _ length: Int) -> (KeywordType, Int) {
    for entry in keywords where entry.prefix == prefix {
      if length <= 3 || entry.type == .monthName { return (entry.type, entry.value) }
    }
    return (.invalid, 0)
  }

  // MARK: DateStringTokenizer

  struct Tokenizer {
    var input: InputReader
    var nextToken: Token = .endOfInput

    init(_ input: InputReader) {
      self.input = input
      nextToken = scan()
    }

    mutating func next() -> Token {
      let result = nextToken
      nextToken = scan()
      return result
    }

    func peek() -> Token { nextToken }

    mutating func skipSymbol(_ symbol: Character) -> Bool {
      guard nextToken.isSymbol(symbol) else { return false }
      nextToken = scan()
      return true
    }

    mutating func scan() -> Token {
      let prePos = input.position
      if input.isEnd { return .endOfInput }
      if input.isAsciiDigit {
        let n = input.readUnsignedNumeral()
        return .number(n, input.position - prePos)
      }
      for symbol in [":", "-", "+", ".", ")"] as [Character] {
        let unit = UInt16(symbol.asciiValue!)
        if input.skip(unit) { return .symbol(unit) }
      }
      if input.isAsciiAlphaOrAbove && !isWhiteSpace(input.ch) {
        var prefix: [UInt32] = [0, 0, 0]
        let length = input.readWord(&prefix)
        let (type, value) = lookup(prefix, length)
        return .keyword(type, value, length)
      }
      if input.skipWhiteSpace() { return .whiteSpace(input.position - prePos) }
      if input.skipParentheses() { return .unknown }
      input.next()
      return .unknown
    }
  }

  // MARK: Composers

  struct TimeZoneComposer {
    var sign = none
    var hour = none
    var minute = none

    mutating func set(_ offsetInHours: Int) {
      sign = offsetInHours < 0 ? -1 : 1
      hour = offsetInHours * sign
      minute = 0
    }
    mutating func setSign(_ s: Int) { sign = s < 0 ? -1 : 1 }
    mutating func setAbsoluteHour(_ h: Int) { hour = h }
    mutating func setAbsoluteMinute(_ m: Int) { minute = m }
    func isExpecting(_ n: Int) -> Bool { hour != none && minute == none && TimeComposer.isMinute(n) }
    var isUTC: Bool { hour == 0 && minute == 0 }
    var isEmpty: Bool { hour == none }

    mutating func write(_ output: inout [Double]) -> Bool {
      if sign != none {
        if hour == none { hour = 0 }
        if minute == none { minute = 0 }
        // Unsigned arithmetic, wrapping as V8's does.
        let total = UInt32(truncatingIfNeeded: hour) &* 3600 &+ UInt32(truncatingIfNeeded: minute) &* 60
        if Int(total) > smiMaxValue { return false }
        var seconds = Int(total)
        if sign < 0 { seconds = -seconds }
        output[utcOffset] = Double(seconds)
      } else {
        output[utcOffset] = .nan
      }
      return true
    }
  }

  struct TimeComposer {
    static let size = 4
    var comp = [Int](repeating: 0, count: 4)
    var index = 0
    var hourOffset = none

    var isEmpty: Bool { index == 0 }
    func isExpecting(_ n: Int) -> Bool {
      (index == 1 && Self.isMinute(n)) || (index == 2 && Self.isSecond(n)) || (index == 3 && Self.isMillisecond(n))
    }
    @discardableResult
    mutating func add(_ n: Int) -> Bool {
      guard index < Self.size else { return false }
      comp[index] = n
      index += 1
      return true
    }
    @discardableResult
    mutating func addFinal(_ n: Int) -> Bool {
      guard add(n) else { return false }
      while index < Self.size {
        comp[index] = 0
        index += 1
      }
      return true
    }
    mutating func setHourOffset(_ n: Int) { hourOffset = n }

    static func isMinute(_ x: Int) -> Bool { between(x, 0, 59) }
    static func isHour(_ x: Int) -> Bool { between(x, 0, 23) }
    static func isSecond(_ x: Int) -> Bool { between(x, 0, 59) }
    static func isHour12(_ x: Int) -> Bool { between(x, 0, 12) }
    static func isMillisecond(_ x: Int) -> Bool { between(x, 0, 999) }

    mutating func write(_ output: inout [Double]) -> Bool {
      while index < Self.size {
        comp[index] = 0
        index += 1
      }
      var hour = comp[0]
      let minute = comp[1]
      let second = comp[2]
      let millisecond = comp[3]
      if hourOffset != none {
        if !Self.isHour12(hour) { return false }
        hour %= 12
        hour += hourOffset
      }
      if !Self.isHour(hour) || !Self.isMinute(minute) || !Self.isSecond(second) || !Self.isMillisecond(millisecond) {
        // A 24th hour is allowed if minutes, seconds and milliseconds are 0.
        if hour != 24 || minute != 0 || second != 0 || millisecond != 0 { return false }
      }
      output[Parser.hour] = Double(hour)
      output[Parser.minute] = Double(minute)
      output[Parser.second] = Double(second)
      output[Parser.millisecond] = Double(millisecond)
      return true
    }
  }

  struct DayComposer {
    static let size = 3
    var comp = [Int](repeating: 0, count: 3)
    var index = 0
    var namedMonth = none
    var isIsoDate = false

    var isEmpty: Bool { index == 0 }
    @discardableResult
    mutating func add(_ n: Int) -> Bool {
      guard index < Self.size else { return false }
      comp[index] = n
      index += 1
      return true
    }
    mutating func setNamedMonth(_ n: Int) { namedMonth = n }
    static func isMonth(_ x: Int) -> Bool { between(x, 1, 12) }
    static func isDay(_ x: Int) -> Bool { between(x, 1, 31) }

    mutating func write(_ output: inout [Double]) -> Bool {
      if index < 1 { return false }
      // Day and month default to 1.
      while index < Self.size {
        comp[index] = 1
        index += 1
      }
      var year = 0  // Default year is 0 (=> 2000) for KJS compatibility.
      var month = none
      var day = none
      if namedMonth == none {
        if isIsoDate || (index == 3 && !Self.isDay(comp[0])) {
          // YMD
          year = comp[0]
          month = comp[1]
          day = comp[2]
        } else {
          // MD(Y)
          month = comp[0]
          day = comp[1]
          if index == 3 { year = comp[2] }
        }
      } else {
        month = namedMonth
        if index == 1 {
          // MD or DM
          day = comp[0]
        } else if !Self.isDay(comp[0]) {
          // YMD, MYD, or YDM
          year = comp[0]
          day = comp[1]
        } else {
          // DMY, MDY, or DYM
          day = comp[0]
          year = comp[1]
        }
      }
      if !isIsoDate {
        if between(year, 0, 49) {
          year += 2000
        } else if between(year, 50, 99) {
          year += 1900
        }
      }
      if year < Int(Int32.min) || year > Int(Int32.max) || !Self.isMonth(month) || !Self.isDay(day) { return false }
      output[Parser.year] = Double(year)
      output[Parser.month] = Double(month - 1)  // 0-based
      output[Parser.day] = Double(day)
      return true
    }
  }

  static func readMilliseconds(_ token: Token) -> Int {
    // The first three significant digits of the numeral, from its value
    // and how many digits it had (leading zeros included).
    var number = token.number
    var length = token.length
    if length < 3 {
      if length == 1 {
        number *= 100
      } else if length == 2 {
        number *= 10
      }
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

  // MARK: Parse

  static func parse(_ text: [UInt16], _ out: inout [Double]) -> Bool {
    var scanner = Tokenizer(InputReader(text))
    var tz = TimeZoneComposer()
    var time = TimeComposer()
    var day = DayComposer()

    // First as far as possible as an ES date time string.
    let nextUnhandledToken = parseES5DateTime(&scanner, &day, &time, &tz)
    if nextUnhandledToken.isInvalid { return false }
    var hasReadNumber = !day.isEmpty
    // Then whatever is left by the legacy rules.
    var token = nextUnhandledToken
    while !token.isEndOfInput {
      if token.isNumber {
        hasReadNumber = true
        let n = token.number
        if scanner.skipSymbol(":") {
          if scanner.skipSymbol(":") {
            // n + "::"
            if !time.isEmpty { return false }
            time.add(n)
            time.add(0)
          } else {
            // n + ":"
            if !time.add(n) { return false }
            if scanner.peek().isSymbol(".") { _ = scanner.next() }
          }
        } else if scanner.skipSymbol("."), time.isExpecting(n) {
          time.add(n)
          if !scanner.peek().isNumber { return false }
          let ms = readMilliseconds(scanner.next())
          if ms < 0 { return false }
          time.addFinal(ms)
        } else if tz.isExpecting(n) {
          tz.setAbsoluteMinute(n)
        } else if time.isExpecting(n) {
          time.addFinal(n)
          // Require end, white space, "Z", "+" or "-" right after the time.
          let peek = scanner.peek()
          if !peek.isEndOfInput && !peek.isWhiteSpace && !peek.isKeywordZ && !peek.isAsciiSign { return false }
        } else {
          if !day.add(n) { return false }
          _ = scanner.skipSymbol("-")
        }
      } else if token.isKeyword {
        // A word (characters from 'A' up).
        let type = token.keywordType
        let value = token.keywordValue
        if type == .amPm && !time.isEmpty {
          time.setHourOffset(value)
        } else if type == .monthName {
          day.setNamedMonth(value)
          _ = scanner.skipSymbol("-")
        } else if type == .timeZoneName && hasReadNumber {
          tz.set(value)
        } else {
          // Garbage words are illegal once a number has been read, and the
          // first number must be set apart from them.
          if hasReadNumber { return false }
          if scanner.peek().isNumber { return false }
        }
      } else if token.isAsciiSign && (tz.isUTC || !time.isEmpty) {
        // A UTC offset (only after UTC or a time).
        tz.setSign(token.asciiSign)
        // The number may be missing.
        var n = 0
        var length = 0
        if scanner.peek().isNumber {
          let numberToken = scanner.next()
          length = numberToken.length
          n = numberToken.number
        }
        hasReadNumber = true
        if scanner.peek().isSymbol(":") {
          tz.setAbsoluteHour(n)
          tz.setAbsoluteMinute(none)
        } else if length == 2 || length == 1 {
          // Time zones like GMT-8.
          tz.setAbsoluteHour(n)
          tz.setAbsoluteMinute(0)
        } else if length == 4 || length == 3 {
          // The hhmm form.
          tz.setAbsoluteHour(n / 100)
          tz.setAbsoluteMinute(n % 100)
        } else {
          // No time zones like GMT-12345.
          return false
        }
      } else if (token.isAsciiSign || token.isSymbol(")")) && hasReadNumber {
        // An extra sign or ')' is illegal once a number has been read.
        return false
      } else {
        // Other characters and white space are ignored.
      }
      token = scanner.next()
    }
    return day.write(&out) && time.write(&out) && tz.write(&out)
  }

  /// The ES date time string format, as far as it goes: returns the token
  /// the legacy parser carries on from, the end of input when the whole
  /// string was read, or `.invalid` when it can't be a date at all.
  static func parseES5DateTime(
    _ scanner: inout Tokenizer, _ day: inout DayComposer, _ time: inout TimeComposer, _ tz: inout TimeZoneComposer
  ) -> Token {
    // The date: [('-'|'+')yy]yyyy['-'MM['-'DD]]
    if scanner.peek().isAsciiSign {
      // Keep the sign, to hand back to the legacy parser if unused.
      let signToken = scanner.next()
      if !scanner.peek().isFixedLengthNumber(6) { return signToken }
      let sign = signToken.asciiSign
      let year = scanner.next().number
      if sign < 0 && year == 0 { return signToken }
      day.add(sign * year)
    } else if scanner.peek().isFixedLengthNumber(4) {
      day.add(scanner.next().number)
    } else {
      return scanner.next()
    }
    if scanner.skipSymbol("-") {
      if !scanner.peek().isFixedLengthNumber(2) || !DayComposer.isMonth(scanner.peek().number) {
        return scanner.next()
      }
      day.add(scanner.next().number)
      if scanner.skipSymbol("-") {
        if !scanner.peek().isFixedLengthNumber(2) || !DayComposer.isDay(scanner.peek().number) {
          return scanner.next()
        }
        day.add(scanner.next().number)
      }
    }
    // The time: 'T'HH':'mm[':'ss['.'sss]] and a zone.
    if !scanner.peek().isKeywordType(.timeSeparator) {
      if !scanner.peek().isEndOfInput { return scanner.next() }
    } else {
      _ = scanner.next()
      if !scanner.peek().isFixedLengthNumber(2) || !between(scanner.peek().number, 0, 24) {
        return .invalid
      }
      // 24:00[:00[.000]] is allowed; no other time in hour 24.
      let hourIs24 = scanner.peek().number == 24
      time.add(scanner.next().number)
      if !scanner.skipSymbol(":") { return .invalid }
      if !scanner.peek().isFixedLengthNumber(2) || !TimeComposer.isMinute(scanner.peek().number)
        || (hourIs24 && scanner.peek().number > 0)
      {
        return .invalid
      }
      time.add(scanner.next().number)
      if scanner.skipSymbol(":") {
        if !scanner.peek().isFixedLengthNumber(2) || !TimeComposer.isSecond(scanner.peek().number)
          || (hourIs24 && scanner.peek().number > 0)
        {
          return .invalid
        }
        time.add(scanner.next().number)
        if scanner.skipSymbol(".") {
          if !scanner.peek().isNumber || (hourIs24 && scanner.peek().number > 0) {
            return .invalid
          }
          // More or fewer than the mandated three digits are allowed.
          time.add(readMilliseconds(scanner.next()))
        }
      }
      // The zone: 'Z' | ('+'|'-')hh':'mm
      if scanner.peek().isKeywordZ {
        _ = scanner.next()
        tz.set(0)
      } else if scanner.peek().isSymbol("+") || scanner.peek().isSymbol("-") {
        tz.setSign(scanner.next().value == 43 ? 1 : -1)
        if scanner.peek().isFixedLengthNumber(4) {
          // The hhmm extension.
          let hourMinute = scanner.next().number
          let hour = hourMinute / 100
          let minute = hourMinute % 100
          if !TimeComposer.isHour(hour) || !TimeComposer.isMinute(minute) { return .invalid }
          tz.setAbsoluteHour(hour)
          tz.setAbsoluteMinute(minute)
        } else {
          // hh:mm.
          if !scanner.peek().isFixedLengthNumber(2) || !TimeComposer.isHour(scanner.peek().number) {
            return .invalid
          }
          tz.setAbsoluteHour(scanner.next().number)
          if !scanner.skipSymbol(":") { return .invalid }
          if !scanner.peek().isFixedLengthNumber(2) || !TimeComposer.isMinute(scanner.peek().number) {
            return .invalid
          }
          tz.setAbsoluteMinute(scanner.next().number)
        }
      }
      if !scanner.peek().isEndOfInput { return .invalid }
    }
    // A whole ES date time string. Without a zone, a date alone is UTC and
    // a date with a time is local.
    if tz.isEmpty && time.isEmpty { tz.set(0) }
    day.isIsoDate = true
    return .endOfInput
  }
}
