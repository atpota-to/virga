// Ports src/legal/markdown.js
//
// A small Markdown reader for Virga's own legal documents
// (TERMS_OF_SERVICE.md and PRIVACY_POLICY.md at the repo's root, bundled
// with the app). The pages draw them from that same text, so the page and
// the file can't say different things.
//
// It reads only what those documents use: headings (#, ##, ###),
// paragraphs, lists (- and 1., nested by indentation), tables, a rule, and
// inline bold, emphasis, code and links. Anything else is reported in
// `problems` rather than guessed at. The result is a plain tree for SwiftUI
// to draw (VirgaUI); nothing here builds markup.
//
// The web's regular expressions are matched by hand, a UTF-16 code unit at a
// time, as JavaScript reads them (`.` stops only at \n, \r, U+2028 and
// U+2029; `\s` is JavaScript's whitespace; `\d` and `\w` are ASCII), so the
// tree is the web's for any text. ios/parity/cases/session.markdown.js holds
// it to the web reader's output for both documents and the edge cases.

import Foundation
import VirgaCore

/// An inline node: `{ type: 'text' | 'code', value }`, `{ type: 'strong' |
/// 'em', children }` or `{ type: 'link', href, children }`.
public indirect enum MarkdownInline: Sendable, Hashable, Encodable {
  case text(String)
  case code(String)
  case strong([MarkdownInline])
  case em([MarkdownInline])
  case link(href: String, children: [MarkdownInline])

  enum CodingKeys: String, CodingKey { case type, value, href, children }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .text(let value):
      try c.encode("text", forKey: .type)
      try c.encode(value, forKey: .value)
    case .code(let value):
      try c.encode("code", forKey: .type)
      try c.encode(value, forKey: .value)
    case .strong(let children):
      try c.encode("strong", forKey: .type)
      try c.encode(children, forKey: .children)
    case .em(let children):
      try c.encode("em", forKey: .type)
      try c.encode(children, forKey: .children)
    case .link(let href, let children):
      try c.encode("link", forKey: .type)
      try c.encode(href, forKey: .href)
      try c.encode(children, forKey: .children)
    }
  }
}

/// `{ type: 'list', ordered, start, items }`.
public struct MarkdownList: Sendable, Hashable, Encodable {
  public var ordered: Bool
  /// The number the list starts at, or nil for bullets.
  public var start: Int?
  public var items: [MarkdownListItem]

  enum CodingKeys: String, CodingKey { case type, ordered, start, items }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode("list", forKey: .type)
    try c.encode(ordered, forKey: .ordered)
    if let start { try c.encode(start, forKey: .start) } else { try c.encodeNil(forKey: .start) }
    try c.encode(items, forKey: .items)
  }
}

/// `{ children, sub }`: an item's words, and the list under it (or nil).
public struct MarkdownListItem: Sendable, Hashable, Encodable {
  public var children: [MarkdownInline]
  public var sub: MarkdownList?

  enum CodingKeys: String, CodingKey { case children, sub }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(children, forKey: .children)
    if let sub { try c.encode(sub, forKey: .sub) } else { try c.encodeNil(forKey: .sub) }
  }
}

/// A block of a document.
public enum MarkdownBlock: Sendable, Hashable, Encodable {
  /// `{ type: 'heading', level, id, children }`: level 1 to 3, and the anchor.
  case heading(level: Int, id: String, children: [MarkdownInline])
  case paragraph([MarkdownInline])
  case list(MarkdownList)
  /// `{ type: 'table', head: [children], rows: [[children]] }`.
  case table(head: [[MarkdownInline]], rows: [[[MarkdownInline]]])
  case rule

  enum CodingKeys: String, CodingKey { case type, level, id, children, head, rows }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .list(let list):
      try list.encode(to: encoder)
    case .heading(let level, let id, let children):
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode("heading", forKey: .type)
      try c.encode(level, forKey: .level)
      try c.encode(id, forKey: .id)
      try c.encode(children, forKey: .children)
    case .paragraph(let children):
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode("paragraph", forKey: .type)
      try c.encode(children, forKey: .children)
    case .table(let head, let rows):
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode("table", forKey: .type)
      try c.encode(head, forKey: .head)
      try c.encode(rows, forKey: .rows)
    case .rule:
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode("rule", forKey: .type)
    }
  }
}

