// VirgaCore
//
// The shared ground every other target stands on:
//
// - Lib/: the ports of src/lib/{locale,time,sky,router,preferences}
//   (AppLocale and its formatting over LocaleData, Time, Sky, Router,
//   Preferences and PreferencesModel), and AppConfig, TID and Graphemes.
// - Lexicon/: the atproto records, views and unions the web reads and
//   writes, round-tripping atproto JSON exactly (LexiconCoding.swift).
// - Identity/: AT-URIs, DIDs and handles, read as the web reads them.
// - Storage/: KeyValueStore (localStorage) and FileStore (IndexedDB).
// - Support/: JavaScript's semantics where ports need them (strings by
//   UTF-16, numbers, Date, URI coding, Number()), JSONValue and Locked.
//
// See ios/PORTING.md for the conventions every file here follows.

import Foundation

/// The module's namespace, for version and identity.
public enum VirgaCoreModule {
  public static let name = "VirgaCore"
}
