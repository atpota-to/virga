// The addresses the iOS app is opened with that open the composer
// (ComposeIntent.composeLinkSearch): the app's own virga://compose, and the
// universal link to /intent/compose that the web's
// apple-app-site-association claims for the app. AppRoot opens the composer
// with the query, or keeps the link for after the sign-in.

import Foundation
import Testing
import VirgaCore
@testable import VirgaPosting

@Suite struct ComposeLinkBehaviour {
  private func search(_ address: String) -> String? {
    ComposeIntent.composeLinkSearch(URL(string: address)!)
  }

  @Test func theAppsOwnSchemeOpensTheComposer() {
    #expect(search("virga://compose?text=Hello&tags=garden") == "?text=Hello&tags=garden")
    #expect(search("VIRGA://Compose?text=Hi") == "?text=Hi", "the scheme and host in any case")
    #expect(search("virga://compose") == "", "no query: the composer opens empty")
    #expect(search("virga://settings?text=Hi") == nil)
  }

  @Test func theUniversalLinkToTheComposeIntentOpensTheComposer() {
    let address = "https://virga.app/intent/compose?text=Hello%20there&url=https%3A%2F%2Fexample.com&tags=a,b"
    let query = search(address)
    #expect(query == "?text=Hello%20there&url=https%3A%2F%2Fexample.com&tags=a,b")
    let intent = ComposeIntent.parseComposeIntent(query)
    #expect(intent.hasIntent)
    #expect(intent.text == "Hello there\n\nhttps://example.com/")
    #expect(intent.url == "https://example.com/")
    #expect(intent.tags == ["a", "b"])
    #expect(search("https://virga.app/intent/compose") == "")
    #expect(search("https://virga.app/intent/compose/?text=Hi") == "?text=Hi", "a trailing slash is the same page")
  }

  @Test func otherAddressesAreNotComposeLinks() {
    // The sign-in's return is finished elsewhere (AppRoot's finishReturn).
    #expect(search("https://virga.app/oauth/return#session=abc") == nil)
    // The associated domain claims only /intent/compose.
    #expect(search("https://virga.app/posting/compose?text=Hi") == nil)
    #expect(search("https://virga.app/intent/composer?text=Hi") == nil)
    #expect(search("https://virga.app/") == nil)
    #expect(search("http://virga.app/intent/compose?text=Hi") == nil, "only https links are universal links")
  }

  @Test func aLinkOpenedSignedOutIsKeptForAfterTheSignIn() throws {
    // AppRoot keeps the link's query under the intent's path, as the web's
    // App.jsx does with the page's own address.
    let store = InMemoryKeyValueStore()
    let query = try #require(search("https://virga.app/intent/compose?text=Hello"))
    #expect(PendingCompose.rememberPendingCompose(ComposeIntent.intentComposePath, query, store: store, now: 1_000))
    #expect(PendingCompose.takePendingCompose(store: store, now: 2_000) == "/intent/compose?text=Hello")
    #expect(PendingCompose.takePendingCompose(store: store, now: 2_000) == nil, "taken once")
  }
}
