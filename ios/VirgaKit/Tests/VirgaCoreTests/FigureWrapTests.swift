// FigureWrap against Chromium: a `.figures-value` (500, letter-spacing
// -0.04em, line-height 1, overflow-wrap: anywhere, tabular numerals, the
// unit a span at 0.4em with 3px before it) in a cell of each width, set in
// the bundled Instrument Sans, with each character's line and x read from
// a Range over it. The advances are the face's own at 500 with tabular
// numerals, read in the same browser: 0.6em for a digit, "+", "−" and "%",
// 0.265em for "," "." and "’", 0.499em for "-", 0.197em for a no-break
// space.

import Testing
@testable import VirgaCore

private let em: [Character: Double] = [
  "0": 0.6, "1": 0.6, "2": 0.6, "3": 0.6, "4": 0.6, "5": 0.6, "6": 0.6, "7": 0.6, "8": 0.6, "9": 0.6,
  "+": 0.6, "\u{2212}": 0.6, "%": 0.6, ",": 0.265, ".": 0.265, "\u{2019}": 0.265, "-": 0.499, "\u{00A0}": 0.197,
]

private struct Case: CustomStringConvertible {
  var text: String
  var unit: String?
  var size: Double
  var width: Double
  var lines: [String]
  /// Each character's line and x, as Chromium placed it.
  var spots: [(Int, Double)]

  var description: String { "\(text)\(unit ?? "") at \(size) in \(width)" }
}

private let cases: [Case] = [
  Case(text: "1234567", size: 40, width: 67.1, lines: ["12", "34", "56", "7"],
       spots: [(0, 0), (0, 22.391), (1, 0), (1, 22.391), (2, 0), (2, 22.391), (3, 0)]),
  Case(text: "1234567", size: 40, width: 67.2, lines: ["123", "456", "7"],
       spots: [(0, 0), (0, 22.391), (0, 44.797), (1, 0), (1, 22.391), (1, 44.797), (2, 0)]),
  Case(text: "1,234,567", size: 40, width: 100, lines: ["1,234", ",567"],
       spots: [(0, 0), (0, 22.391), (0, 31.391), (0, 53.797), (0, 76.188), (1, 0), (1, 9), (1, 31.391), (1, 53.797)]),
  Case(text: "1,234,567", size: 40, width: 157.5, lines: ["1,234,56", "7"],
       spots: [(0, 0), (0, 22.391), (0, 31.391), (0, 53.797), (0, 76.188), (0, 98.594), (0, 107.594), (0, 129.984), (1, 0)]),
  Case(text: "1,234,567", size: 47.3, width: 157.5, lines: ["1,234,5", "67"],
       spots: [(0, 0), (0, 26.484), (0, 37.125), (0, 63.609), (0, 90.094), (0, 116.578), (0, 127.219), (1, 0), (1, 26.484)]),
  Case(text: "12,345", size: 70, width: 157.5, lines: ["12,3", "45"],
       spots: [(0, 0), (0, 39.188), (0, 78.391), (0, 94.141), (1, 0), (1, 39.188)]),
  Case(text: "\u{2212}1,204", size: 56, width: 120, lines: ["\u{2212}1,2", "04"],
       spots: [(0, 0), (0, 31.359), (0, 62.719), (0, 75.313), (1, 0), (1, 31.359)]),
  Case(text: "-1,204", size: 56, width: 120, lines: ["-1,2", "04"],
       spots: [(0, 0), (0, 25.703), (0, 57.063), (0, 69.656), (1, 0), (1, 31.359)]),
  Case(text: "+8.6", size: 60, width: 100, lines: ["+8.", "6"],
       spots: [(0, 0), (0, 33.594), (0, 67.188), (1, 0)]),
  Case(text: "4\u{00A0}810\u{00A0}000", size: 40, width: 100, lines: ["4\u{00A0}810", "\u{00A0}000"],
       spots: [(0, 0), (0, 22.391), (0, 28.672), (0, 51.078), (0, 73.469), (1, 0), (1, 6.266), (1, 28.672), (1, 51.078)]),
  Case(text: "1\u{2019}234\u{2019}567", size: 40, width: 120, lines: ["1\u{2019}234\u{2019}", "567"],
       spots: [(0, 0), (0, 22.391), (0, 31.391), (0, 53.797), (0, 76.188), (0, 98.594), (1, 0), (1, 22.391), (1, 44.797)]),
  Case(text: "12.3", unit: "%", size: 40, width: 80, lines: ["12.3", "%"],
       spots: [(0, 0), (0, 22.391), (0, 44.797), (0, 53.797), (1, 3)]),
  Case(text: "12.3", unit: "%", size: 40, width: 88.8, lines: ["12.3%"],
       spots: [(0, 0), (0, 22.391), (0, 44.797), (0, 53.797), (0, 79.203)]),
  Case(text: "12.3", unit: "%", size: 40, width: 88.7, lines: ["12.3", "%"],
       spots: [(0, 0), (0, 22.391), (0, 44.797), (0, 53.797), (1, 3)]),
  Case(text: "99.9", unit: "%", size: 60, width: 130, lines: ["99.9", "%"],
       spots: [(0, 0), (0, 33.594), (0, 67.188), (0, 80.688), (1, 3)]),
  Case(text: "1,204.5", size: 52.5, width: 95, lines: ["1,2", "04.", "5"],
       spots: [(0, 0), (0, 29.391), (0, 41.203), (1, 0), (1, 29.391), (1, 58.797), (2, 0)]),
]

