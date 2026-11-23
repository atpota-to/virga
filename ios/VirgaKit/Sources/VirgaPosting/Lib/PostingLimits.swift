// The post limits the composer and the thread splitter count against.
// They come from src/posting/lib/composerModel.js (MAX_POST_GRAPHEMES,
// MAX_POST_BYTES), which the composer port (a later wave) brings over whole;
// it reuses these rather than defining its own.

import Foundation

public enum PostingLimits {
  /// The lexicon's cap on a post's text, in grapheme clusters.
  public static let maxPostGraphemes = 300
  /// The lexicon's cap on a post's text, in UTF-8 bytes.
  public static let maxPostBytes = 3000
}
