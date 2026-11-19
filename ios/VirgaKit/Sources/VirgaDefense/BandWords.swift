// Ports src/defense/bandWords.js
//
// What each band is called on screen, and what it means, in the words of
// the table in docs/DEFENSE.md. The bands themselves are score.js's (Band).

import Foundation

public enum BandWords {
  /// BAND_WORD: the band's name on screen.
  public static let bandWord: [Band: String] = [
    .protected: "Protected",
    .connected: "Connected",
    .peripheral: "Peripheral",
    .notable: "Notable",
    .unknown: "No connection",
  ]

  /// BAND_MEANS: what the band means, in a sentence.
  public static let bandMeans: [Band: String] = [
    .protected: "You follow them, or they’re one of your own accounts. Nothing will ever add them to a list.",
    .connected: "3 or more of the people you follow follow them, or 1 does and they have 5,000 followers or more.",
    .peripheral: "1 or 2 of the people you follow follow them, or they follow you.",
    .notable: "No connection to you, but they have 10,000 followers or more, or post a lot to a real audience.",
    .unknown: "Nobody you follow follows them, and they don’t follow you. Most of any pile-on.",
  ]

  /// BAND_COUNTED: a band after a number, in a sentence: "494 with no connection, 13 notable".
  public static let bandCounted: [Band: String] = [
    .protected: "protected",
    .connected: "connected",
    .peripheral: "peripheral",
    .notable: "notable",
    .unknown: "with no connection",
  ]
}