@Suite("FigureWrap: a figure's value breaks where Chromium breaks it")
struct FigureWrapTests {
  @Test(arguments: cases)
  fileprivate func breaksAsChromium(_ c: Case) throws {
    let tracking = -0.04 * c.size
    var advances = c.text.map { em[$0]! * c.size + tracking }
    var leads = Array(repeating: 0.0, count: advances.count)
    let characters = Array(c.text) + Array(c.unit ?? "")
    if let unit = c.unit {
      // `.fig-unit`: 0.4em, no letter-spacing, 3 before it.
      for (index, character) in unit.enumerated() {
        advances.append(em[character]! * c.size * 0.4)
        leads.append(index == 0 ? 3 : 0)
      }
    }
    let spots = FigureWrap.place(advances: advances, leads: leads, maxWidth: c.width)
    var lines = Array(repeating: "", count: FigureWrap.lineCount(spots))
    for (spot, character) in zip(spots, characters) {
      lines[spot.line].append(character)
    }
    #expect(lines == c.lines)
    try #require(spots.count == c.spots.count)
    for (spot, web) in zip(spots, c.spots) {
      #expect(spot.line == web.0)
      // Chromium places glyphs on a 1/64 grid.
      #expect(abs(spot.x - web.1) < 0.05, "x \(spot.x) against \(web.1)")
    }
  }

  @Test func aCharacterWiderThanTheLineHasALineOfItsOwn() {
    let spots = FigureWrap.place(advances: [30, 30, 30], maxWidth: 20)
    #expect(spots == [.init(line: 0, x: 0), .init(line: 1, x: 0), .init(line: 2, x: 0)])
    #expect(FigureWrap.lineCount(FigureWrap.place(advances: [], maxWidth: 20)) == 0)
  }

  @Test func onlyNumbersAreSetACharacterAtATime() {
    for text in ["1,234,567", "12.3%", "\u{2212}1,204", "-12", "+8.6", "4\u{00A0}810", "1\u{2019}234", "42"] {
      #expect(FigureWrap.canSet(text), "\(text)")
    }
    // A single character, a space or a letter, a narrow no-break space,
    // and digits written right to left keep the Text.
    for text in ["7", "\u{2014}", "", "1 234", "12k", "3.2 posts", "1\u{202F}234", "\u{0664}\u{066C}\u{0668}\u{0661}\u{0660}"] {
      #expect(!FigureWrap.canSet(text), "\(text)")
    }
  }
}
