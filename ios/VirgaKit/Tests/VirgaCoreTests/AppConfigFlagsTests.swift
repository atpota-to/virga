// The app's build flags as the Info.plist gives them. The App Store page is
// iOS's own (the web has no such flag): the agreement screen sends a build
// that predates the current documents there to update.

import Foundation
import Testing
@testable import VirgaCore

@Suite struct AppConfigFlags {
  @Test func readsTheInfoPlist() {
    let flags = AppConfig.Flags(infoDictionary: [
      "VirgaBackendURL": "https://virga.app/",
      "VirgaDefense": "on",
      "VirgaDefenseModerator": "on",
      "VirgaAppStoreURL": " https://apps.apple.com/app/id1234567890 ",
    ])
    #expect(flags.backendURL == "https://virga.app")
    #expect(flags.defenseEnabled)
    #expect(flags.defenseModeratorEnabled)
    #expect(flags.appStoreURL == "https://apps.apple.com/app/id1234567890")
    #expect(flags.appStoreLink == URL(string: "https://apps.apple.com/app/id1234567890"))
  }

  @Test func noAppStorePageIsNoLink() {
    #expect(AppConfig.Flags(infoDictionary: [:]).appStoreLink == nil)
    #expect(AppConfig.Flags(appStoreURL: "").appStoreLink == nil)
  }

  @Test func onlyAnAddressTheAppStoreOpensIsALink() {
    #expect(AppConfig.Flags(appStoreURL: "itms-apps://apps.apple.com/app/id1234567890").appStoreLink != nil)
    #expect(AppConfig.Flags(appStoreURL: "http://apps.apple.com/app/id1234567890").appStoreLink == nil)
    #expect(AppConfig.Flags(appStoreURL: "apps.apple.com/app/id1234567890").appStoreLink == nil)
    #expect(AppConfig.Flags(appStoreURL: "https://").appStoreLink == nil)
    #expect(AppConfig.Flags(appStoreURL: "$(VIRGA_APP_STORE_URL)").appStoreLink == nil)
  }
}
