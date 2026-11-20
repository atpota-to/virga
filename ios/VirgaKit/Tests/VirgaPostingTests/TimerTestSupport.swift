// Helpers for the timer tests: the timer fixtures are large, so each is
// read and decoded once per run rather than once per function.

import Foundation
import VirgaCore
import VirgaTestSupport

enum TimerFixtures {
  static let loaded = Locked<[String: ParityFixture]>([:])

  /// The cases of `fn` in `fixture`, throwing when there are none (a
  /// renamed generator mustn't leave a test passing over nothing).
  static func cases(_ fixture: String, _ fn: String) throws -> [ParityCase] {
    let file: ParityFixture
    if let cached = loaded.withLock({ $0[fixture] }) {
      file = cached
    } else {
      file = try Parity.load(fixture)
      loaded.withLock { $0[fixture] = file }
    }
    let found = file.cases.filter { $0.fn == fn }
    if found.isEmpty { throw ParityError.noCases(fixture: fixture, fn: fn) }
    return found
  }
}
