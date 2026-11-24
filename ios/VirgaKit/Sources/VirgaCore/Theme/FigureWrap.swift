// Ports src/styles/controls.css (.figures-value: overflow-wrap: anywhere)
//
// Where a figure's value breaks when it is wider than its cell. A number
// ("1,234,567", "+8.6%", "12.3" with its "%") has no place a browser may
// break it, so `overflow-wrap: anywhere` lets it break between any two of
// its characters: each line takes as many as fit, every character counted
// at its advance and the letter-spacing after it, the unit at its own
// advance with its 3 before it, on any line. That is how Chromium breaks
// them with the bundled face, which FigureWrapTests hold this to.
// VirgaUI's FigureLines places the characters where this says, so a value
// that wraps can have the web's line-height of 1.

public enum FigureWrap {
  /// What a value can be made of for it to be set a character at a time.
  /// Measured in Chromium with the bundled face: no two of these that a
  /// number puts side by side are kerned, its tabular figures make the
  /// digits, the signs and "%" one width (0.6em), and nothing among them is
  /// a place a browser would break before it breaks anywhere. Anything
  /// else stays a Text: a space or a letter, digits and signs written right
  /// to left, a single character (which can't wrap), and the narrow
  /// no-break space some locales group digits with, as Chromium drops the
  /// letter-spacing of a number that holds one.
  static let settable: Set<Character> = [
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    ",", ".", "+", "-", "\u{2212}", "%", "\u{00A0}", "\u{2019}",
  ]

  /// Whether `text` (a value and its unit) can be set a character at a time.
  public static func canSet(_ text: String) -> Bool {
    text.count > 1 && text.allSatisfy { settable.contains($0) }
  }

  /// A character's place: its line (from 0) and its x on that line.
  public struct Spot: Equatable, Sendable {
    public var line: Int
    public var x: Double

    public init(line: Int, x: Double) {
      self.line = line
      self.x = x
    }
  }

  /// Each character's place at `maxWidth`.
  /// - Parameters:
  ///   - advances: each character's advance with the letter-spacing after it.
  ///   - leads: the room before each on its line (the unit's margin), on a
  ///     line of its own too; missing ones are none.
  public static func place(advances: [Double], leads: [Double] = [], maxWidth: Double) -> [Spot] {
    var spots: [Spot] = []
    var line = 0
    var x: Double = 0
    var onLine = 0
    for (index, advance) in advances.enumerated() {
      let lead = index < leads.count ? leads[index] : 0
      // A line holds at least one character, however wide. One that fits
      // exactly fits, whatever the last bit of a sum of fractions says.
      if onLine > 0 && x + lead + advance > maxWidth + 0.001 {
        line += 1
        x = 0
        onLine = 0
      }
      spots.append(Spot(line: line, x: x + lead))
      x += lead + advance
      onLine += 1
    }
    return spots
  }

  /// How many lines `spots` take.
  public static func lineCount(_ spots: [Spot]) -> Int {
    (spots.map(\.line).max() ?? -1) + 1
  }
}
