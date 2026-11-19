// locale.js's `fmtInt` with the locale passed in, for the Defense modules'
// sentences. The web formats with the active locale; so does nil here
// (AppLocale.fmtInt itself), while a test can name one and leave the
// active formats alone.

import Foundation
import VirgaCore

enum DefenseFormat {
  static func fmtInt(_ n: Double, locale: String?) -> String {
    guard let locale else { return AppLocale.fmtInt(n) }
    let number = n.isNaN || n == 0 ? 0 : n
    return AppLocale.formatNumber(number.jsRounded, locale: locale)
  }
}
