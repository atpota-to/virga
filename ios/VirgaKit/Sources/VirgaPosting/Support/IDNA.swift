// Domain to ASCII, as the WHATWG URL Standard defines it over UTS #46
// (CheckHyphens off, CheckJoiners on, UseSTD3ASCIIRules off, nontransitional,
// no DNS length check), with Punycode (RFC 3492). This is how `new URL()`
// turns `bücher.de` into `xn--bcher-kva.de`.
//
// UTS #46's mapping table isn't carried here. Its mapping is Unicode's
// NFKC_Casefold with a handful of exceptions, so it is computed: ignorable
// characters dropped, the deviations (ß, ς, ZWJ, ZWNJ) kept, every other
// character lowercased and the result normalized with NFKC. Characters UTS #46
// disallows are recognised by their general category (controls, formats,
// private use, unassigned, separators) and a short list. Node doesn't apply
// the bidi rule, so neither does this; the joiner rule is the virama half
// (a joiner only after a virama). ios/parity/cases/posting-text.url.js holds
// the result to Node for the scripts and symbols posts carry.

import Foundation

enum IDNA {
  /// WHATWG "domain to ASCII" with beStrict false, or nil for failure.
  static func domainToASCII(_ domain: String) -> String? {
    let result: String
    let isASCII = domain.unicodeScalars.allSatisfy(\.isASCII)
    let hasPunycodeLabel = domain.split(separator: ".", omittingEmptySubsequences: false)
      .contains { $0.lowercased().hasPrefix("xn--") }
    if isASCII, !hasPunycodeLabel {
      result = domain.lowercased()
    } else {
      guard let ascii = toASCII(domain) else { return nil }
      result = ascii
    }
    if result.isEmpty { return nil }
    if result.unicodeScalars.contains(where: { WHATWGURL.isForbiddenDomainCodePoint($0.value) }) { return nil }
    return result
  }

  /// UTS #46 ToASCII with the URL Standard's flags, or nil for an error.
  static func toASCII(_ domain: String) -> String? {
    guard let labels = process(domain) else { return nil }
    var out: [String] = []
    for label in labels {
      if label.allSatisfy(\.isASCII) {
        out.append(String(String.UnicodeScalarView(label)))
      } else {
        guard let encoded = Punycode.encode(label) else { return nil }
        out.append("xn--" + encoded)
      }
    }
    return out.joined(separator: ".")
  }

  // MARK: Processing (UTS #46 §4)

  static func process(_ domain: String) -> [[Unicode.Scalar]]? {
    guard let mapped = map(domain) else { return nil }
    let normalized = Array(mapped.precomposedStringWithCanonicalMapping.unicodeScalars)
    var labels: [[Unicode.Scalar]] = []
    var current: [Unicode.Scalar] = []
    for scalar in normalized {
      if scalar == "." {
        labels.append(current)
        current = []
      } else {
        current.append(scalar)
      }
    }
    labels.append(current)

    var out: [[Unicode.Scalar]] = []
    for var label in labels {
      var decodedFromPunycode = false
      if label.count >= 4, String(String.UnicodeScalarView(label.prefix(4))) == "xn--" {
        guard label.allSatisfy(\.isASCII) else { return nil }
        guard let decoded = Punycode.decode(String(String.UnicodeScalarView(label.dropFirst(4)))) else { return nil }
        if decoded.isEmpty || decoded.allSatisfy(\.isASCII) { return nil }
        label = decoded
        decodedFromPunycode = true
      }
      guard isValid(label, decodedFromPunycode: decodedFromPunycode) else { return nil }
      out.append(label)
    }
    return out
  }

  /// The mapping step: nil when a disallowed character is met.
  static func map(_ domain: String) -> String? {
    var first = String.UnicodeScalarView()
    for scalar in domain.unicodeScalars {
      if scalar.isASCII {
        first.append(lowerASCII(scalar))
        continue
      }
      if isIgnored(scalar) { continue }
      // A character whose compatibility form holds a full stop (․ ‥ ⒈) is
      // disallowed; only the ideographic and full-width stops map to one.
      if ![0x3002, 0xFF0E, 0xFF61].contains(scalar.value),
        String(scalar).precomposedStringWithCompatibilityMapping.contains(".")
      {
        return nil
      }
      switch scalar.value {
      case 0x00DF, 0x03C2, 0x200C, 0x200D:
        first.append(scalar)  // deviations, valid when nontransitional
      case 0x1E9E:
        first.append(contentsOf: "ss".unicodeScalars)
      case 0x3002, 0xFF0E, 0xFF61:
        first.append(".")
      default:
        first.append(contentsOf: scalar.properties.lowercaseMapping.unicodeScalars)
      }
    }
    // Compatibility forms (full-width letters, ligatures, ℌ) fold under NFKC,
    // and can come out in capitals, so lowercase once more.
    let compatible = String(first).precomposedStringWithCompatibilityMapping
    var out = String.UnicodeScalarView()
    for scalar in compatible.unicodeScalars {
      if scalar.isASCII {
        out.append(lowerASCII(scalar))
      } else if scalar.value == 0x3002 || scalar.value == 0xFF61 {
        out.append(".")
      } else if isIgnored(scalar) {
        continue
      } else if [0x00DF, 0x03C2, 0x200C, 0x200D].contains(scalar.value) {
        out.append(scalar)
      } else {
        out.append(contentsOf: scalar.properties.lowercaseMapping.unicodeScalars)
      }
    }
    for scalar in out where isDisallowed(scalar) { return nil }
    return String(out)
  }

