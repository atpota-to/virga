// The design tokens against the stylesheets (ios/parity/cases/ui.theme.js
// and ui.themeKit.js): the Swift tables one for one with the rules as the
// stylesheets write them, the resolver against the cascade for every set of
// attributes the web stamps on <html>, and the arithmetic (color-mix(),
// lengths) at its corners.

import Foundation
import Testing
import VirgaTestSupport
@testable import VirgaCore

/// The fixture's shared table of values, by index, and an encoding cache
/// for the Swift side's.
private struct ValueTable {
  let values: [JSONValue]
  private var cache: [ThemeValue: JSONValue] = [:]

  init() throws {
    let c = try Parity.cases("ui.theme", fn: "values")[0]
    values = c.output.arrayValue ?? []
  }

  func expected(_ index: Substring) -> JSONValue? {
    index == "-" ? nil : Int(index).map { values[$0] }
  }

  mutating func json(_ value: ThemeValue?) -> JSONValue? {
    guard let value else { return nil }
    if let hit = cache[value] { return hit }
    let encoded = try? JSONValue(encoding: value)
    cache[value] = encoded
    return encoded
  }
}

/// Mismatches, collected so a broken table reports its first few by name
/// rather than a flood.
private struct Mismatches {
  var list: [String] = []
  mutating func check(_ actual: JSONValue?, _ expected: JSONValue?, _ label: @autoclosure () -> String) {
    switch (actual, expected) {
    case (nil, nil): return
    case (let a?, let e?):
      if let d = Parity.diff(a, e) { list.append("\(label()): \(d)") }
    default:
      list.append("\(label()): \(actual?.jsonString() ?? "no value") ≠ expected \(expected?.jsonString() ?? "no value")")
    }
  }
  var report: String { list.prefix(20).joined(separator: "\n") + (list.count > 20 ? "\n… \(list.count - 20) more" : "") }
}

private func attributes(_ c: ParityCase) throws -> RootAttributes {
  let sky = try #require(c["sky"].stringValue.flatMap(SkyPhase.init(rawValue:)))
  let theme = try #require(c["theme"].stringValue.flatMap(Theme.init(rawValue:)))
  let accent = try #require(c["accent"].stringValue.flatMap(Preferences.Accent.init(rawValue:)))
  let contrast = try #require(c["contrast"].stringValue.flatMap(Contrast.init(rawValue:)))
  let density = try #require(c["density"].stringValue.flatMap(Preferences.Density.init(rawValue:)))
  return RootAttributes(sky: sky, theme: theme, accent: accent, contrast: contrast, density: density)
}

@Suite struct ThemeTokensParity {
  @Test func everyTokenInOrder() throws {
    let c = try Parity.cases("ui.theme", fn: "tokens")[0]
    let names = (c.output.arrayValue ?? []).compactMap(\.stringValue)
    #expect(ThemeToken.allCases.map(\.rawValue) == names)
  }

  @Test func theRulesAsTheStylesheetsWriteThem() throws {
    let table = try ValueTable()
    let cases = try Parity.cases("ui.theme", fn: "block")
    #expect(ThemeTokens.blocks.count == cases.count, "the stylesheets have \(cases.count) token rules")
    var mismatches = Mismatches()
    for (block, c) in zip(ThemeTokens.blocks, cases) {
      let o = c.output
      mismatches.check(.string(block.file), o["file"], "\(c) file")
      mismatches.check(.array(block.selectors.map { .string($0.css) }), o["selectors"], "\(c) selectors")
      mismatches.check(block.media.map { .string($0.css) } ?? .null, o["media"], "\(c) media")
      let declarations = o["declarations"]?.arrayValue ?? []
      if declarations.count != block.declarations.count {
        mismatches.list.append("\(c): \(block.declarations.count) declarations ≠ expected \(declarations.count)")
        continue
      }
      for (d, e) in zip(block.declarations, declarations) {
        mismatches.check(.string(d.token.rawValue), e["name"], "\(c) name")
        mismatches.check(.string(d.css), e["css"], "\(c) \(d.token.rawValue) css")
        mismatches.check(.bool(d.important), e["important"], "\(c) \(d.token.rawValue) !important")
        let expected = e["value"]?.intValue.map { table.values[$0] }
        mismatches.check(try JSONValue(encoding: d.value), expected, "\(c) \(d.token.rawValue) value")
      }
    }
    #expect(mismatches.list.isEmpty, "\(mismatches.report)")
  }

