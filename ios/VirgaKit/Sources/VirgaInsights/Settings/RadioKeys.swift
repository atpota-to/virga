// Ports src/settings/radioKeys.js
//
// The keys of a radio group, as the ARIA pattern has them: the arrows move
// to the next or the last choice and wrap at the ends, Home and End go to
// the first and the last. Moving chooses, as it does in a native group. On
// iOS a hardware keyboard sends the same keys (VirgaUI maps its key presses
// to these names: "ArrowRight", "Home", ...).
// ios/parity/cases/insights-early.settings.js holds it to the web's.

import Foundation

public enum RadioKeys {
  /// The index a key moves to from `index` in a group of `count`, or nil
  /// for a key the group leaves alone. An index outside the group starts
  /// from the first choice.
  public static func radioKeyTarget(_ key: String, _ index: Int, _ count: Int) -> Int? {
    guard count > 0 else { return nil }
    let at = index >= 0 && index < count ? index : 0
    switch key {
    case "ArrowRight", "ArrowDown": return (at + 1) % count
    case "ArrowLeft", "ArrowUp": return (at - 1 + count) % count
    case "Home": return 0
    case "End": return count - 1
    default: return nil
    }
  }
}
