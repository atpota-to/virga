// Ports src/styles/theme.css
//
// The cascade for the tokens, as a browser runs it for <html> (and for an
// element inside it): which rules apply for the data-* attributes and the
// viewport, which declaration wins, and what each custom property computes
// to once var() is followed.
//
// - A rule applies when it has no media query or its query holds for the
//   viewport, and one of its selectors matches. theme.css writes its token
//   rules as compounds of `:root` and `[data-x='y']` joined by the
//   descendant combinator; each simple selector counts one towards the
//   specificity (0,1,0 each).
// - The winner for a property is the !important declaration if there is
//   one, then the most specific rule's, then the later one's (a later rule,
//   or later in the same rule).
// - A custom property computes to its declared value with var() replaced by
//   the referenced property's computed value on the same element, which for
//   one it doesn't declare is the one it inherits. A var() to a property
//   with no value, or a cycle of them, leaves it with no value (the CSS
//   Variables spec's "guaranteed-invalid"), not the inherited one.
// - color-mix() is worked out once its colours are known.
//
// `(forced-colors: active)` never holds: no device the app runs on has
// Windows' contrast themes, and their system colours mean nothing outside
// one. iOS's Increase Contrast is data-contrast='high'.

import Foundation

// MARK: - Selectors and media

/// `:root`, or `[name='value']`.
public enum ThemeSimpleSelector: Hashable, Sendable {
  case root
  case attribute(String, String)

  public var css: String {
    switch self {
    case .root: return ":root"
    case .attribute(let name, let value): return "[\(name)='\(value)']"
    }
  }
}

/// A selector as theme.css writes its token rules: compounds of `:root` and
/// attribute selectors, joined by the descendant combinator. Codable as its
/// text.
public struct ThemeSelector: Hashable, Sendable, Codable, CustomStringConvertible {
  public var compounds: [[ThemeSimpleSelector]]

  public init(_ compounds: [[ThemeSimpleSelector]]) {
    self.compounds = compounds
  }

  /// Reads `:root[data-theme='dark'] [data-accent='blue']`; nil for
  /// anything else (a class, a pseudo-class but :root, another combinator).
  public init?(css: String) {
    var compounds: [[ThemeSimpleSelector]] = []
    for word in css.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }) {
      var parts: [ThemeSimpleSelector] = []
      var rest = Substring(word)
      while !rest.isEmpty {
        if rest.hasPrefix(":root") {
          parts.append(.root)
          rest = rest.dropFirst(5)
          continue
        }
        guard rest.hasPrefix("["), let close = rest.firstIndex(of: "]") else { return nil }
        let inside = rest[rest.index(after: rest.startIndex)..<close]
        guard let eq = inside.firstIndex(of: "=") else { return nil }
        let name = String(inside[..<eq])
        var value = Substring(inside[inside.index(after: eq)...])
        if let q = value.first, q == "'" || q == "\"" {
          guard value.count >= 2, value.last == q else { return nil }
          value = value.dropFirst().dropLast()
        }
        guard !name.isEmpty else { return nil }
        parts.append(.attribute(name, String(value)))
        rest = rest[rest.index(after: close)...]
      }
      if parts.isEmpty { return nil }
      compounds.append(parts)
    }
    if compounds.isEmpty { return nil }
    self.compounds = compounds
  }

  public var css: String {
    compounds.map { $0.map(\.css).joined() }.joined(separator: " ")
  }

  public var description: String { css }

  /// One for each simple selector: :root and an attribute selector are both
  /// (0,1,0).
  public var specificity: Int { compounds.reduce(0) { $0 + $1.count } }

  public init(from decoder: Decoder) throws {
    let text = try decoder.singleValueContainer().decode(String.self)
    guard let parsed = ThemeSelector(css: text) else {
      throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "not a token selector: \(text)"))
    }
    self = parsed
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    try c.encode(css)
  }
}

/// A media query a token rule sits in, as written. Codable as its text.
public struct ThemeMedia: Hashable, Sendable, Codable, CustomStringConvertible {
  public enum Feature: Hashable, Sendable {
    case maxWidth(Double)
    case minWidth(Double)
    case forcedColors
  }

