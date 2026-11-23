// JavaScript's `toLowerCase()` and `toUpperCase()`, for ports that compare
// or store text the web case-folds (handles, hashtags, shortcuts, search).
//
// Both are Unicode's full case mappings, locale-independent, as Swift's
// `lowercased()` and `uppercased()` are (so "İ" lowers to "i̇" and "ß"
// uppers to "SS" in both). The one difference is Greek capital sigma:
// JavaScript lowers it to final "ς" at the end of a word and to "σ"
// elsewhere (Unicode's Final_Sigma condition), where Swift always gives
// "σ" ("ΟΔΟΣ".toLowerCase() is "οδος"; Swift's lowercased() gives "οδοσ").
// ios/parity/cases/core.jsstring.js holds both to Node.

import Foundation

extension String {
  /// `str.toLowerCase()`.
  public func jsLowercased() -> String {
    let scalars = Array(unicodeScalars)
    guard scalars.contains(where: { $0.value == 0x03A3 }) else { return lowercased() }
    var out = String.UnicodeScalarView()
    for (index, scalar) in scalars.enumerated() {
      if scalar.value == 0x03A3 {
        out.append(Self.isFinalSigma(scalars, at: index) ? "\u{03C2}" : "\u{03C3}")
      } else {
        out.append(contentsOf: scalar.properties.lowercaseMapping.unicodeScalars)
      }
    }
    return String(out)
  }

  /// `str.toUpperCase()`: Swift's full uppercase mapping, which is
  /// JavaScript's (no context changes an uppercase mapping).
  public func jsUppercased() -> String {
    uppercased()
  }

  /// Unicode's Final_Sigma (Table 3-17): the sigma follows a cased letter,
  /// with only case-ignorable characters between, and no cased letter
  /// follows it the same way. An ignorable character is skipped even when
  /// it is also cased, as ICU (and so V8) does.
  static func isFinalSigma(_ scalars: [Unicode.Scalar], at index: Int) -> Bool {
    var before = index - 1
    while before >= 0, scalars[before].properties.isCaseIgnorable { before -= 1 }
    guard before >= 0, scalars[before].properties.isCased else { return false }
    var after = index + 1
    while after < scalars.count, scalars[after].properties.isCaseIgnorable { after += 1 }
    return !(after < scalars.count && scalars[after].properties.isCased)
  }
}
