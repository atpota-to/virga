// Domain to ASCII, as the WHATWG URL Standard defines it over UTS #46
// (CheckHyphens off, CheckJoiners and CheckBidi on, UseSTD3ASCIIRules off,
// nontransitional, no DNS length check), with Punycode (RFC 3492). This is how
// `new URL()` turns `bücher.de` into `xn--bcher-kva.de`.
//
// It follows Node's URL parser (Ada) rather than a reading of the standard,
// because the web app runs on that, and Ada differs from the letter of the
// RFCs in ways a host can show:
// - the per-code-point data (UTS #46 status and mapping, bidi class, joining
//   type, virama) is Ada's own, generated from Node into IDNATable.swift;
// - the joiner check stops at the first ZWJ or ZWNJ: if its context holds,
//   the label is valid there and then (later joiners and the bidi rule go
//   unchecked); if not, it is refused. A ZWNJ's context is any L or D letter
//   anywhere before it and any R or D letter anywhere after;
// - the bidi rule is checked as satisfiesBidiRule describes.
// ios/parity/cases/posting-text.url.js and posting-text.idna.js hold the
// result to Node, host by host and character by character.

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

  // MARK: The table

  enum Entry: Sendable {
    case valid(bidi: BidiClass, join: JoinType, leadingMark: Bool)
    case ignored
    case mapped([Unicode.Scalar])
    case disallowed
  }

  enum BidiClass: Sendable { case l, r, an, en, nsm, other }
  enum JoinType: Sendable { case none, dual, left, right, virama }

  struct Table: Sendable {
    var starts: [UInt32] = []
    var ends: [UInt32] = []
    var entries: [Entry] = []

    func lookup(_ v: UInt32) -> Entry {
      var low = 0
      var high = starts.count - 1
      while low <= high {
        let mid = (low + high) / 2
        if v < starts[mid] {
          high = mid - 1
        } else if v > ends[mid] {
          low = mid + 1
        } else {
          return entries[mid]
        }
      }
      return .disallowed
    }
  }

  static let table: Table = {
    var table = Table()
    for line in tableSource.split(separator: "\n") {
      for item in line.split(separator: ";") {
        let isMapping = item.contains("=")
        let parts = item.split(separator: isMapping ? "=" : ":", maxSplits: 1)
        let bounds = parts[0].split(separator: "-")
        guard let start = UInt32(bounds[0], radix: 16) else { continue }
        let end = bounds.count > 1 ? UInt32(bounds[1], radix: 16) ?? start : start
        let payload = parts[1]
        let entry: Entry
        if isMapping {
          entry = .mapped(payload.split(separator: ",").compactMap { UInt32($0, radix: 16).flatMap(Unicode.Scalar.init) })
        } else if payload == "I" {
          entry = .ignored
        } else {
          let chars = Array(payload)
          let bidi: BidiClass
          switch chars[1] {
          case "L": bidi = .l
          case "R": bidi = .r
          case "A": bidi = .an
          case "E": bidi = .en
          case "N": bidi = .nsm
          default: bidi = .other
          }
          let join: JoinType
          switch chars[2] {
          case "D": join = .dual
          case "L": join = .left
          case "R": join = .right
          case "V": join = .virama
          default: join = .none
          }
          entry = .valid(bidi: bidi, join: join, leadingMark: chars.count > 3 && chars[3] == "M")
        }
        table.starts.append(start)
        table.ends.append(end)
        table.entries.append(entry)
      }
    }
    return table
  }()

  /// A code point's entry; ASCII is valid (the URL Standard refuses its own
  /// forbidden characters afterwards).
  static func entry(_ scalar: Unicode.Scalar) -> Entry {
    let v = scalar.value
    if v < 0x80 {
      if (0x41...0x5A).contains(v) { return .mapped([Unicode.Scalar(v + 0x20)!]) }
      let letter = (0x61...0x7A).contains(v)
      let digit = (0x30...0x39).contains(v)
      return .valid(bidi: letter ? .l : digit ? .en : .other, join: .none, leadingMark: false)
    }
    return table.lookup(v)
  }

  static func isValid(_ scalar: Unicode.Scalar) -> Bool {
    if case .valid = entry(scalar) { return true }
    return false
  }

  static func bidiClass(_ scalar: Unicode.Scalar) -> BidiClass {
    if case .valid(let bidi, _, _) = entry(scalar) { return bidi }
    return .other
  }

  static func joinType(_ scalar: Unicode.Scalar) -> JoinType {
    if case .valid(_, let join, _) = entry(scalar) { return join }
    return .none
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
    var out = String.UnicodeScalarView()
    for scalar in domain.unicodeScalars {
      switch entry(scalar) {
      case .valid: out.append(scalar)
      case .mapped(let target): out.append(contentsOf: target)
      case .ignored: continue
      case .disallowed: return nil
      }
    }
    return String(out)
  }

  /// UTS #46 §4.1 validity, as Ada checks it.
  static func isValid(_ label: [Unicode.Scalar], decodedFromPunycode: Bool) -> Bool {
    guard !label.isEmpty else { return true }
    // CheckHyphens off: only the xn-- prefix is refused.
    if label.count >= 4, String(String.UnicodeScalarView(label.prefix(4))) == "xn--" { return false }
    if label.contains(".") { return false }
    // A label may not start with a combining mark (Ada's list of them).
    if case .valid(_, _, true) = entry(label[0]) { return false }
    if decodedFromPunycode {
      // A decoded label must already be mapped and normalized.
      let text = String(String.UnicodeScalarView(label))
      guard text.precomposedStringWithCanonicalMapping == text, label.allSatisfy(isValid) else { return false }
    }
    // The joiners: the first one decides.
    for (index, scalar) in label.enumerated() where scalar.value == 0x200C || scalar.value == 0x200D {
      if index > 0, joinType(label[index - 1]) == .virama { return true }
      guard scalar.value == 0x200C, index > 0, index + 1 < label.count else { return false }
      let before = label[..<index].contains { [.left, .dual].contains(joinType($0)) }
      let after = label[(index + 1)...].contains { [.right, .dual].contains(joinType($0)) }
      return before && after
    }
    return satisfiesBidiRule(label)
  }

  // MARK: The bidi rule, as Node applies it

  /// RFC 5893's bidi rule as Ada applies it, which is not quite as the RFC
  /// writes it. A label that starts with an L character may not hold an R,
  /// AL or AN character between its first and its last (marks at the end
  /// aside); its last isn't checked. Any other label that holds an R, AL or
  /// AN character is right-to-left: no L character between its first and
  /// its last, a last character that is R, AL, EN or AN, and not both EN and
  /// AN. Every other label passes. Held to Node over every label of up to
  /// four characters drawn from each class.
  static func satisfiesBidiRule(_ label: [Unicode.Scalar]) -> Bool {
    let classes = label.map(bidiClass)
    var last = classes.count - 1
    while last >= 0, classes[last] == .nsm { last -= 1 }
    if last < 0 { return false }
    let rtl: Set<BidiClass> = [.r, .an]
    if classes[0] == .l {
      for i in stride(from: 1, to: last, by: 1) where rtl.contains(classes[i]) { return false }
      return true
    }
    guard classes.contains(where: rtl.contains) else { return true }
    for i in stride(from: 1, to: last, by: 1) where classes[i] == .l { return false }
    guard [.r, .en, .an].contains(classes[last]) else { return false }
    return !(classes.contains(.en) && classes.contains(.an))
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
