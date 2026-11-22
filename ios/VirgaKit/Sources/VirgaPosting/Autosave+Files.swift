// Ports src/posting/autosave.js (collectPreviewUrls and previewUrlIsHeld, for the files behind the previews)
//
// The web lets go of a preview's object URL once neither the composer nor
// any kept or set-aside post shows it. On iOS a preview is the file itself
// (a temporary file, its path the ComposerFile's `ref`), so the same test
// decides when that file may be deleted: these are collectPreviewUrls and
// previewUrlIsHeld over the files a state holds.

import Foundation
import VirgaCore

extension Autosave {
  /// Every local file a state holds: each image's and the video's file and
  /// a card's picked thumbnail (their `ref`s), and any preview that is a
  /// `file:` address (its path), in order, once each.
  public static func collectFileRefs(_ state: JSONValue?) -> [String] {
    var refs: [String] = []
    var seen = Set<JSKey>()
    func add(_ ref: String?) {
      guard let ref, !ref.isEmpty, seen.insert(JSKey(ref)).inserted else { return }
      refs.append(ref)
    }
    func file(_ value: JSONValue?) { add(ComposerFile(json: value)?.ref) }
    func preview(_ value: JSONValue?) {
      guard let text = value?.stringValue, PostingJS.hasPrefix(text, "file:"), let url = URL(string: text), url.isFileURL
      else { return }
      add(url.path)
    }
    for post in ComposerJS.list(ComposerJS.or(state?["posts"], nil)) {
      for image in ComposerJS.list(ComposerJS.or(post["images"], nil)) {
        file(image["file"])
        preview(image["previewUrl"])
      }
      file(post["video"]?["file"])
      preview(post["video"]?["previewUrl"])
      file(post["card"]?["thumbFile"])
      preview(post["card"]?["thumb"])
    }
    return refs
  }

  /// Whether a file may be deleted: only when neither `state` nor any
  /// account's kept or set-aside post still holds it.
  public static func fileRefIsHeld(_ ref: String, _ state: JSONValue?, session: AutosaveSession = .shared) -> Bool {
    func holds(_ s: JSONValue?) -> Bool { collectFileRefs(s).jsIncludes(ref) }
    if holds(state) { return true }
    if session.drafts.withLock({ Array($0.values) }).contains(where: { holds($0.state) }) { return true }
    return session.aside.withLock({ Array($0.values) }).contains { $0.contains { holds($0.state) } }
  }
}