/// Something the reader left as written: `{ line, problem }`, the line
/// counted from 1.
public struct MarkdownProblem: Sendable, Hashable, Encodable {
  public var line: Int
  public var problem: String
}

/// `parseMarkdown`'s answer: `{ title, blocks, problems }`.
public struct MarkdownDocument: Sendable, Hashable, Encodable {
  public var title: String?
  public var blocks: [MarkdownBlock]
  public var problems: [MarkdownProblem]

  enum CodingKeys: String, CodingKey { case title, blocks, problems }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    if let title { try c.encode(title, forKey: .title) } else { try c.encodeNil(forKey: .title) }
    try c.encode(blocks, forKey: .blocks)
    try c.encode(problems, forKey: .problems)
  }
}

/// One entry of a document's contents: `{ id, text, level }`.
public struct MarkdownOutlineEntry: Sendable, Hashable, Encodable {
  public var id: String
  public var text: String
  public var level: Int
}

public enum LegalMarkdown {
  /// The deepest heading the documents may use, and the page styles.
  static let maxHeadingLevel = 3

  // MARK: Links

  /// `isSafeHref(href)`: https and mailto, a path on this site, a place on
  /// this page, or one of the documents by its file name. Anything else, a
  /// `javascript:` address included, is drawn as plain words.
  public static func isSafeHref(_ href: String?) -> Bool {
    isSafeHref(units: (href ?? "").units)
  }

  static func isSafeHref(units v: Units) -> Bool {
    // /[\s<>"'`\\]/
    if v.contains(where: { Unit.isWhitespace($0) || [Unit.less, Unit.greater, Unit.quote, Unit.apostrophe, Unit.backtick, Unit.backslash].contains($0) }) {
      return false
    }
    // /^https:\/\/[^/]/i
    if v.hasPrefix("https://", ignoringCase: true), v.count > 8, v[8] != Unit.slash { return true }
    // /^mailto:[^@\s]+@[^@\s]+$/i (no whitespace is left by now)
    if v.hasPrefix("mailto:", ignoringCase: true) {
      let rest = v[7...]
      if let at = rest.firstIndex(of: Unit.at), at > rest.startIndex, at < rest.endIndex - 1,
        !rest[(at + 1)...].contains(Unit.at)
      {
        return true
      }
    }
    // /^\/(?!\/)/
    if v.first == Unit.slash, v.unit(at: 1) != Unit.slash { return true }
    // /^#[\w-]+$/
    if v.first == Unit.hash, v.count > 1, v[1...].allSatisfy(isWordOrHyphen) { return true }
    // /^[A-Z][A-Z_]*\.md(?:#[\w-]+)?$/
    return isDocumentFileLink(v) != nil
  }

  static func isWordOrHyphen(_ unit: UInt16) -> Bool { Unit.isWord(unit) || unit == Unit.hyphen }

  /// `/^([A-Z][A-Z_]*\.md)(#[\w-]+)?$/`: the file and the anchor (with its
  /// `#`, or empty), or nil.
  static func isDocumentFileLink(_ v: Units) -> (file: Units, anchor: Units)? {
    guard let first = v.first, Unit.isUpper(first) else { return nil }
    var i = 1
    while i < v.count, Unit.isUpper(v[i]) || v[i] == Unit.underscore { i += 1 }
    guard v.count >= i + 3, v[i] == Unit.dot, v[i + 1] == 0x6D, v[i + 2] == 0x64 else { return nil }
    let fileEnd = i + 3
    if fileEnd == v.count { return (Array(v[0..<fileEnd]), []) }
    guard v[fileEnd] == Unit.hash, v.count > fileEnd + 1, v[(fileEnd + 1)...].allSatisfy(isWordOrHyphen) else { return nil }
    return (Array(v[0..<fileEnd]), Array(v[fileEnd...]))
  }

  // MARK: Words

