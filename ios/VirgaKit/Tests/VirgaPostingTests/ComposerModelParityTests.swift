// composerModel.js held to composer.composerModel: the normalizers, every
// reducer action, the validation messages and the text pipeline.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct ComposerModelParity {
  static let f = "composer.composerModel"

  @Test func constants() throws {
    for c in try cases(Self.f, "constants") {
      check(
        [
          "MAX_POSTS": .number(Double(ComposerModel.maxPosts)),
          "MAX_IMAGES": .number(Double(ComposerModel.maxImages)),
          "MAX_POST_GRAPHEMES": .number(Double(ComposerModel.maxPostGraphemes)),
          "MAX_POST_BYTES": .number(Double(ComposerModel.maxPostBytes)),
          "MAX_LANGS": .number(Double(ComposerModel.maxLangs)),
          "SCHEDULE_MIN_LEAD_MS": .number(ComposerModel.scheduleMinLeadMs),
          "SCHEDULE_MAX_DAYS": .number(ComposerModel.scheduleMaxDays),
          "ADULT_LABELS": .array(ComposerModel.adultLabels.map(JSONValue.string)),
          "SELF_LABELS": .array(ComposerModel.selfLabels.map(JSONValue.string)),
        ], c)
    }
  }

  @Test func emptyComposerState() throws {
    for c in try cases(Self.f, "emptyComposerState") {
      checkCanon(ComposerModel.emptyComposerState(asDid: c.input["asDid"], defaults: c.input["defaults"]).json, c)
    }
  }

  @Test func emptyPost() throws {
    for c in try cases(Self.f, "emptyPost") { checkCanon(ComposerModel.emptyPost().json, c) }
    #expect(ComposerModel.emptyPost().id != ComposerModel.emptyPost().id)
  }

  @Test func normalizePost() throws {
    for c in try cases(Self.f, "normalizePost") { checkCanon(ComposerModel.normalizePost(c.input["raw"]).json, c) }
  }

  @Test func normalizeComposerState() throws {
    for c in try cases(Self.f, "normalizeComposerState") {
      checkCanon(ComposerModel.normalizeComposerState(c.input["raw"]).json, c)
    }
  }

  @Test func composerReducer() throws {
    for c in try cases(Self.f, "composerReducer") {
      var state = c["state"]
      var states: [JSONValue] = []
      for action in c["actions"].arrayValue ?? [] {
        state = ComposerModel.composerReducer(state, action)
        states.append(state)
      }
      checkCanon(.array(states), c)
    }
  }

  @Test func postHasContent() throws {
    for c in try cases(Self.f, "postHasContent") { check(.bool(ComposerModel.postHasContent(c.input["post"])), c) }
  }

  @Test func isEmptyComposer() throws {
    for c in try cases(Self.f, "isEmptyComposer") { check(.bool(ComposerModel.isEmptyComposer(c.input["state"])), c) }
  }

  @Test func selfLabels() throws {
    for c in try cases(Self.f, "labelsToSelfLabels") {
      check(ComposerModel.labelsToSelfLabels(c.input["labels"]) ?? .null, c, strictNulls: true)
    }
    for c in try cases(Self.f, "selfLabelsToLabels") {
      check(.array(ComposerModel.selfLabelsToLabels(c.input["selfLabels"]).map(JSONValue.string)), c)
    }
  }

  @Test func validateComposer() throws {
    for c in try cases(Self.f, "validateComposer") {
      let calls = Locked(0)
      let check: ((JSONValue) -> String?)?
      switch c["lifespan"].stringValue {
      case "passed": check = { _ in calls.withLock { $0 += 1 }; return "That time has passed." }
      case "fine": check = { _ in calls.withLock { $0 += 1 }; return nil }
      case "number": check = { _ in calls.withLock { $0 += 1 }; return "42" }
      default: check = nil
      }
      let problems = ComposerModel.validateComposer(
        c.input["state"], now: c["now"].doubleValue ?? 0, forSchedule: c["forSchedule"] == true,
        requireAltText: c["requireAltText"] == true, lifespanProblem: check, timeZone: ComposerFixtures.zone(c))
      VirgaPostingTests.check(
        ["problems": json(problems), "calls": .number(Double(calls.withLock { $0 }))], c, strictNulls: true)
    }
  }

  @Test func resolvePostTexts() async throws {
    for c in try cases(Self.f, "resolvePostTexts") {
      let texts = try await ComposerModel.resolvePostTexts(
        c.input["state"], resolveMention: ComposerFixtures.tableResolver(c["table"]),
        validationCache: MentionValidationCache())
      check(json(texts), c)
    }
  }
}

@Suite struct ComposerModelBehaviour {
  @Test func cancelledBeforeItStartsThrowsAbortError() async {
    let task = Task {
      withUnsafeCurrentTask { $0?.cancel() }
      return try await ComposerModel.resolvePostTexts(ComposerModel.emptyComposerState(asDid: "did:plc:me"))
    }
    do {
      _ = try await task.value
      Issue.record("expected a cancellation")
    } catch let error as ComposerCancelledError {
      #expect(error.name == "AbortError")
      #expect(error.localizedDescription == "Cancelled.")
    } catch {
      Issue.record("unexpected \(error)")
    }
  }

  @Test func typedActionsBuildTheWebsObjects() {
    var state = ComposerModel.emptyComposerState(asDid: "did:plc:me", langs: ["en"])
    state = ComposerModel.composerReducer(state, .setText(index: 0, text: "hello"))
    state = ComposerModel.composerReducer(state, .addPost())
    state = ComposerModel.composerReducer(state, .setText(index: 1, text: "world"))
    state = ComposerModel.composerReducer(state, .setLabels(["porn", "nudity"]))
    state = ComposerModel.composerReducer(state, .setSchedule(.at("2026-12-01T00:00:00.000Z")))
    #expect(state.posts.map(\.text) == ["hello", "world"])
    #expect(state.labels == ["nudity"])
    #expect(state.langs == ["en"])
    #expect(state.schedule?.mode == "at")
    #expect(state.gates.quotes)
    #expect(!ComposerModel.isEmptyComposer(state))
    let image = ComposerImage(json: ["id": "i1", "file": ComposerFile(name: "a.jpg", type: "image/jpeg", size: 3).json])
    state = ComposerModel.composerReducer(state, .addImages(index: 0, images: [image]))
    #expect(state.posts[0].images.first?.file?.size == 3)
    #expect(state.posts[0].images.first?.alt == "")
    // Encodes to the web's JSON and back.
    let data = try! JSONEncoder().encode(state)
    #expect(try! JSONDecoder().decode(ComposerState.self, from: data) == state)
  }
}
