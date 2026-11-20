// Tests that need the app itself (its bundle and Info.plist). The logic is
// tested in VirgaKit's own test targets, on Linux too.

import XCTest
@testable import Virga

final class VirgaAppTests: XCTestCase {
  func testBundlesTheLegalDocuments() throws {
    let app = Bundle.main
    XCTAssertNotNil(app.url(forResource: "TERMS_OF_SERVICE", withExtension: "md"), "the Terms of Service ship with the app")
    XCTAssertNotNil(app.url(forResource: "PRIVACY_POLICY", withExtension: "md"), "the Privacy Policy ships with the app")
  }

  func testInfoPlistCarriesTheBuildFlags() {
    let info = Bundle.main.infoDictionary ?? [:]
    XCTAssertNotNil(info["VirgaBackendURL"] as? String)
    XCTAssertNotNil(info["VirgaDefense"] as? String)
  }
}