  /// `inlineText(children)`: the words of a run of inline nodes, without
  /// their markup.
  public static func inlineText(_ children: [MarkdownInline]?) -> String {
    (children ?? []).map { node in
      switch node {
      case .text(let value), .code(let value): return value
      case .strong(let children), .em(let children), .link(_, let children): return inlineText(children)
      }
    }.joined()
  }

  /// `slugify(text)`: a heading's words as an anchor, as GitHub makes one:
  /// lower case, punctuation dropped, a hyphen for each space.
  public static func slugify(_ text: String?) -> String {
    let lowered = (text ?? "").jsTrimmed().jsLowercased()
    var out = String.UnicodeScalarView()
    for scalar in lowered.unicodeScalars {
      // /[^\p{L}\p{N}\s_-]/gu removed, then /\s/g → '-'.
      if JSWhitespace.contains(scalar) {
        out.append("-")
        continue
      }
      if scalar == "_" || scalar == "-" || isLetterOrNumber(scalar) { out.append(scalar) }
    }
    let slug = String(out)
    return slug.isEmpty ? "section" : slug
  }

  static func isLetterOrNumber(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.properties.generalCategory {
    case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
      .decimalNumber, .letterNumber, .otherNumber:
      return true
    default:
      return false
    }
  }

  // MARK: Inline markup

  /// What a backslash may escape: `[\\`*_[\]()|#<>!.+-]`.
  static let escapable: Set<UInt16> = Set("\\`*_[]()|#<>!.+-".utf16)

  /// The index of the `*` that closes an emphasis opened at `from - 1`: the
  /// next single asterisk with something other than whitespace before it.
  static func closingAsterisk(_ text: Units, _ from: Int) -> Int {
    var i = from
    while i < text.count {
      defer { i += 1 }
      if text[i] == Unit.backslash {
        i += 1
        continue
      }
      if text[i] != Unit.star { continue }
      if text.unit(at: i + 1) == Unit.star {
        i += 1
        continue
      }
      if i > from && !Unit.isWhitespace(text[i - 1]) { return i }
    }
    return -1
  }

  /// The index of the next `**` at or after `from` that isn't escaped, or -1.
  static func closingBold(_ text: Units, _ from: Int) -> Int {
    var i = from
    while i < text.count - 1 {
      defer { i += 1 }
      if text[i] == Unit.backslash {
        i += 1
        continue
      }
      if text[i] == Unit.star && text[i + 1] == Unit.star && i > from { return i }
    }
    return -1
  }

  /// `/^\[((?:[^\]\\]|\\.)+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/` at
  /// `start`: the link's words, its address and how long it is.
  static func matchLink(_ s: Units, at start: Int) -> (text: Units, href: Units, length: Int)? {
    guard s.unit(at: start) == Unit.openBracket else { return nil }
    var j = start + 1
    let textStart = j
    while j < s.count {
      let c = s[j]
      if c == Unit.closeBracket { break }
      if c == Unit.backslash {
        guard j + 1 < s.count, !Unit.isLineTerminator(s[j + 1]) else { break }
        j += 2
        continue
      }
      j += 1
    }
    guard j > textStart, j < s.count, s[j] == Unit.closeBracket else { return nil }
    let textEnd = j
    j += 1
    guard j < s.count, s[j] == Unit.openParen else { return nil }
    j += 1
    let hrefStart = j
    var nested = false
    while j < s.count {
      let c = s[j]
      if c == Unit.openParen {
        if nested { return nil }
        nested = true
      } else if c == Unit.closeParen {
        if !nested { break }
        nested = false
      } else if Unit.isWhitespace(c) {
        return nil
      }
      j += 1
    }
    guard j < s.count, s[j] == Unit.closeParen, !nested else { return nil }
    return (Array(s[textStart..<textEnd]), Array(s[hrefStart..<j]), j + 1 - start)
  }

  /// Inline nodes as the web builds them: a text node's words are
  /// collected as code units, so text pushed a unit at a time joins up.
  struct InlineBuilder {
    enum Node {
      case text(Units)
      case done(MarkdownInline)
    }

    var nodes: [Node] = []

