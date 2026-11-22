// The zone an archive puts local days in. The app makes its archive
// environment before anything has set the active zone (it is UTC until
// PreferencesModel sets the device's), and keeps it while the device can
// change zone, so an environment given no zone holds none and the archive
// reads the active one whenever it needs it, as the web reads the
// browser's. A zone given (the demo's, a test's) is kept.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
@testable import VirgaArchive

@MainActor
@Suite struct ArchiveZoneBehaviour {
  private let did = "did:plc:zonetestowner2345678abcd"
  /// 2026-11-14T20:00:00Z: already the 15th in Tokyo.
  private let evening: Double = 1_794_686_400_000

  private func model(timeZone: TimeZone?) -> ArchiveModel {
    let env = ArchiveEnvironment(
      files: nil, registry: AnalyticsStoreRegistry(), transport: MockTransport(), clock: .instant(now: evening),
      didDocuments: PromiseCache(), timeZone: timeZone, locale: "en-US")
    return ArchiveModel(agent: nil, did: did, handle: "owner.test", environment: env)
  }

  @Test func anEnvironmentGivenNoZoneHoldsNone() {
    #expect(ArchiveEnvironment(files: nil).timeZone == nil, "not the zone in force when the app was launched")
  }

  @Test func withoutAZoneTheArchiveReadsTheActiveOne() {
    // Whatever the active zone is now: the archive doesn't keep one of its own.
    #expect(model(timeZone: nil).timeZone.identifier == AppLocale.activeTimeZone().identifier)
  }

  @Test func aZoneGivenIsKeptAndNamesTheExportsDay() throws {
    let tokyo = try #require(TimeZone(identifier: "Asia/Tokyo"))
    let archive = model(timeZone: tokyo)
    #expect(archive.timeZone == tokyo)
    #expect(archive.exportPosts([]).filename == "owner.test-posts-2026-11-15.csv", "the local day, as the web's exportFilename")
  }
}