  @Test func everySetOfAttributesAsTheCascadeHasIt() throws {
    var table = try ValueTable()
    let cases = try Parity.cases("ui.theme", fn: "resolve")
    var mismatches = Mismatches()
    for c in cases {
      let width = try #require(c["width"].doubleValue)
      let theme = ThemeTokens.resolve(try attributes(c), viewportWidth: width)
      let indexes = (c.output["tokens"]?.stringValue ?? "").split(separator: " ")
      #expect(indexes.count == ThemeToken.allCases.count, "\(c)")
      for (token, index) in zip(ThemeToken.allCases, indexes) {
        mismatches.check(table.json(theme[token]), table.expected(index), "\(c) \(token.rawValue)")
      }
    }
    let leastCases: Int = 192 * 3
    #expect(cases.count >= leastCases)
    #expect(mismatches.list.isEmpty, "\(mismatches.report)")
  }

  @Test func swatches() throws {
    var table = try ValueTable()
    var mismatches = Mismatches()
    for c in try Parity.cases("ui.theme", fn: "swatch") {
      let attrs = try attributes(c)
      let width = try #require(c["width"].doubleValue)
      let accent = try #require(c["swatch"].stringValue.flatMap(Preferences.Accent.init(rawValue:)))
      let page = ThemeTokens.resolve(attrs, viewportWidth: width)
      let shown = ThemeTokens.swatch(accent, in: attrs, viewportWidth: width)
      let own = ThemeTokens.swatchDeclarations(
        accent.rawValue, in: ThemeTokens.htmlAttributes(attrs), viewportWidth: width, blocks: ThemeTokens.blocks)
      let pairs = (c.output["own"]?.stringValue ?? "").split(separator: " ").map { $0.split(separator: "=") }
      #expect(own.map(\.0.rawValue) == pairs.map { String($0[0]) }, "\(c): what the swatch declares itself")
      for pair in pairs {
        let token = try #require(ThemeToken(rawValue: String(pair[0])))
        mismatches.check(table.json(shown[token]), table.expected(pair[1]), "\(c) \(token.rawValue)")
      }
      let declared = Set(own.map(\.0))
      for token in ThemeToken.allCases where !declared.contains(token) {
        mismatches.check(table.json(shown[token]), table.json(page[token]), "\(c) \(token.rawValue), inherited")
      }
    }
    #expect(mismatches.list.isEmpty, "\(mismatches.report)")
  }

  @Test func lengthsInPoints() throws {
    for c in try Parity.cases("ui.theme", fn: "points") {
      let length = try c["length"].decode(ThemeLength.self)
      let context = ThemeLengthContext(
        viewportWidth: try #require(c["width"].doubleValue),
        containerWidth: c["containerWidth"].doubleValue,
        fontSize: c["fontSize"].doubleValue ?? 16,
        chWidth: c["chWidth"].doubleValue
      )
      let actual: JSONValue = length.points(in: context).map(JSONValue.number) ?? .null
      #expect(Parity.diff(actual, c.output) == nil, "\(c): \(actual) ≠ \(c.output)")
    }
  }