  /// The query as the stylesheet writes it.
  public var css: String
  /// What it asks, or nil for a query this can't evaluate (which never holds).
  public var features: [Feature]?

  /// Reads `(max-width: 899px)`, `(min-width: 900px)`,
  /// `(forced-colors: active)`, and those joined by "and".
  public init(_ css: String) {
    self.css = css
    self.features = ThemeMedia.parse(css)
  }

  static func parse(_ css: String) -> [Feature]? {
    var out: [Feature] = []
    for part in css.components(separatedBy: " and ") {
      let trimmed = part.trimmingCharacters(in: .whitespaces)
      guard trimmed.hasPrefix("("), trimmed.hasSuffix(")") else { return nil }
      let inside = trimmed.dropFirst().dropLast()
      let pair = inside.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
      guard pair.count == 2 else { return nil }
      switch pair[0] {
      case "max-width", "min-width":
        guard pair[1].hasSuffix("px"), let n = Double(pair[1].dropLast(2)), n.isFinite else { return nil }
        out.append(pair[0] == "max-width" ? .maxWidth(n) : .minWidth(n))
      case "forced-colors":
        guard pair[1] == "active" else { return nil }
        out.append(.forcedColors)
      default:
        return nil
      }
    }
    return out
  }

  /// Whether it holds for a viewport this wide (in points). Forced colours never do.
  public func matches(viewportWidth: Double) -> Bool {
    guard let features else { return false }
    return features.allSatisfy { feature in
      switch feature {
      case .maxWidth(let n): return viewportWidth <= n
      case .minWidth(let n): return viewportWidth >= n
      case .forcedColors: return false
      }
    }
  }

  public var description: String { css }

  public init(from decoder: Decoder) throws {
    self.init(try decoder.singleValueContainer().decode(String.self))
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    try c.encode(css)
  }
}

// MARK: - Rules

/// One declaration of a token: `--bg: #ffffff`.
public struct ThemeDeclaration: Hashable, Sendable, Codable {
  public var token: ThemeToken
  /// The value as the stylesheet writes it.
  public var css: String
  public var important: Bool
  public var value: ThemeValue

  public init(_ token: ThemeToken, _ css: String, _ value: ThemeValue, important: Bool = false) {
    self.token = token
    self.css = css
    self.value = value
    self.important = important
  }

  enum CodingKeys: String, CodingKey {
    case token = "name"
    case css, important, value
  }
}

/// A rule that sets tokens on <html>: its selectors, the media query it sits
/// in, and its declarations, in order.
public struct ThemeBlock: Hashable, Sendable, Codable {
  public var file: String
  public var selectors: [ThemeSelector]
  public var media: ThemeMedia?
  public var declarations: [ThemeDeclaration]

  public init(file: String, selectors: [ThemeSelector], media: ThemeMedia? = nil, declarations: [ThemeDeclaration]) {
    self.file = file
    self.selectors = selectors
    self.media = media
    self.declarations = declarations
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(file, forKey: .file)
    try c.encode(selectors, forKey: .selectors)
    try c.encode(media, forKey: .media)
    try c.encode(declarations, forKey: .declarations)
  }
}

// MARK: - The cascade

enum ThemeCascade {
  /// An element as the selectors see it: whether it is <html>, and its attributes.
  struct Element {
    var isRoot: Bool
    var attributes: [String: String]
  }

  static func holds(_ compound: [ThemeSimpleSelector], _ el: Element) -> Bool {
    compound.allSatisfy { part in
      switch part {
      case .root: return el.isRoot
      case .attribute(let name, let value):
        guard let actual = el.attributes[name] else { return false }
        return actual.jsEquals(value)
      }
    }
  }

