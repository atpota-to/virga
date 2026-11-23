// collectFileRefs and fileRefIsHeld: previewUrlIsHeld for the files behind
// the previews, which decides when the composer may delete one.

import Foundation
import Testing
import VirgaCore
@testable import VirgaPosting

@Suite @MainActor struct AutosaveFilesBehaviour {
  static let mira = "did:plc:mira"
  static let wren = "did:plc:wren"

  static func file(_ ref: String?) -> ComposerFile {
    ComposerFile(name: "a.jpg", type: "image/jpeg", size: 10, lastModified: 1, ref: ref)
  }

  static func image(_ id: String, _ ref: String) -> ComposerImage {
    ComposerImage(json: [
      "id": .string(id), "file": file(ref).json, "previewUrl": .string(URL(fileURLWithPath: ref).absoluteString),
      "alt": "",
    ])
  }

  @Test func collectsEveryFileAStateHoldsOnce() {
    let i1: JSONValue = ["id": "i1", "file": Self.file("/tmp/composer/a.jpg").json, "previewUrl": "file:///tmp/composer/a.jpg"]
    // No ref, and a remote preview: nothing local.
    let i2: JSONValue = ["id": "i2", "file": Self.file(nil).json, "previewUrl": "https://cdn.bsky.app/img/x@jpeg"]
    let i3: JSONValue = ["id": "i3", "previewUrl": "file:///tmp/composer/b.jpg"]
    let i4: JSONValue = ["id": "i4", "previewUrl": "blob:http://localhost/1"]
    let video: JSONValue = ["file": Self.file("/tmp/composer/v.mov").json, "previewUrl": "file:///tmp/composer/v.mov"]
    let card: JSONValue = ["thumb": "file:///tmp/composer/t.jpg", "thumbFile": Self.file("/tmp/composer/t.jpg").json]
    let p1: JSONValue = ["id": "p1", "images": [i1, i2, i3, i4]]
    let p2: JSONValue = ["id": "p2", "video": video]
    let p3: JSONValue = ["id": "p3", "card": card]
    let state: JSONValue = ["posts": [p1, p2, p3]]
    #expect(
      Autosave.collectFileRefs(state) == [
        "/tmp/composer/a.jpg", "/tmp/composer/b.jpg", "/tmp/composer/v.mov", "/tmp/composer/t.jpg",
      ])
    #expect(Autosave.collectFileRefs(nil).isEmpty)
    #expect(Autosave.collectFileRefs(["posts": "nope"]).isEmpty)
  }

  @Test func heldByTheStateAKeptPostOrOneSetAside() throws {
    let session = AutosaveSession()
    let store = InMemoryKeyValueStore()
    let ref = "/tmp/composer/a.jpg"
    let post: JSONValue = ["id": "p1", "text": "hi", "images": [Self.image("i1", ref).json]]
    let holding: JSONValue = ["asDid": .string(Self.wren), "posts": [post]]
    #expect(!Autosave.fileRefIsHeld(ref, nil, session: session))
    #expect(Autosave.fileRefIsHeld(ref, holding, session: session))
    // Another account's post kept for this run.
    Autosave.saveSessionDraft(Self.wren, holding, now: 1_000, session: session)
    #expect(Autosave.fileRefIsHeld(ref, nil, session: session))
    Autosave.clearSessionDraft(Self.wren, session: session)
    #expect(!Autosave.fileRefIsHeld(ref, nil, session: session))
    // Set aside.
    let id = ComposerRestore.setAsideState(Self.wren, holding, store: store, now: 1_000, session: session)
    #expect(id != nil)
    #expect(Autosave.fileRefIsHeld(ref, nil, session: session))
    Autosave.forgetSessionDrafts(Self.wren, session: session)
    #expect(!Autosave.fileRefIsHeld(ref, nil, session: session))
  }

  /// The composer keeps its post in the session layer on every change, so
  /// an image removed is held by nothing at once and its file may go.
  @Test func anImageRemovedIsHeldByNothing() {
    let session = AutosaveSession()
    let model = ComposerStateModel(asDid: Self.mira, now: { 1_000 }, session: session)
    let ref = "/tmp/composer/a.jpg"
    model.dispatch(.addImages(index: 0, images: [Self.image("i1", ref)]))
    #expect(Autosave.fileRefIsHeld(ref, nil, session: session))
    #expect(Autosave.fileRefIsHeld(ref, model.state.json, session: session))
    let id = model.state.posts[0].images[0].id
    model.dispatch(.removeImage(index: 0, id: id))
    #expect(model.state.posts[0].images.isEmpty)
    #expect(!Autosave.fileRefIsHeld(ref, model.state.json, session: session))
  }
}
