// Ports src/shell/bits.jsx (useSkyTaps)
//
// The easter egg: five taps on the mark, each within a second and a half
// of the last, turn the live sky on (or off again), and a toast says which.
// The count is a value the view keeps; it is told each tap's time and
// answers whether that tap was the fifth. Held to bits.jsx's numbers and
// words by ios/parity/cases/hillside.style.js.

import Foundation

public struct SkyTaps: Hashable, Sendable {
  /// How close a tap must follow the last to count on, in milliseconds.
  public static let window: Double = 1500
  /// Taps that turn it.
  public static let needed = 5
  /// The toast when the live sky has been turned off.
  public static let putAway = "The live sky is put away."
  /// The toast when it has been turned on.
  public static let out = "The live sky is out. Settings › Appearance puts it away again."

  /// The toast for a turn, by whether the live sky was on before it.
  public static func toast(wasOn: Bool) -> String { wasOn ? putAway : out }

  private var n = 0
  private var at: Double = 0

  public init() {}

  /// A tap at `now` (epoch milliseconds, as `Date.now()`): whether it was
  /// the fifth in a row, which turns the live sky.
  public mutating func tap(now: Double) -> Bool {
    n = now - at < Self.window ? n + 1 : 1
    at = now
    if n >= Self.needed {
      n = 0
      return true
    }
    return false
  }
}
