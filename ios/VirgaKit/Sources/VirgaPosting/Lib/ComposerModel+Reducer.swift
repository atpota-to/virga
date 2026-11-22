// Ports src/posting/lib/composerModel.js
//
// The composer's reducer. Unknown actions return the state unchanged.
//
// Media rules: a post has one media slot, so adding images drops a video and
// the card, setting a video drops images and the card, and a card isn't
// added beside media. Images stop at four. A record (quote, feed, list,
// starter pack) has its own slot and sits beside any media.
//
// The state is read as the web reads it: the reducer is given states that
// went through normalizeComposerState, and where one that didn't would make
// the web throw (`posts` not an array), the port leaves it unchanged.

import Foundation
import VirgaCore

extension ComposerModel {
  public static func composerReducer(_ state: ComposerState, _ action: ComposerAction) -> ComposerState {
    ComposerState(json: composerReducer(state.json, action.json))
  }

  /// The reducer over the web's plain objects.
  public static func composerReducer(_ state: JSONValue, _ action: JSONValue?) -> JSONValue {
    guard let action, case .object = action, let type = action["type"]?.stringValue else { return state }
    let posts = ComposerJS.list(state["posts"])
    func with(_ key: String, _ value: JSONValue) -> JSONValue {
      var out = ComposerJS.spread(state)
      out[key] = value
      return .object(out)
    }
    func mapPost(_ fn: (JSONValue) -> JSONValue) -> JSONValue {
      guard let index = ComposerJS.integer(action["index"]), index >= 0, index < posts.count else { return state }
      var next = posts
      next[index] = fn(next[index])
      return with("posts", .array(next))
    }
    func withPost(_ post: JSONValue, _ members: [String: JSONValue]) -> JSONValue {
      var out = ComposerJS.spread(post)
      for (key, value) in members { out[key] = value }
      return .object(out)
    }
    func images(_ post: JSONValue) -> [JSONValue] { ComposerJS.list(post["images"]) }
    func move<T>(_ items: [T], _ from: JSONValue?, _ to: JSONValue?) -> [T]? {
      let n = items.count
      guard let f = ComposerJS.integer(from), let t = ComposerJS.integer(to),
        f >= 0, f < n, t >= 0, t < n, f != t
      else { return nil }
      var next = items
      let moved = next.remove(at: f)
      next.insert(moved, at: t)
      return next
    }

    switch type {
    case "setText":
      return mapPost { withPost($0, ["text": .string(ComposerJS.string(action["text"]))]) }

    case "addPost":
      if posts.count >= maxPosts { return state }
      let after = ComposerJS.integer(action["after"]) ?? (posts.count - 1)
      let at = Swift.min(Swift.max(after + 1, 0), posts.count)
      var next = posts
      next.insert(ComposerJS.truthy(action["post"]) ? normalizePost(action["post"]).json : emptyPost().json, at: at)
      return with("posts", .array(next))

    case "removePost":
      guard let index = ComposerJS.integer(action["index"]), index >= 0, index < posts.count else { return state }
      if posts.count == 1 { return with("posts", [emptyPost().json]) }
      var next = posts
      next.remove(at: index)
      return with("posts", .array(next))

    case "movePost":
      guard let next = move(posts, action["from"], action["to"]) else { return state }
      return with("posts", .array(next))

    // One post becomes several, in place: it keeps what it holds (media, a
    // quote, a card) and takes the first text; `rest` follow it. Posts are
    // named by id, so a split can be taken back after the thread has moved.
    case "splitPost":
      guard let at = posts.firstIndex(where: { ComposerJS.strictEquals($0["id"], action["id"]) }) else {
        return state
      }
      let rest = ComposerJS.slice(ComposerJS.list(action["rest"]).map { normalizePost($0).json }, 0, maxPosts - posts.count)
      if rest.isEmpty { return state }
      var next = posts
      next.replaceSubrange(
        at...at, with: [withPost(posts[at], ["text": .string(ComposerJS.string(action["text"]))])] + rest)
      return with("posts", .array(next))

    // The way back: the posts in `remove` go and the first has its text again.
    case "unsplitPost":
      guard posts.contains(where: { ComposerJS.strictEquals($0["id"], action["id"]) }) else { return state }
      let gone = ComposerJS.list(action["remove"]).filter { !ComposerJS.strictEquals($0, action["id"]) }
      let kept = posts.filter { post in !gone.contains(where: { ComposerJS.strictEquals($0, post["id"]) }) }
      return with(
        "posts",
        .array(
          kept.map { post in
            ComposerJS.strictEquals(post["id"], action["id"])
              ? withPost(post, ["text": .string(ComposerJS.string(action["text"]))]) : post
          }))

    // Several posts' texts at once, by id (renumbering a thread).
    case "setTexts":
      let texts = action["texts"]?.objectValue ?? [:]
      func text(_ post: JSONValue) -> String? { ComposerJS.member(texts, post["id"])?.stringValue }
      guard posts.contains(where: { text($0) != nil }) else { return state }
      return with("posts", .array(posts.map { post in text(post).map { withPost(post, ["text": .string($0)]) } ?? post }))

    case "addImages":
      return mapPost { post in
        let incoming = ComposerJS.list(action["images"]).compactMap(normalizeImage)
        if incoming.isEmpty { return post }
        let all = Array((images(post) + incoming).prefix(maxImages))
        return withPost(post, ["images": .array(all), "video": .null, "card": .null])
      }

    case "updateImage":
      return mapPost { post in
        withPost(
          post,
          [
            "images": .array(
              images(post).map { image in
                guard ComposerJS.strictEquals(image["id"], action["id"]) else { return image }
                var out = ComposerJS.spread(image)
                for (key, value) in ComposerJS.spread(action["patch"]) { out[key] = value }
                out["id"] = image["id"]
                return .object(out)
              })
          ])
      }

    case "removeImage":
      return mapPost { post in
        withPost(post, ["images": .array(images(post).filter { !ComposerJS.strictEquals($0["id"], action["id"]) })])
      }

    case "moveImage":
      return mapPost { post in
        guard let next = move(images(post), action["from"], action["to"]) else { return post }
        return withPost(post, ["images": .array(next)])
      }

    case "setVideo":
      return mapPost { post in
        guard let video = normalizeVideo(action["video"]) else { return withPost(post, ["video": .null]) }
        return withPost(post, ["video": video, "images": [], "card": .null])
      }

    case "setRecord":
      return mapPost { withPost($0, ["record": normalizeRecord(action["record"]) ?? .null]) }

    case "setCard":
      return mapPost { post in
        let card = normalizeCard(action["card"])
        if card != nil && hasMedia(post) { return post }
        return withPost(post, ["card": card ?? .null])
      }

    case "setReply":
      return with("reply", ComposerJS.isObject(action["reply"]) ? action["reply"]! : .null)

    case "setTags":
      return with("tags", .array(Tags.normalizeTags(action["tags"]).map(JSONValue.string)))

    case "setLangs":
      return with(
        "langs",
        .array(ComposerJS.unique(ComposerJS.stringList(action["langs"])).prefix(maxLangs).map(JSONValue.string)))

    case "setLabels":
      let labels = ComposerJS.unique(ComposerJS.stringList(action["labels"]).filter { selfLabels.jsIncludes($0) })
      // One adult label at most: the last one chosen wins.
      let adult = labels.filter { adultLabels.jsIncludes($0) }
      let keep = adult.count > 1 ? adult.last : nil
      let kept = keep.map { keep in labels.filter { !adultLabels.jsIncludes($0) || $0.jsEquals(keep) } } ?? labels
      return with("labels", .array(kept.map(JSONValue.string)))

    case "setGates":
      var gates = normalizeGates(action["gates"])
      gates["custom"] = true
      return with("gates", gates)

    case "setDefaultGates":
      if ComposerJS.truthy(state["gates"]?["custom"]) { return state }
      var gates = normalizeGates(action["gates"])
      gates["custom"] = false
      return with("gates", gates)

    case "setAsDid":
      let did = ComposerJS.str(action["did"])
      if did.isEmpty || ComposerJS.strictEquals(.string(did), state["asDid"]) { return state }
      var out = ComposerJS.spread(state)
      out["asDid"] = .string(did)
      out["posts"] = .array(posts.map { dropForeignBlobs($0, did) })
      return .object(out)

    case "setSchedule":
      return with("schedule", normalizeSchedule(action["schedule"]))

    case "setLifespan":
      return with("lifespan", ComposerJS.isObject(action["lifespan"]) ? action["lifespan"]! : ["enabled": false])

    case "setSource":
      return with("source", ComposerJS.isObject(action["source"]) ? action["source"]! : .null)

    case "load", "reset":
      return normalizeComposerState(action["state"]).json

    default:
      return state
    }
  }

