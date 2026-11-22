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

  /// On the web a timer call's refusal (TimerDialog's `outcome.error`) is
  /// the requester's error itself; here the timer service hands it back as
  /// a TimerServiceError, which must say the same.
  @Test func aTimerRefusalReadsAsTheRequestersError() {
    let refusals: [(Int, JSONValue?)] = [
      (409, ["success": false, "error": "quota", "code": "QUOTA_EXCEEDED", "feature": "postTimers", "limit": 1]),
      (409, ["success": false, "error": "quota", "code": "QUOTA_EXCEEDED", "feature": "conditionalTimers", "limit": 3]),
      (400, ["success": false, "error": "the delete time must be after the post goes out"]),
      (400, ["success": false, "error": "monthly_limit"]),
      (409, ["success": false, "error": "no", "code": "NOT_REARMABLE"]),
      (409, ["success": false, "code": "MEDIA_MISSING"]),
      (502, nil),
      (401, ["success": false, "error": "Sign in again.", "code": "SIGNED_OUT"]),
      (200, ["success": false, "error": "a thread can have at most 25 posts"]),
    ]
    for (status, body) in refusals {
      let backend = BackendClient.requestError(status, body)
      let web = ScheduledPostError.scheduleErrorMessage(backend)
      #expect(ScheduledPostError.scheduleErrorMessage(backend.timerServiceError) == web, "\(status) \(body ?? .null)")
    }
    let offline = BackendError(message: "Couldn’t reach Virga’s server.", status: 0, code: "NETWORK_ERROR")
    #expect(
      ScheduledPostError.scheduleErrorMessage(offline.timerServiceError)
        == "Couldn’t reach Virga’s server. Check the connection and try again.")
    // The service's own coded refusals read by their codes.
    #expect(
      ScheduledPostError.scheduleErrorMessage(
        TimerServiceError(code: "NEEDS_BACKEND", message: "Timers need this account signed in through Virga’s server."))
        == "Scheduling needs this account signed in through Virga’s server. Reconnect it for a longer session.")
    #expect(
      ScheduledPostError.scheduleErrorMessage(
        TimerServiceError(code: "TIMER_PROBLEM", message: "pick a later delete time", name: "Error"))
        == "pick a later delete time")
    let slot = ScheduledPostError.scheduleErrorMessage(
      BackendClient.requestError(409, ["code": "QUOTA_EXCEEDED", "feature": "postTimers", "limit": 1])
        .timerServiceError)
    #expect(slot == SelfDestruct.timerSlotRefusal(["feature": "postTimers", "limit": 1]))
  }
}