  /// Whether `selector` picks out `el`, whose ancestors (nearest first) are
  /// `ancestors`. Descendant combinators only, so the nearest ancestor that
  /// matches each compound is the one to take.
  static func matches(_ selector: ThemeSelector, _ el: Element, ancestors: [Element]) -> Bool {
    let compounds = selector.compounds
    guard let last = compounds.last, holds(last, el) else { return false }
    var a = 0
    for compound in compounds.dropLast().reversed() {
      while a < ancestors.count && !holds(compound, ancestors[a]) { a += 1 }
      if a == ancestors.count { return false }
      a += 1
    }
    return true
  }

  /// The declaration that wins for each token on `el`, with the order the
  /// tokens were first won in.
  static func declared(
    _ blocks: [ThemeBlock],
    _ el: Element,
    ancestors: [Element],
    viewportWidth: Double
  ) -> [(ThemeToken, ThemeDeclaration)] {
    var winners: [ThemeToken: (declaration: ThemeDeclaration, rank: [Int])] = [:]
    var order: [ThemeToken] = []
    for (b, block) in blocks.enumerated() {
      if let media = block.media, !media.matches(viewportWidth: viewportWidth) { continue }
      var specificity = -1
      for selector in block.selectors where matches(selector, el, ancestors: ancestors) {
        specificity = max(specificity, selector.specificity)
      }
      if specificity < 0 { continue }
      for (k, d) in block.declarations.enumerated() {
        let rank = [d.important ? 1 : 0, specificity, b, k]
        if let previous = winners[d.token] {
          if rank.lexicographicallyPrecedes(previous.rank) || rank == previous.rank { continue }
        } else {
          order.append(d.token)
        }
        winners[d.token] = (d, rank)
      }
    }
    return order.map { ($0, winners[$0]!.declaration) }
  }

  /// The computed value of every custom property on an element: its own
  /// declarations with var() followed, and the rest inherited.
  static func computed(
    _ declarations: [(ThemeToken, ThemeDeclaration)],
    inherited: [ThemeToken: ThemeValue] = [:]
  ) -> [ThemeToken: ThemeValue] {
    var resolver = Resolver(
      declared: Dictionary(declarations.map { ($0.0, $0.1.value) }, uniquingKeysWith: { _, last in last }),
      inherited: inherited
    )
    for (token, _) in declarations { _ = resolver.compute(token) }
    return resolver.out
  }

  struct Resolver {
    enum State { case visiting, done }
    let declared: [ThemeToken: ThemeValue]
    let inherited: [ThemeToken: ThemeValue]
    var out: [ThemeToken: ThemeValue]
    var state: [ThemeToken: State] = [:]

    init(declared: [ThemeToken: ThemeValue], inherited: [ThemeToken: ThemeValue]) {
      self.declared = declared
      self.inherited = inherited
      self.out = inherited
    }

    mutating func compute(_ token: ThemeToken) -> ThemeValue? {
      guard let value = declared[token] else { return inherited[token] }
      switch state[token] {
      case .done: return out[token]
      case .visiting: return nil
      case nil: break
      }
      state[token] = .visiting
      let result = ThemeCascade.substitute(value) { self.compute($0) }
      state[token] = .done
      out[token] = result
      return result
    }
  }