    mutating func pushText(_ units: Units) {
      guard !units.isEmpty else { return }
      if case .text(let last)? = nodes.last {
        nodes[nodes.count - 1] = .text(last + units)
      } else {
        nodes.append(.text(units))
      }
    }

    mutating func push(_ node: MarkdownInline) {
      nodes.append(.done(node))
    }

    var result: [MarkdownInline] {
      nodes.map { node in
        switch node {
        case .text(let units): return .text(units.string)
        case .done(let inline): return inline
        }
      }
    }
  }

  /// `parseInline(text, note)`: one line's inline markup, as nodes. `note`
  /// hears about anything it had to leave as plain words.
  public static func parseInline(_ text: String?, note: (String) -> Void = { _ in }) -> [MarkdownInline] {
    parseInline(units: (text ?? "").units, note: note)
  }

  static func parseInline(units source: Units, note: (String) -> Void) -> [MarkdownInline] {
    var out = InlineBuilder()
    var i = 0
    while i < source.count {
      let ch = source[i]

      if ch == Unit.backslash, i + 1 < source.count, escapable.contains(source[i + 1]) {
        out.pushText([source[i + 1]])
        i += 2
        continue
      }

      if ch == Unit.backtick {
        let end = source[(i + 1)...].firstIndex(of: Unit.backtick) ?? -1
        if end > i + 1 {
          out.push(.code(Array(source[(i + 1)..<end]).string))
          i = end + 1
          continue
        }
        note("a backtick with no partner")
      }

      if ch == Unit.star, source.unit(at: i + 1) == Unit.star {
        let end = closingBold(source, i + 2)
        let after = source.unit(at: i + 2) ?? Unit.space
        if end != -1 && !Unit.isWhitespace(after) {
          out.push(.strong(parseInline(units: Array(source[(i + 2)..<end]), note: note)))
          i = end + 2
          continue
        }
        note("bold that never closes")
        out.pushText([Unit.star, Unit.star])
        i += 2
        continue
      }

      if ch == Unit.star {
        let next = source.unit(at: i + 1)
        let end = next.map { !Unit.isWhitespace($0) } == true ? closingAsterisk(source, i + 1) : -1
        if end != -1 {
          out.push(.em(parseInline(units: Array(source[(i + 1)..<end]), note: note)))
          i = end + 1
          continue
        }
        note("an asterisk that isn’t emphasis (write \\* for a plain one)")
      }

      if ch == Unit.bang && source.unit(at: i + 1) == Unit.openBracket { note("an image") }

      if ch == Unit.openBracket, let link = matchLink(source, at: i) {
        let children = parseInline(units: link.text, note: note)
        if isSafeHref(units: link.href) {
          out.push(.link(href: link.href.string, children: children))
        } else {
          note("a link this reader won’t follow: \(link.href.string)")
          for child in children {
            if case .text(let value) = child {
              out.pushText(value.units)
            } else {
              out.push(child)
            }
          }
        }
        i += link.length
        continue
      }

      if ch == Unit.less, let next = source.unit(at: i + 1) {
        // /^<\/?[a-z!]/i
        let letter = next == Unit.slash ? source.unit(at: i + 2) : next
        if let letter, Unit.isLower(Unit.asciiLower(letter)) || letter == Unit.bang { note("raw HTML") }
      }

      out.pushText([ch])
      i += 1
    }
    return out.result
  }

  // MARK: Lines

  /// `/^[ \t]*/` with each tab as four spaces.
  static func indentOf(_ line: Units) -> Int {
    var n = 0
    for unit in line {
      if unit == Unit.space {
        n += 1
      } else if unit == Unit.tab {
        n += 4
      } else {
        break
      }
    }
    return n
  }

  static func isBlank(_ line: Units) -> Bool { line.string.jsTrimmed().isEmpty }

  static func skipSpaces(_ line: Units, _ from: Int) -> Int {
    var i = from
    while i < line.count, Unit.isSpaceOrTab(line[i]) { i += 1 }
    return i
  }