  @Test func colorMix() throws {
    for c in try Parity.cases("ui.theme", fn: "colorMix") {
      let first = try c["first"].decode(ThemeColor.self)
      let second = try c["second"].decode(ThemeColor.self)
      let mixed = ThemeColor.mix(first, c["firstPercent"].doubleValue, second, c["secondPercent"].doubleValue)
      let d = Parity.diff(try mixed.map { try JSONValue(encoding: $0) } ?? .null, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  /// Every colour the stylesheets (and the made-up sheets) write, read from
  /// its text as the browser reads it; what isn't a literal reads as nil.
  @Test func colourLiteralsInEverySyntax() throws {
    let table = try ValueTable()
    var declarations: [(css: String, value: JSONValue, where: String)] = []
    for c in try Parity.cases("ui.theme", fn: "block") {
      for d in c.output["declarations"]?.arrayValue ?? [] {
        guard let css = d["css"]?.stringValue, let i = d["value"]?.intValue else { continue }
        declarations.append((css, table.values[i], "\(c)"))
      }
    }
    for c in try Parity.cases("ui.theme", fn: "cascade") {
      for block in c["blocks"].arrayValue ?? [] {
        for d in block["declarations"]?.arrayValue ?? [] {
          guard let css = d["css"]?.stringValue, let value = d["value"] else { continue }
          declarations.append((css, value, "\(c)"))
        }
      }
    }
    for c in try Parity.cases("ui.themeKit", fn: "kit") where c["kind"].stringValue == "color" {
      guard let css = c.output["css"]?.stringValue, let value = c.output["value"] else { continue }
      declarations.append((css, value, "\(c)"))
    }
    #expect(declarations.count > 700)
    var mismatches = Mismatches()
    for d in declarations {
      let read = try ThemeColor(css: d.css).map { try JSONValue(encoding: $0) }
      mismatches.check(read, d.value["color"], "\(d.where) \(d.css)")
    }
    #expect(mismatches.list.isEmpty, "\(mismatches.report)")
    for text in ["#ggg", "#12345", "rgb(1 2)", "rgb(1, 2 3)", "rgb(1 2 3 4)", "hsl(1 2% 3% / )", "rgb(nan 0 0)", "red", "var(--ink)"] {
      #expect(ThemeColor(css: text) == nil, "\(text)")
    }
  }

  @Test func madeUpSheets() throws {
    for c in try Parity.cases("ui.theme", fn: "cascade") {
      let blocks = try c["blocks"].decode([ThemeBlock].self)
      var html: [String: String] = [:]
      for (key, value) in c["attrs"].objectValue ?? [:] { html["data-\(key)"] = value.stringValue }
      let theme = ThemeTokens.resolve(html: html, viewportWidth: try #require(c["width"].doubleValue), blocks: blocks)
      for (name, expected) in c.output.objectValue ?? [:] {
        let token = try #require(ThemeToken(rawValue: name))
        let actual = try theme[token].map { try JSONValue(encoding: $0) } ?? .null
        let d = Parity.diff(actual, expected)
        #expect(d == nil, "\(c) \(name): \(d ?? "")")
      }
    }
  }
}

@Suite struct ThemeKitParity {
  @Test func everyMeasureAsItsDeclarationHasIt() throws {
    let cases = try Parity.cases("ui.themeKit", fn: "kit")
    let entries = Dictionary(ThemeKit.entries.map { ($0.name, $0) }, uniquingKeysWith: { first, _ in first })
    #expect(entries.count == ThemeKit.entries.count, "names are unique")
    #expect(ThemeKit.entries.map(\.name) == cases.map(\.id), "the same measures, in the same order")
    for c in cases {
      guard let e = entries[c.id] else {
        Issue.record("ThemeKit has no \(c.id)")
        continue
      }
      let input: JSONValue = [
        "file": .string(e.file), "selector": .string(e.selector), "media": e.media.map(JSONValue.string) ?? .null,
        "property": .string(e.property), "kind": .string(e.kind),
      ]
      #expect(Parity.diff(input, c.input) == nil, "\(c): where it comes from")
      let output: JSONValue = ["css": .string(e.css), "important": .bool(e.important), "value": try JSONValue(encoding: e.value)]
      let d = Parity.diff(output, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  /// Each measure that says var() or color-mix(), through the theme in a few
  /// states, part by part as ui.themeKit.js lays it out: what
  /// `theme.resolve(_:)`, `theme.points(of:)` and `theme.color(of:)` give.
  @Test func everyMeasureThroughTheTheme() throws {
    let entries = Dictionary(ThemeKit.entries.map { ($0.name, $0) }, uniquingKeysWith: { first, _ in first })
    let cases = try Parity.cases("ui.themeKit", fn: "resolved")
    let leastCases: Int = 300
    #expect(cases.count >= leastCases)
    var mismatches = Mismatches()
    for c in cases {
      let name = try #require(c["name"].stringValue)
      let e = try #require(entries[name], "ThemeKit has no \(name)")
      let theme = ThemeTokens.resolve(try attributes(c), viewportWidth: try #require(c["width"].doubleValue))
      mismatches.check(try resolved(e.value, in: theme), c.output, "\(c)")
    }
    #expect(mismatches.list.isEmpty, "\(mismatches.report)")
  }

  /// A field that is the trouble declares --focus-ring and --focus again
  /// (and high contrast --focus once more): `theme.declaring(_:)` with the
  /// kit's values, as DESIGN.md says to use it.
  @Test func anInvalidFieldDeclaresItsOwnRing() throws {
    let cases = try Parity.cases("ui.themeKit", fn: "declaring")
    #expect(cases.count == 4)
    for c in cases {
      let attrs = try attributes(c)
      let theme = ThemeTokens.resolve(attrs, viewportWidth: try #require(c["width"].doubleValue))
      let focus = attrs.contrast == .high ? ThemeKit.highContrastInvalidFocus : ThemeKit.invalidFocus
      let field = theme.declaring([(.focusRing, ThemeKit.invalidFocusRing), (.focus, focus)])
      let actual: JSONValue = [
        "--focus-ring": try field[.focusRing].map { try JSONValue(encoding: $0) } ?? .null,
        "--focus": try field[.focus].map { try JSONValue(encoding: $0) } ?? .null,
      ]
      let d = Parity.diff(actual, c.output, strictNulls: true)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }
}

/// A kit value in a theme, in the shapes ui.themeKit.js's `resolved` cases
/// write: each length as `{ length, px }`, each colour or other value as
/// `{ value }` (with `px` when it is a length), nil where a var() leads
/// nowhere.
private func resolved(_ kit: ThemeKitValue, in theme: ResolvedTheme) throws -> JSONValue {
  func lengthPart(_ l: ThemeLength?) throws -> JSONValue {
    guard let l else { return .null }
    guard let out = theme.resolve(l) else { return ["length": .null, "px": .null] }
    return ["length": try JSONValue(encoding: out), "px": theme.points(of: l).map(JSONValue.number) ?? .null]
  }
  func valuePart(_ v: ThemeValue?) throws -> JSONValue {
    guard let v else { return .null }
    guard let out = theme.resolve(v) else { return ["value": .null] }
    if case .length(let l) = out {
      return ["value": try JSONValue(encoding: out), "px": l.points(in: theme.lengthContext).map(JSONValue.number) ?? .null]
    }
    return ["value": try JSONValue(encoding: out)]
  }
  switch kit {
  case .length(let l):
    return try lengthPart(l)
  case .box(let b):
    return [
      "top": try lengthPart(b.top), "right": try lengthPart(b.right),
      "bottom": try lengthPart(b.bottom), "left": try lengthPart(b.left),
    ]
  case .gap(let g):
    return ["row": try lengthPart(g.row), "column": try lengthPart(g.column)]
  case .value(let v):
    return try valuePart(v)
  case .shadow(let layers):
    return try valuePart(.shadow(layers))
  case .border(let b):
    return ["width": try lengthPart(b.width), "color": try valuePart(b.color)]
  case .gradient(let g):
    return ["stops": .array(try g.stops.map { ["color": try valuePart($0.color), "position": try lengthPart($0.position)] })]
  case .transitions(let list):
    return ["easings": .array(try list.map { try valuePart($0.easing) })]
  case .animation(let a):
    return ["easing": try valuePart(a.easing)]
  case .number, .time, .keyword:
    return .null
  }
}