  /// `value` with var() followed through `lookup`, and color-mix() worked
  /// out. Nil when a var() leads nowhere or to a value of the wrong kind (a
  /// colour inside color-mix() or a shadow, a length inside an expression).
  static func substitute(_ value: ThemeValue, _ lookup: (ThemeToken) -> ThemeValue?) -> ThemeValue? {
    func colour(_ v: ThemeValue) -> ThemeValue? {
      guard let out = substitute(v, lookup) else { return nil }
      switch out {
      case .color, .system: return out
      default: return nil
      }
    }
    func length(_ l: ThemeLength) -> ThemeLength? {
      switch l {
      case .variable(let token):
        guard case .length(let found)? = lookup(token) else { return nil }
        return found
      case .operation(let op, let a, let b):
        guard let a = length(a), let b = length(b) else { return nil }
        return .operation(op, a, b)
      case .function(let fn, let args):
        var out: [ThemeLength] = []
        for arg in args {
          guard let v = length(arg) else { return nil }
          out.append(v)
        }
        return .function(fn, out)
      case .value, .number:
        return l
      }
    }
    switch value {
    case .variable(let token):
      return lookup(token)
    case .colorMix(let mix):
      guard let first = colour(mix.first), let second = colour(mix.second) else { return nil }
      guard case .color(let a) = first, case .color(let b) = second else {
        var kept = mix
        kept.first = first
        kept.second = second
        return .colorMix(kept)
      }
      return ThemeColor.mix(a, mix.firstPercent, b, mix.secondPercent).map(ThemeValue.color)
    case .length(let l):
      return length(l).map(ThemeValue.length)
    case .shadow(let layers):
      var out: [ThemeShadowLayer] = []
      for layer in layers {
        guard let x = length(layer.x), let y = length(layer.y) else { return nil }
        var blur: ThemeLength?
        var spread: ThemeLength?
        var color: ThemeValue?
        if let b = layer.blur {
          guard let v = length(b) else { return nil }
          blur = v
        }
        if let s = layer.spread {
          guard let v = length(s) else { return nil }
          spread = v
        }
        if let c = layer.color {
          guard let v = colour(c) else { return nil }
          color = v
        }
        out.append(ThemeShadowLayer(inset: layer.inset, x: x, y: y, blur: blur, spread: spread, color: color))
      }
      return .shadow(out)
    case .color, .system, .fonts, .cubicBezier, .keyword:
      return value
    }
  }

  static func root(_ attributes: [String: String]) -> Element {
    Element(isRoot: true, attributes: attributes)
  }
}

// MARK: - Resolving

extension ThemeTokens {
  /// The data-* attributes the web stamps on <html> for these attributes.
  public static func htmlAttributes(_ attributes: RootAttributes) -> [String: String] {
    [
      "data-sky": attributes.sky.rawValue,
      "data-theme": attributes.theme.rawValue,
      "data-accent": attributes.accent.rawValue,
      "data-contrast": attributes.contrast.rawValue,
      "data-density": attributes.density.rawValue,
    ]
  }

  /// Every token on <html>, computed, for the attributes the web stamps
  /// there (Preferences.rootAttributes) and a viewport this wide in points
  /// (which decides the phone's media queries: 899 and narrower is a phone,
  /// 760 and narrower a narrow one).
  public static func resolve(
    _ attributes: RootAttributes,
    viewportWidth: Double,
    blocks: [ThemeBlock] = ThemeTokens.blocks
  ) -> ResolvedTheme {
    resolve(html: htmlAttributes(attributes), viewportWidth: viewportWidth, blocks: blocks)
  }

  /// `resolve` for <html> carrying these attributes as they are (a value
  /// this version doesn't know, say, which matches no rule of its own).
  public static func resolve(
    html attributes: [String: String],
    viewportWidth: Double,
    blocks: [ThemeBlock] = ThemeTokens.blocks
  ) -> ResolvedTheme {
    let el = ThemeCascade.root(attributes)
    let values = ThemeCascade.computed(
      ThemeCascade.declared(blocks, el, ancestors: [], viewportWidth: viewportWidth))
    return ResolvedTheme(viewportWidth: viewportWidth, values: values)
  }

  /// The tokens inside a swatch: an element in the page carrying
  /// data-accent alone, as Settings draws each accent it offers. It shows
  /// that accent's colours in the page's own theme and contrast; the rest
  /// (the tokens computed from the accent on <html>, like --focus-ring and
  /// --up, among them) it inherits from the page.
  public static func swatch(
    _ accent: Preferences.Accent,
    in attributes: RootAttributes,
    viewportWidth: Double,
    blocks: [ThemeBlock] = ThemeTokens.blocks
  ) -> ResolvedTheme {
    let page = resolve(attributes, viewportWidth: viewportWidth, blocks: blocks)
    let own = swatchDeclarations(accent.rawValue, in: htmlAttributes(attributes), viewportWidth: viewportWidth, blocks: blocks)
    let values = ThemeCascade.computed(own, inherited: page.values)
    return ResolvedTheme(viewportWidth: viewportWidth, values: values)
  }