  static func lowerASCII(_ scalar: Unicode.Scalar) -> Unicode.Scalar {
    (0x41...0x5A).contains(scalar.value) ? Unicode.Scalar(scalar.value + 0x20)! : scalar
  }

  /// Characters UTS #46 maps to nothing.
  static func isIgnored(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x00AD, 0x034F, 0x180B...0x180D, 0x180F, 0x200B, 0x2060, 0x2064, 0xFE00...0xFE0F, 0xFEFF,
      0x1BCA0...0x1BCA3, 0xE0100...0xE01EF:
      return true
    default:
      return false
    }
  }

  /// Characters UTS #46 refuses (ASCII is always allowed here: the URL
  /// Standard refuses its own forbidden characters afterwards).
  static func isDisallowed(_ scalar: Unicode.Scalar) -> Bool {
    if scalar.isASCII { return false }
    switch scalar.value {
    case 0x200C, 0x200D:
      return false  // the joiner rule decides
    case 0x115F, 0x1160, 0x3164, 0xFFA0, 0xFFFC, 0xFFFD, 0x1806, 0x180E, 0x2061...0x2063, 0x2065...0x206F:
      return true
    default:
      break
    }
    if scalar.properties.isNoncharacterCodePoint { return true }
    switch scalar.properties.generalCategory {
    case .control, .format, .surrogate, .privateUse, .unassigned, .spaceSeparator, .lineSeparator,
      .paragraphSeparator:
      return true
    default:
      return false
    }
  }

  /// UTS #46 §4.1 validity, as the URL Standard configures it.
  static func isValid(_ label: [Unicode.Scalar], decodedFromPunycode: Bool) -> Bool {
    guard !label.isEmpty else { return true }
    // CheckHyphens off: only the xn-- prefix is refused.
    if label.count >= 4, String(String.UnicodeScalarView(label.prefix(4))) == "xn--" { return false }
    if label.contains(".") { return false }
    switch label[0].properties.generalCategory {
    case .nonspacingMark, .spacingMark, .enclosingMark: return false
    default: break
    }
    if decodedFromPunycode {
      // A decoded label must already be in its mapped, normalized form.
      let text = String(String.UnicodeScalarView(label))
      guard text.precomposedStringWithCanonicalMapping == text else { return false }
      guard let mapped = map(text), mapped == text else { return false }
    }
    // CheckJoiners (RFC 5892 appendix A): a joiner straight after a virama,
    // or a ZWNJ between letters that join towards it.
    for (index, scalar) in label.enumerated() where scalar.value == 0x200C || scalar.value == 0x200D {
      if index > 0, label[index - 1].properties.canonicalCombiningClass.rawValue == 9 { continue }
      guard scalar.value == 0x200C, zwnjJoins(label, at: index) else { return false }
    }
    return true
  }

  /// `(Joining_Type:{L,D})(Joining_Type:T)* ZWNJ (Joining_Type:T)*(Joining_Type:{R,D})`.
  static func zwnjJoins(_ label: [Unicode.Scalar], at index: Int) -> Bool {
    var before = index - 1
    while before >= 0, joiningType(label[before]) == .transparent { before -= 1 }
    guard before >= 0, [.left, .dual].contains(joiningType(label[before])) else { return false }
    var after = index + 1
    while after < label.count, joiningType(label[after]) == .transparent { after += 1 }
    guard after < label.count else { return false }
    return [.right, .dual].contains(joiningType(label[after]))
  }

  enum JoiningType { case none, left, right, dual, transparent }

  /// Unicode's Joining_Type (ArabicShaping.txt) for the cursive scripts a
  /// domain is written in: Arabic, N'Ko and Mongolian letters; marks and
  /// formats are transparent.
  static func joiningType(_ scalar: Unicode.Scalar) -> JoiningType {
    let v = scalar.value
    switch scalar.properties.generalCategory {
    case .nonspacingMark, .enclosingMark: return .transparent
    case .format where v != 0x200C && v != 0x200D: return .transparent
    default: break
    }
    let right: [ClosedRange<UInt32>] = [
      0x0622...0x0625, 0x0627...0x0627, 0x0629...0x0629, 0x062F...0x0632, 0x0648...0x0648,
      0x0671...0x0673, 0x0675...0x0677, 0x0688...0x0699, 0x06C0...0x06C0, 0x06C3...0x06CB,
      0x06CD...0x06CD, 0x06CF...0x06CF, 0x06D2...0x06D3, 0x06D5...0x06D5, 0x06EE...0x06EF,
      0x0759...0x075B, 0x076B...0x076C, 0x0771...0x0771, 0x0773...0x0774, 0x0778...0x0779,
      0x08AA...0x08AC, 0x08AE...0x08AE, 0x08B1...0x08B2, 0x08B9...0x08B9,
    ]
    if right.contains(where: { $0.contains(v) }) { return .right }
    let dual: [ClosedRange<UInt32>] = [
      0x0620...0x0620, 0x0626...0x0626, 0x0628...0x0628, 0x062A...0x062E, 0x0633...0x063F,
      0x0641...0x0647, 0x0649...0x064A, 0x066E...0x066F, 0x0678...0x0687, 0x069A...0x06BF,
      0x06C1...0x06C2, 0x06CC...0x06CC, 0x06CE...0x06CE, 0x06D0...0x06D1, 0x06FA...0x06FC,
      0x06FF...0x06FF, 0x0750...0x077F, 0x07CA...0x07EA, 0x08A0...0x08C8, 0x1820...0x1878,
    ]
    if dual.contains(where: { $0.contains(v) }) { return .dual }
    return .none
  }

  // MARK: Punycode (RFC 3492)

  enum Punycode {
    static let base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700, initialBias = 72, initialN = 128
    static let maxInt = Int(Int32.max)

    static func adapt(_ delta: Int, _ numPoints: Int, _ firstTime: Bool) -> Int {
      var delta = firstTime ? delta / damp : delta / 2
      delta += delta / numPoints
      var k = 0
      while delta > ((base - tMin) * tMax) / 2 {
        delta /= base - tMin
        k += base
      }
      return k + (base - tMin + 1) * delta / (delta + skew)
    }

    static func digit(_ d: Int) -> Character {
      Character(Unicode.Scalar(UInt8(d < 26 ? d + 0x61 : d - 26 + 0x30)))
    }

    static func value(of scalar: Unicode.Scalar) -> Int? {
      switch scalar.value {
      case 0x30...0x39: return Int(scalar.value) - 0x30 + 26
      case 0x41...0x5A: return Int(scalar.value) - 0x41
      case 0x61...0x7A: return Int(scalar.value) - 0x61
      default: return nil
      }
    }

    static func encode(_ input: [Unicode.Scalar]) -> String? {
      var n = initialN
      var delta = 0
      var bias = initialBias
      var output = ""
      for scalar in input where scalar.isASCII { output.unicodeScalars.append(scalar) }
      let b = output.unicodeScalars.count
      var h = b
      if b > 0 { output += "-" }
      let values = input.map { Int($0.value) }
      while h < values.count {
        guard let m = values.filter({ $0 >= n }).min() else { return nil }
        if m - n > (maxInt - delta) / (h + 1) { return nil }
        delta += (m - n) * (h + 1)
        n = m
        for c in values {
          if c < n {
            delta += 1
            if delta > maxInt { return nil }
          }
          if c == n {
            var q = delta
            var k = base
            while true {
              let t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias)
              if q < t { break }
              output.append(digit(t + (q - t) % (base - t)))
              q = (q - t) / (base - t)
              k += base
            }
            output.append(digit(q))
            bias = adapt(delta, h + 1, h == b)
            delta = 0
            h += 1
          }
        }
        delta += 1
        n += 1
      }
      return output
    }

    static func decode(_ input: String) -> [Unicode.Scalar]? {
      let scalars = Array(input.unicodeScalars)
      var n = initialN
      var i = 0
      var bias = initialBias
      var output: [Unicode.Scalar] = []
      var start = 0
      if let delimiter = scalars.lastIndex(of: "-") {
        for scalar in scalars[..<delimiter] {
          guard scalar.isASCII else { return nil }
          output.append(scalar)
        }
        start = delimiter + 1
      }
      var index = start
      while index < scalars.count {
        let oldI = i
        var w = 1
        var k = base
        while true {
          guard index < scalars.count, let d = value(of: scalars[index]) else { return nil }
          index += 1
          if d > (maxInt - i) / w { return nil }
          i += d * w
          let t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias)
          if d < t { break }
          if w > maxInt / (base - t) { return nil }
          w *= base - t
          k += base
        }
        let count = output.count + 1
        bias = adapt(i - oldI, count, oldI == 0)
        if i / count > maxInt - n { return nil }
        n += i / count
        i %= count
        guard let scalar = Unicode.Scalar(UInt32(n)) else { return nil }
        output.insert(scalar, at: i)
        i += 1
      }
      return output
    }
  }
}
