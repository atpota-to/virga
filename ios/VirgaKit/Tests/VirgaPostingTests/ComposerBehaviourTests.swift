// What fixtures can't hold of the composer's ports: the publish watch's
// timers, the settings model following the bus, the autosaver's own timers.

import Foundation
import Testing
import VirgaCore
@testable import VirgaPosting

/// Timers run by hand: `run(upTo:)` fires every live one due by then.
final class ManualTimers: Sendable {
  let timers = Locked<[(ms: Double, fn: @Sendable () -> Void, live: Bool)]>([])

  var set: PublishWatch.SetTimer {
    { [timers] ms, fn in
      timers.withLock { list -> Int in
        list.append((ms, fn, true))
        return list.count - 1
      }
    }
  }

  var clear: PublishWatch.ClearTimer {
    { [timers] id in timers.withLock { if $0.indices.contains(id) { $0[id].live = false } } }
  }

  func run(upTo ms: Double) {
    let due = timers.withLock { list -> [@Sendable () -> Void] in
      var fns: [@Sendable () -> Void] = []
      for i in list.indices where list[i].live && list[i].ms <= ms {
        list[i].live = false
        fns.append(list[i].fn)
      }
      return fns
    }
    for fn in due { fn() }
  }
}

@Suite struct PublishWatchBehaviour {
  @Test func saysItIsSlowThenGivesUp() {
    let timers = ManualTimers()
    let seen = Locked<[String]>([])
    let watch = ComposerSubmit.createPublishWatch(
      onSlow: { seen.withLock { $0.append("slow") } }, onHard: { seen.withLock { $0.append("hard") } },
      setTimer: timers.set, clearTimer: timers.clear)
    timers.run(upTo: 60_000)
    #expect(seen.withLock { $0 } == ["slow"])
    #expect(!watch.expired)
    timers.run(upTo: 180_000)
    #expect(seen.withLock { $0 } == ["slow", "hard"])
    #expect(watch.expired)
    #expect(watch.stop() == true)
  }

  @Test func stopsQuietlyWhenThePublishEndsFirst() {
    let timers = ManualTimers()
    let seen = Locked<[String]>([])
    let watch = ComposerSubmit.createPublishWatch(
      onSlow: { seen.withLock { $0.append("slow") } }, onHard: { seen.withLock { $0.append("hard") } },
      setTimer: timers.set, clearTimer: timers.clear)
    #expect(watch.stop() == false)
    timers.run(upTo: 1e9)
    #expect(seen.withLock { $0 }.isEmpty)
  }
}

@Suite @MainActor struct PostingSettingsModelBehaviour {
  @Test func followsWritesFromAnotherScreen() async throws {
    let store = InMemoryKeyValueStore()
    let bus = PostingEventBus()
    let one = PostingSettingsModel(did: "did:plc:mira", store: store, target: bus)
    let two = PostingSettingsModel(did: "did:plc:mira", store: store, target: bus)
    let other = PostingSettingsModel(did: "did:plc:other", store: store, target: bus)
    #expect(two.settings.defaultAction == "post")
    try one.update(["defaultAction": "queue", "langs": ["fr"]])
    await two.settle()
    await other.settle()
    #expect(one.settings.defaultAction == "queue")
    #expect(two.settings.defaultAction == "queue")
    #expect(two.settings.langs == ["fr"])
    #expect(other.settings.defaultAction == "post")
    // Taken back to the defaults, and the other screen follows.
    two.reset(["defaultAction"])
    await one.settle()
    #expect(one.settings.defaultAction == "post")
    #expect(one.settings.langs == ["fr"])
    one.reset()
    await two.settle()
    #expect(two.settings.langs == ["en"])
    #expect(store.getItem("virga:posting:did:plc:mira") == "{}")
  }

  @Test func refusesAValueAndWritesNothing() {
    let store = InMemoryKeyValueStore()
    let model = PostingSettingsModel(did: "did:plc:mira", store: store, target: PostingEventBus())
    #expect(throws: PostingSettingsError.self) { try model.update(["requireAltText": "yes"]) }
    #expect(store.getItem("virga:posting:did:plc:mira") == nil)
    #expect(model.settings.requireAltText == false)
  }

