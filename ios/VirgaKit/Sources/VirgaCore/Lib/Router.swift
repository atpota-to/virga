// Ports src/lib/router.jsx
//
// The app's addresses: the path is the state. On the web the History API
// moves it and `usePath()` reads it; on iOS the shell's navigation state is
// VirgaUI's (a NavigationStack path in the shell port), and these are the
// pure parts both share: splitting a path into its parts, and the address a
// move lands on.
//
//   /                         → the first dashboard
//   /dashboard/:id            a dashboard
//   /reports, /reports/:id    the reports, one report
//   /tools, /tools/:tool      the tools, one tool
//   /settings/:section        settings
//   /posting, /posting/:page  posting (src/posting/routes.js)
//   /intent/compose?text&url&tags
//                             a compose link from elsewhere
//
// The query string is carried along on a move unless the new address has
// one of its own, or `keepQuery: false` says to drop it.

import Foundation

public enum Router {
  /// The address a move to `to` lands on, given the current query string.
  /// The query goes before a fragment (`/privacy#contact` →
  /// `/privacy?x=1#contact`): after it, the query would be part of the
  /// fragment.
  public static func hrefFor(_ to: String, currentSearch: String = "", keepQuery: Bool = true) -> String {
    let at = to.jsIndexOf("#")
    let path = at == -1 ? to : to.jsSlice(0, at)
    let fragment = at == -1 ? "" : to.jsSlice(at)
    let search = keepQuery && !path.contains("?") ? currentSearch : ""
    return "\(path)\(search)\(fragment)"
  }

  /// Split a path into its parts: `/reports/followers` → `["reports",
  /// "followers"]`. Trailing slashes and empty parts are dropped, and each
  /// part is percent-decoded. Throws `JSURIError` ("URI malformed") for a
  /// part `decodeURIComponent` can't read, as the web does.
  public static func pathParts(_ path: String?) throws -> [String] {
    let text = (path?.isEmpty ?? true) ? "/" : path!
    return try text.split(separator: "/", omittingEmptySubsequences: true)
      .map { try JSURI.decodeURIComponent(String($0)) }
  }
}
