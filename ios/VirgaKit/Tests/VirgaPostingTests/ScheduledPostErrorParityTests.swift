// schedule/scheduledPostError.js held to scheduling.scheduledPostError: a
// failed row's stored error, a thrown error and a refused reorder, word for
// word.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct ScheduledPostErrorParity {
  static let f = "scheduling.scheduledPostError"

  @Test func friendlyScheduleError() throws {
    for c in try cases(Self.f, "friendlyScheduleError") {
      check(.string(ScheduledPostError.friendlyScheduleError(c.input["raw"], c.input["code"])), c)
    }
  }

  @Test func quotaMessage() throws {
    for c in try cases(Self.f, "quotaMessage") {
      check(.string(ScheduledPostError.quotaMessage(c.input["payload"])), c)
    }
  }

  @Test func scheduleErrorMessage() throws {
    for c in try cases(Self.f, "scheduleErrorMessage") {
      check(.string(ScheduledPostError.scheduleErrorMessage(c.input["err"])), c)
    }
  }

  @Test func reorderRefusal() throws {
    for c in try cases(Self.f, "reorderRefusal") {
      check(ScheduledPostError.reorderRefusal(c.input["err"]).map(JSONValue.string) ?? .null, c)
    }
  }
}

@Suite struct ScheduledPostErrorBehaviour {
  @Test func aThrownBackendErrorReadsAsItsObject() {
    let quota = BackendError(
      message: "quota", status: 409, code: "QUOTA_EXCEEDED", payload: ["feature": "scheduledPosts", "limit": 3])
    #expect(
      ScheduledPostError.scheduleErrorMessage(quota)
        == "This account can keep 3 scheduled posts at a time, and they’re all in use.")
    let sentence = BackendError(message: "Virga’s server answered 400", status: 400, detail: "a thread can have at most 25 posts")
    #expect(ScheduledPostError.scheduleErrorMessage(sentence) == "A thread can have at most 25 posts.")
    let offline = BackendError(name: "TypeError", message: "Couldn’t reach Virga’s server.", status: 0, code: "NETWORK_ERROR")
    #expect(
      ScheduledPostError.scheduleErrorMessage(offline)
        == "Couldn’t reach Virga’s server. Check the connection and try again.")
    #expect(ScheduledPostError.reorderRefusal(BackendError(message: "no", status: 404)) == nil)
    #expect(
      ScheduledPostError.reorderRefusal(BackendError(message: "no", status: 409))
        == "One of these posts is already on its way out, so the new order wasn’t saved.")
    #expect(ScheduledPostError.scheduleErrorMessage(nil as (any Error)?) == "")
  }

  @Test func aPlainErrorSaysItsMessageAsASentence() {
    #expect(ScheduledPostError.scheduleErrorMessage(JSError(message: "it broke. try later")) == "It broke. Try later.")
  }
}
