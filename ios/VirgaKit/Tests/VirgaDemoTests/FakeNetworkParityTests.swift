// Parity with harness/fakeNetwork.js createRouter, against
// ios/parity/fixtures/demo-network.fakeNetwork.json: the router's answers to
// a list of requests for every host it routes and some it doesn't, and the
// video service's jobs as the clock moves.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct FakeNetworkParity {
  static let fixture = "demo-network.fakeNetwork"

  /// Each request in turn on one router, as the generator's `replay`.
  static func replay(_ steps: [JSONValue]) async -> [JSONValue] {
    let world = DemoNetwork.world()
    let clock = Locked(DemoNetwork.now)
    let router = DemoRouter(world: world, now: { clock.wrappedValue })
    var job = "null"
    var blob = "null"
    var out: [JSONValue] = []
    for step in steps {
      if let advance = step["advance"]?.doubleValue { clock.withLock { $0 += advance } }
      let url = (step["url"]?.stringValue ?? "").jsReplacingFirst("$job", with: job).jsReplacingFirst("$blob", with: blob)
      do {
        let answer = DemoNetwork.answerOf(try await router.route(DemoNetwork.request(step, url: url)))
        if case .string(let id)? = answer["json"]?["jobStatus"]?["jobId"],
          answer["json"]?["jobStatus"]?["state"]?.stringValue == "JOB_STATE_CREATED"
        {
          job = id
        }
        if case .string(let ref)? = answer["json"]?["jobStatus"]?["blob"]?["ref"]?["$link"] { blob = ref }
        out.append(answer)
      } catch {
        out.append(DemoNetwork.thrown(error))
      }
    }
    return out
  }

  @Test func theRoutersAnswers() async throws {
    let cases = try Parity.cases(Self.fixture, fn: "route")
    #expect(cases.count == 2)
    for c in cases {
      let steps = c["steps"].arrayValue ?? []
      let got = await Self.replay(steps)
      let want = c.output.arrayValue ?? []
      #expect(got.count == want.count, "\(c): \(got.count) answers, expected \(want.count)")
      for (i, (a, b)) in zip(got, want).enumerated() {
        let d = Exact.diff(a, b)
        #expect(d == nil, "\(c) #\(i) \(steps[i]["url"]?.stringValue ?? ""): \(d ?? "")")
      }
    }
  }
}
