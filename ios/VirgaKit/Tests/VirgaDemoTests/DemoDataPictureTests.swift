// A picture the demo's user posts comes back in the post's view as a data:
// address (HarnessRepo.blobDataUrl), which the Library's row shows as the
// post's thumbnail (LibraryItemRow, through TransportImage). DataURL reads
// it back to the uploaded bytes without a transport; DemoPicture, which
// TransportImage asks first, leaves it alone.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaPosting
@testable import VirgaDemo

@Suite struct DemoDataPictureTests {
  @Test func aPostedPictureReadsBackFromItsAddress() throws {
    let demo = DemoWorld(now: DemoFixtures.now)
    let bytes = PNG.cardImage(7, width: 4, height: 4)
    let ref = try demo.storeBlob(did: World.me.did, bytes: bytes, mimeType: "image/png")
    try demo.writeRecord(
      did: World.me.did, collection: "app.bsky.feed.post", rkey: "3zzzzzzzzzzz2",
      record: [
        "$type": "app.bsky.feed.post", "text": "A picture", "createdAt": "2026-11-15T10:00:00.000Z",
        "embed": ["$type": "app.bsky.embed.images", "images": [["alt": "Sky", "image": ref]]],
      ], now: DemoFixtures.now)
    let view = try #require(try demo.views.postView("at://\(World.me.did)/app.bsky.feed.post/3zzzzzzzzzzz2", now: DemoFixtures.now))
    let thumb = try #require(Library.postMedia(view)?.thumb)
    #expect(DemoPicture.read(thumb) == nil)
    #expect(DataURL.isDataURL(thumb))
    let read = try #require(DataURL(thumb))
    #expect(read.essence == "image/png")
    #expect(read.picture == Data(bytes))
  }

  @Test func theDemosOwnPicturesStayDemoPictures() throws {
    // A post whose image has no uploaded blob is the drawn landscape, an
    // SVG address that DemoPicture draws and DataURL holds no picture for.
    let thumb = try Views.placeholderImage(.string("did:plc:x0"))
    #expect(DemoPicture.read(thumb) != nil)
    #expect(DataURL.isDataURL(thumb))
    #expect(DataURL(thumb)?.essence == "image/svg+xml")
    #expect(DataURL(thumb)?.picture == nil)
  }
}