  @Test func followsTheAccount() async throws {
    let store = InMemoryKeyValueStore()
    let bus = PostingEventBus()
    _ = try PostingSettingsStore.writePostingSettings("did:plc:other", ["defaultAction": "draft"], store: store, target: bus)
    let model = PostingSettingsModel(did: "did:plc:mira", store: store, target: bus)
    model.setDid("did:plc:other")
    #expect(model.settings.defaultAction == "draft")
    model.stop()
    _ = try PostingSettingsStore.writePostingSettings("did:plc:other", ["defaultAction": "queue"], store: store, target: bus)
    await model.settle()
    #expect(model.settings.defaultAction == "draft")
  }
}

@Suite struct AutosaverBehaviour {
  @Test func writesOnceTypingStops() async throws {
    let store = InMemoryKeyValueStore()
    let timers = ManualTimers()
    let saver = Autosaver(store: store, now: { 1_000 }, setTimer: timers.set, clearTimer: timers.clear)
    let state: JSONValue = ["posts": [["id": "p1", "text": "hello", "images": []]]]
    saver.save("did:plc:mira", state)
    saver.save("did:plc:mira", state)
    #expect(saver.pending() == "did:plc:mira")
    #expect(store.getItem(Autosave.autosaveKey("did:plc:mira")) == nil)
    timers.run(upTo: Autosave.autosaveDebounceMs)
    #expect(saver.pending() == nil)
    let read = Autosave.readAutosave("did:plc:mira", store: store, now: 2_000)
    #expect(read?.state["posts"]?[0]?["text"] == "hello")
  }

  @Test func theDefaultTimersFireOnTheirOwn() async throws {
    let (written, signal) = AsyncStream<String>.makeStream()
    let store = SignallingStore(signal)
    let saver = Autosaver(store: store, debounceMs: 1)
    saver.save("did:plc:mira", ["posts": [["id": "p1", "text": "later"]]])
    var keys: [String] = []
    for await key in written {
      keys.append(key)
      break
    }
    #expect(keys == [Autosave.autosaveKey("did:plc:mira")])
    #expect(saver.pending() == nil)
  }

}

/// A store that says each key it writes.
final class SignallingStore: KeyValueStore, Sendable {
  let inner = InMemoryKeyValueStore()
  let signal: AsyncStream<String>.Continuation
  init(_ signal: AsyncStream<String>.Continuation) { self.signal = signal }
  func getItem(_ key: String) -> String? { inner.getItem(key) }
  func setItem(_ key: String, _ value: String) throws {
    try inner.setItem(key, value)
    signal.yield(key)
  }
  func removeItem(_ key: String) { inner.removeItem(key) }
  func allKeys() -> [String] { inner.allKeys() }
}

@Suite @MainActor struct ComposerStateModelBehaviour {
  @Test func dispatchesAndKeepsEachChange() throws {
    let store = InMemoryKeyValueStore()
    let timers = ManualTimers()
    let saver = Autosaver(store: store, now: { 1_000 }, setTimer: timers.set, clearTimer: timers.clear)
    let model = ComposerStateModel(asDid: "did:plc:mira", autosaver: saver, now: { 1_000 }, session: AutosaveSession())
    #expect(model.isEmpty)
    model.dispatch(.setText(index: 0, text: "hello"))
    #expect(model.state.posts.first?.text == "hello")
    #expect(!model.isEmpty)
    #expect(saver.pending() == "did:plc:mira")
    timers.run(upTo: Autosave.autosaveDebounceMs)
    let kept = Autosave.readAutosave("did:plc:mira", store: store, now: 2_000)
    #expect(kept?.state["posts"]?[0]?["text"] == "hello")
    model.dispatch(.addPost())
    #expect(model.state.posts.count == 2)
    let actions = model.actions(defaultAction: "post", queue: nil, caps: ComposerCaps(canSchedule: false))
    #expect(actions.primary == "post")
    model.dispatch(.setText(index: 0, text: String(repeating: "x", count: 301)))
    #expect(model.problems(now: Date(timeIntervalSince1970: 0)).contains { $0.postIndex == 0 })
    model.cancelAutosave()
    #expect(saver.pending() == nil)
  }