  /// What a swatch for `accent` declares itself, in the order it wins them.
  static func swatchDeclarations(
    _ accent: String,
    in html: [String: String],
    viewportWidth: Double,
    blocks: [ThemeBlock]
  ) -> [(ThemeToken, ThemeDeclaration)] {
    let el = ThemeCascade.Element(isRoot: false, attributes: ["data-accent": accent])
    return ThemeCascade.declared(blocks, el, ancestors: [ThemeCascade.root(html)], viewportWidth: viewportWidth)
  }
}

// MARK: - The resolved set

/// Every token's computed value for one set of attributes and one viewport:
/// var() followed, color-mix() worked out, lengths still expressions (they
/// are measured where they are used) with `points` to measure them.
public struct ResolvedTheme: Hashable, Sendable {
  /// The viewport the media queries were decided for, in points.
  public var viewportWidth: Double
  public var values: [ThemeToken: ThemeValue]

  public init(viewportWidth: Double, values: [ThemeToken: ThemeValue]) {
    self.viewportWidth = viewportWidth
    self.values = values
  }

  public subscript(_ token: ThemeToken) -> ThemeValue? { values[token] }

  /// Lengths measured against this viewport, at the root's font size, with
  /// no container and no ch.
  public var lengthContext: ThemeLengthContext { ThemeLengthContext(viewportWidth: viewportWidth) }

  public func color(_ token: ThemeToken) -> ThemeColor? { values[token]?.colorValue }

  public func length(_ token: ThemeToken) -> ThemeLength? { values[token]?.lengthValue }

  /// A length token in points, in `context` (this viewport's by default).
  public func points(_ token: ThemeToken, in context: ThemeLengthContext? = nil) -> Double? {
    length(token)?.points(in: context ?? lengthContext)
  }

  public func shadow(_ token: ThemeToken) -> [ThemeShadowLayer]? {
    if case .shadow(let layers)? = values[token] { return layers }
    return nil
  }

  public func fonts(_ token: ThemeToken) -> [String]? {
    if case .fonts(let names)? = values[token] { return names }
    return nil
  }

  public func cubicBezier(_ token: ThemeToken) -> ThemeCubicBezier? {
    if case .cubicBezier(let curve)? = values[token] { return curve }
    return nil
  }

  public func keyword(_ token: ThemeToken) -> String? {
    if case .keyword(let word)? = values[token] { return word }
    return nil
  }

  /// A value of the kit (ThemeKit), with its var() followed in this theme
  /// and color-mix() worked out, as the browser does where it is used.
  public func resolve(_ value: ThemeValue) -> ThemeValue? {
    ThemeCascade.substitute(value) { values[$0] }
  }

  /// A length of the kit, with its var() followed in this theme.
  public func resolve(_ length: ThemeLength) -> ThemeLength? {
    guard case .length(let out)? = resolve(.length(length)) else { return nil }
    return out
  }

  /// A colour of the kit in this theme.
  public func color(of value: ThemeValue) -> ThemeColor? { resolve(value)?.colorValue }

  /// A length of the kit in points, in `context` (this viewport's by default).
  public func points(of length: ThemeLength, in context: ThemeLengthContext? = nil) -> Double? {
    resolve(length)?.points(in: context ?? lengthContext)
  }

  /// The tokens of an element inside this page that declares some itself,
  /// as `.input[aria-invalid='true']` declares --focus-ring and --focus
  /// (ThemeKit.invalidFocusRing, ThemeKit.invalidFocus): its declarations
  /// computed against its own values, the rest inherited from this one.
  public func declaring(_ declarations: [(ThemeToken, ThemeValue)]) -> ResolvedTheme {
    let own = declarations.map { ($0.0, ThemeDeclaration($0.0, "", $0.1)) }
    return ResolvedTheme(viewportWidth: viewportWidth, values: ThemeCascade.computed(own, inherited: values))
  }

  /// Light or dark: the page's color-scheme.
  public var colorScheme: Theme { keyword(.colorScheme) == "dark" ? .dark : .light }
}