  static func hasMedia(_ post: JSONValue) -> Bool {
    !ComposerJS.list(post["images"]).isEmpty || ComposerJS.truthy(post["video"])
  }

  /// A post's media and card thumbnail with the blobs another account
  /// uploaded taken out (they can't be written from `did`), keeping the files.
  static func dropForeignBlobs(_ post: JSONValue, _ did: String) -> JSONValue {
    let images = ComposerJS.list(post["images"]).map { image -> JSONValue in
      if !ComposerJS.truthy(image["blob"]) || ComposerJS.strictEquals(image["blobDid"], .string(did)) { return image }
      return ComposerJS.without(image, ["blob", "blobDid"])
    }
    var video = post["video"]
    if let current = video, current.isTruthy,
      ComposerJS.truthy(current["blob"]) || ComposerJS.truthy(current["jobId"])
        || !ComposerJS.strictEquals(current["status"], "idle"),
      !ComposerJS.strictEquals(current["blobDid"], .string(did))
    {
      var rest = ComposerJS.spread(ComposerJS.without(current, ["blob", "blobDid", "jobId", "error"]))
      rest["status"] = "idle"
      video = .object(rest)
    }
    var card = post["card"]
    if let current = card, ComposerJS.truthy(current["thumbBlob"]),
      !ComposerJS.strictEquals(current["thumbBlobDid"], .string(did))
    {
      card = ComposerJS.without(current, ["thumbBlob", "thumbBlobDid"])
    }
    var out = ComposerJS.spread(post)
    out["images"] = .array(images)
    out["video"] = video
    out["card"] = card
    return .object(out)
  }
}