  /// Composer.jsx's wroteFor: an empty state clears only an entry this
  /// composer wrote, so switching to an account with a post kept for it
  /// never wipes that post.
  @Test func anEmptyStateClearsOnlyWhatItWrote() throws {
    let store = InMemoryKeyValueStore()
    let session = AutosaveSession()
    let timers = ManualTimers()
    let saver = Autosaver(
      store: store, now: { 1_000 }, currentDid: nil, setTimer: timers.set, clearTimer: timers.clear)
    let kept: JSONValue = ["posts": [["id": "k1", "text": "kept for wren", "images": []]]]
    #expect(Autosave.writeAutosave("did:plc:wren", kept, store: store, now: 1_000) != nil)
    let model = ComposerStateModel(asDid: "did:plc:mira", autosaver: saver, now: { 1_000 }, session: session)
    #expect(saver.pending() == nil)
    // Nothing written for wren: moving there with nothing on screen leaves its post.
    model.dispatch(.setAsDid("did:plc:wren"))
    #expect(saver.pending() == nil)
    timers.run(upTo: 10_000)
    #expect(Autosave.readAutosave("did:plc:wren", store: store, now: 2_000)?.state["posts"]?[0]?["text"] == "kept for wren")
    // Written for, then emptied: that clears it, in both layers.
    model.dispatch(.setText(index: 0, text: "mine"))
    #expect(saver.pending() == "did:plc:wren")
    #expect(Autosave.loadSessionDraft("did:plc:wren", session: session)?.state["posts"]?[0]?["text"] == "mine")
    timers.run(upTo: 20_000)
    model.dispatch(.setText(index: 0, text: ""))
    #expect(saver.pending() == "did:plc:wren")
    timers.run(upTo: 30_000)
    #expect(Autosave.readAutosave("did:plc:wren", store: store, now: 2_000) == nil)
    #expect(Autosave.loadSessionDraft("did:plc:wren", session: session) == nil)
    // Once cleared, a further empty change writes nothing.
    model.dispatch(.setLangs(["fr"]))
    #expect(model.state.langs == ["fr"])
    #expect(saver.pending() == nil)
  }

  @Test func aLoadForgetsWhatItWroteAndKeepsWhatItBrings() throws {
    let store = InMemoryKeyValueStore()
    let session = AutosaveSession()
    let timers = ManualTimers()
    let saver = Autosaver(store: store, now: { 1_000 }, setTimer: timers.set, clearTimer: timers.clear)
    let model = ComposerStateModel(asDid: "did:plc:mira", autosaver: saver, now: { 5 }, session: session)
    model.dispatch(.setText(index: 0, text: "draft one"))
    #expect(saver.pending() == "did:plc:mira")
    // An empty load cancels the waiting write and, written-for forgotten, writes nothing.
    model.load(ComposerModel.emptyComposerState(asDid: "did:plc:mira"))
    #expect(saver.pending() == nil)
    #expect(Autosave.loadSessionDraft("did:plc:mira", session: session)?.state["posts"]?[0]?["text"] == "draft one")
    // A load that brings words is kept at once, with its timer choice.
    var loaded = ComposerModel.emptyComposerState(asDid: "did:plc:mira")
    loaded = ComposerModel.composerReducer(loaded, .setText(index: 0, text: "restored"))
    model.load(loaded, touched: true)
    #expect(model.lifespanTouched)
    #expect(saver.pending() == "did:plc:mira")
    let draft = Autosave.loadSessionDraft("did:plc:mira", session: session)
    #expect(draft?.state["posts"]?[0]?["text"] == "restored")
    #expect(draft?.lifespanTouched == true)
    #expect(draft?.savedAt == 5)
  }

  @Test func aStateWithWordsIsKeptOnceItOpens() {
    let session = AutosaveSession()
    var state = ComposerModel.emptyComposerState(asDid: "did:plc:mira")
    state = ComposerModel.composerReducer(state, .setText(index: 0, text: "opened with words"))
    _ = ComposerStateModel(state, now: { 7 }, session: session)
    #expect(Autosave.loadSessionDraft("did:plc:mira", session: session)?.savedAt == 7)
    _ = ComposerStateModel(asDid: "did:plc:wren", now: { 7 }, session: session)
    #expect(Autosave.loadSessionDraft("did:plc:wren", session: session) == nil)
  }
}