  /// `/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/`: the level and the words.
  static func heading(_ line: Units) -> (level: Int, text: Units)? {
    var n = 0
    while n < line.count, line[n] == Unit.hash { n += 1 }
    guard n >= 1, n <= 6 else { return nil }
    let spaces = skipSpaces(line, n) - n
    guard spaces >= 1 else { return nil }
    // What may follow the words: spaces, hashes, spaces, to the end.
    func closes(_ from: Int) -> Bool {
      var i = skipSpaces(line, from)
      while i < line.count, line[i] == Unit.hash { i += 1 }
      return skipSpaces(line, i) == line.count
    }
    for kept in stride(from: spaces, through: 1, by: -1) {
      let start = n + kept
      // `.` takes no line terminator, and neither does anything after it.
      if line[start...].contains(where: Unit.isLineTerminator) { return nil }
      guard start < line.count else { continue }
      for end in (start + 1)...line.count where closes(end) {
        return (n, Array(line[start..<end]))
      }
    }
    return nil
  }

  /// `/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/`.
  static func isRule(_ line: Units) -> Bool {
    var i = skipSpaces(line, 0)
    guard i < line.count else { return false }
    let mark = line[i]
    guard mark == Unit.hyphen || mark == Unit.star || mark == Unit.underscore else { return false }
    var run = 0
    while i < line.count, line[i] == mark {
      run += 1
      i += 1
    }
    return run >= 3 && skipSpaces(line, i) == line.count
  }

  /// `/^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/`: the marker and the words.
  static func listItem(_ line: Units) -> (marker: Units, text: Units)? {
    var i = skipSpaces(line, 0)
    let markerStart = i
    guard i < line.count else { return nil }
    if line[i] == Unit.hyphen || line[i] == Unit.star || line[i] == Unit.plus {
      i += 1
    } else {
      var digits = 0
      while i < line.count, Unit.isDigit(line[i]) {
        digits += 1
        i += 1
      }
      guard digits >= 1, digits <= 9, i < line.count, line[i] == Unit.dot || line[i] == Unit.closeParen else { return nil }
      i += 1
    }
    let markerEnd = i
    i = skipSpaces(line, i)
    guard i > markerEnd else { return nil }
    if line[i...].contains(where: Unit.isLineTerminator) { return nil }
    return (Array(line[markerStart..<markerEnd]), Array(line[i...]))
  }

  /// `/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/`.
  static func isTableDivider(_ line: Units) -> Bool {
    // `:?-{3,}:?` at `from`: where it ends, or nil.
    func cell(_ from: Int) -> Int? {
      var i = from
      if line.unit(at: i) == Unit.colon { i += 1 }
      var dashes = 0
      while i < line.count, line[i] == Unit.hyphen {
        dashes += 1
        i += 1
      }
      guard dashes >= 3 else { return nil }
      if line.unit(at: i) == Unit.colon { i += 1 }
      return i
    }
    var i = skipSpaces(line, 0)
    if line.unit(at: i) == Unit.bar { i += 1 }
    i = skipSpaces(line, i)
    guard let first = cell(i) else { return false }
    i = skipSpaces(line, first)
    while line.unit(at: i) == Unit.bar, let next = cell(skipSpaces(line, i + 1)) {
      i = skipSpaces(line, next)
    }
    if line.unit(at: i) == Unit.bar { i += 1 }
    return skipSpaces(line, i) == line.count
  }

  /// A table row's cells, split on the bars that aren't escaped.
  static func tableCells(_ line: Units) -> [Units] {
    var cells: [Units] = []
    var cell: Units = []
    let text = line.string.jsTrimmed().units
    var i = 0
    while i < text.count {
      if text[i] == Unit.backslash && text.unit(at: i + 1) == Unit.bar {
        cell.append(Unit.bar)
        i += 1
      } else if text[i] == Unit.bar {
        cells.append(cell)
        cell = []
      } else {
        cell.append(text[i])
      }
      i += 1
    }
    cells.append(cell)
    if text.first == Unit.bar, !cells.isEmpty { cells.removeFirst() }
    if text.last == Unit.bar, !(text.count >= 2 && text[text.count - 2] == Unit.backslash), !cells.isEmpty { cells.removeLast() }
    return cells.map { $0.string.jsTrimmed().units }
  }

