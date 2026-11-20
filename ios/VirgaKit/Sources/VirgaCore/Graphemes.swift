// Ports src/posting/lib/graphemes.js
//
// Grapheme-cluster counting and truncation. AT Protocol lexicon length limits
// count grapheme clusters (an emoji with a skin-tone modifier is one). A Swift
// Character is an extended grapheme cluster, which is what the web app counts
// with Intl.Segmenter, so `String.count` is the measure.

import Foundation

public enum Graphemes {
  /// Length of `text` in grapheme clusters.
  public static func countGraphemes(_ text: String?) -> Int {
    guard let text, !text.isEmpty else { return 0 }
    return text.count
  }

  /// `text` cut to at most `max` grapheme clusters, never splitting one.
  /// Returns the original string when it already fits.
  public static func truncateGraphemes(_ text: String?, _ max: Int) -> String {
    guard let text, !text.isEmpty else { return "" }
    if text.count <= max { return text }
    return String(text.prefix(Swift.max(0, max)))
  }
}
