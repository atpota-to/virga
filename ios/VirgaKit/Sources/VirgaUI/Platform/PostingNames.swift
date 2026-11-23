// Names VirgaPosting shares with SwiftUI.
//
// SwiftUI has a TextSelection of its own (a text field's selection, from
// iOS 18) and a LibraryItem (DeveloperToolsSupport's, for Xcode's library),
// so in a file that imports both SwiftUI and VirgaPosting a bare
// `TextSelection` or `LibraryItem` is ambiguous and Xcode refuses it. In
// VirgaUI they are always VirgaPosting's: a declaration in this module
// comes before an imported one, so these settle every file at once.

import VirgaPosting

/// VirgaPosting's `{ start, end }` in UTF-16 units, as the web's editor keeps it.
typealias TextSelection = VirgaPosting.TextSelection

/// VirgaPosting's item on a library shelf.
typealias LibraryItem = VirgaPosting.LibraryItem