  /// A table starts with a row of headings and, under it, a row of dashes
  /// with as many cells. The bars are required on the dashes.
  static func startsTable(_ lines: [Units], _ i: Int) -> Bool {
    guard lines[i].contains(Unit.bar), i + 1 < lines.count else { return false }
    let divider = lines[i + 1]
    guard divider.contains(Unit.bar), isTableDivider(divider) else { return false }
    return tableCells(divider).count == tableCells(lines[i]).count
  }

  static func isOrderedMarker(_ marker: Units) -> Bool { marker.contains(where: Unit.isDigit) }

  /// Read a list starting at `lines[start]`, whose items sit at `indent`.
  static func readList(_ lines: [Units], _ start: Int, _ indent: Int, _ note: (String) -> Void) -> (block: MarkdownList, next: Int) {
    let first = listItem(lines[start])!
    let ordered = isOrderedMarker(first.marker)
    var list = MarkdownList(ordered: ordered, start: ordered ? parseLeadingInt(first.marker) : nil, items: [])
    var i = start
    var text: Units?
    var sub: MarkdownList?

    func close() {
      guard let words = text else { return }
      list.items.append(MarkdownListItem(children: parseInline(units: words, note: note), sub: sub))
      text = nil
      sub = nil
    }

    while i < lines.count {
      let line = lines[i]
      if isBlank(line) {
        // A blank line stays inside the list only when the list carries on
        // after it: another item here, or something indented under this one.
        var next = i + 1
        while next < lines.count, isBlank(lines[next]) { next += 1 }
        if next >= lines.count { break }
        let carriesOn: Bool
        if let item = listItem(lines[next]) {
          let depth = indentOf(lines[next])
          carriesOn = depth >= indent && (depth > indent || isOrderedMarker(item.marker) == ordered)
        } else {
          carriesOn = indentOf(lines[next]) > indent
        }
        if !carriesOn { break }
        i = next
        continue
      }
      let item = listItem(line)
      let depth = indentOf(line)
      if item != nil && depth < indent { break }
      if item != nil && depth >= indent + 2 {
        if text == nil { break }
        let nested = readList(lines, i, depth, note)
        if sub != nil {
          note("two lists under one item")
        } else {
          sub = nested.block
        }
        i = nested.next
        continue
      }
      if let item {
        // A change of marker (a bullet after a number) starts another list.
        if isOrderedMarker(item.marker) != ordered { break }
        close()
        text = item.text
        i += 1
        continue
      }
      // Words that carry an item on to the next line, indented under it.
      if depth > indent, let words = text, sub == nil {
        text = words + [Unit.space] + line.string.jsTrimmed().units
        i += 1
        continue
      }
      break
    }
    close()
    return (list, i)
  }

  /// `Number.parseInt(marker, 10)` for a marker of digits and `.` or `)`.
  static func parseLeadingInt(_ marker: Units) -> Int {
    marker.prefix(while: Unit.isDigit).reduce(0) { $0 * 10 + Int($1 - 0x30) }
  }

  /// `/^[ \t]*(```|~~~)/`: the fence, or nil.
  static func fence(_ line: Units) -> String? {
    let i = skipSpaces(line, 0)
    guard line.count >= i + 3 else { return nil }
    let three = Array(line[i..<(i + 3)])
    if three == Array("```".utf16) { return "```" }
    if three == Array("~~~".utf16) { return "~~~" }
    return nil
  }

  // MARK: Documents

  /// `parseMarkdown(source)`: the first level-one heading's words, the
  /// blocks in order, and everything it didn't understand.
  public static func parseMarkdown(_ source: String?) -> MarkdownDocument {
    let lines = splitLines((source ?? "").units)
    var blocks: [MarkdownBlock] = []
    var problems: [MarkdownProblem] = []
    var used: [JSKey: Int] = [:]
    var title: String?
    var i = 0

    func anchor(_ text: String) -> String {
      // A second heading with the same words gets -1, a third -2, as GitHub's do.
      let base = slugify(text)
      let seen = used[JSKey(base)] ?? 0
      used[JSKey(base)] = seen + 1
      return seen > 0 ? "\(base)-\(seen)" : base
    }

    while i < lines.count {
      let line = lines[i]
      if isBlank(line) {
        i += 1
        continue
      }
      let lineNumber = i + 1
      let note: (String) -> Void = { problems.append(MarkdownProblem(line: lineNumber, problem: $0)) }

      if let heading = heading(line) {
        let level = heading.level
        if level > maxHeadingLevel { note("a level-\(level) heading (the pages style three levels)") }
        let children = parseInline(units: heading.text, note: note)
        let text = inlineText(children)
        if level == 1 && title == nil { title = text }
        blocks.append(.heading(level: min(level, maxHeadingLevel), id: anchor(text), children: children))
        i += 1
        continue
      }

      if isRule(line) {
        blocks.append(.rule)
        i += 1
        continue
      }

      if startsTable(lines, i) {
        let head = tableCells(line).map { parseInline(units: $0, note: note) }
        var rows: [[[MarkdownInline]]] = []
        i += 2
        while i < lines.count, !isBlank(lines[i]), lines[i].contains(Unit.bar) {
          let rowNumber = i + 1
          let rowNote: (String) -> Void = { problems.append(MarkdownProblem(line: rowNumber, problem: $0)) }
          let cells = tableCells(lines[i]).map { parseInline(units: $0, note: rowNote) }
          if cells.count != head.count { rowNote("a table row with \(cells.count) cells under \(head.count) headings") }
          rows.append(cells)
          i += 1
        }
        blocks.append(.table(head: head, rows: rows))
        continue
      }

      if listItem(line) != nil {
        let read = readList(lines, i, indentOf(line), note)
        blocks.append(.list(read.block))
        i = read.next
        continue
      }

      // /^[ \t]*>/
      if line.unit(at: skipSpaces(line, 0)) == Unit.greater { note("a block quote") }

      // A fenced block isn't something the documents use. It is kept whole,
      // as code, so nothing inside it is read as markup.
      if let fence = fence(line) {
        note("a code block")
        var inside: [String] = []
        i += 1
        while i < lines.count, !lines[i].string.jsTrimmed().units.hasPrefix(fence) {
          inside.append(lines[i].string)
          i += 1
        }
        i += 1
        blocks.append(.paragraph([.code(inside.joined(separator: "\n"))]))
        continue
      }

      // A paragraph: the lines up to a blank one, or to whatever starts
      // another kind of block.
      var words: [Units] = [line.string.jsTrimmed().units]
      i += 1
      while i < lines.count, !isBlank(lines[i]), heading(lines[i]) == nil, !isRule(lines[i]), listItem(lines[i]) == nil,
        !startsTable(lines, i)
      {
        words.append(lines[i].string.jsTrimmed().units)
        i += 1
      }
      let joined = Array(words.joined(separator: [Unit.space]))
      blocks.append(.paragraph(parseInline(units: joined, note: note)))
    }

    return MarkdownDocument(title: title, blocks: blocks, problems: problems)
  }

  /// `.replace(/\r\n?/g, '\n').split('\n')`, by code unit.
  static func splitLines(_ text: Units) -> [Units] {
    var lines: [Units] = []
    var line: Units = []
    var i = 0
    while i < text.count {
      let unit = text[i]
      if unit == Unit.cr || unit == Unit.lf {
        lines.append(line)
        line = []
        if unit == Unit.cr, text.unit(at: i + 1) == Unit.lf { i += 1 }
      } else {
        line.append(unit)
      }
      i += 1
    }
    lines.append(line)
    return lines
  }

  /// `outlineOf(blocks, { level })`: the headings to list as a document's
  /// contents.
  public static func outlineOf(_ blocks: [MarkdownBlock]?, level: Int = 2) -> [MarkdownOutlineEntry] {
    (blocks ?? []).compactMap { block in
      guard case .heading(let l, let id, let children) = block, l == level else { return nil }
      return MarkdownOutlineEntry(id: id, text: inlineText(children), level: l)
    }
  }
}
