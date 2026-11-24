// A picture written into its own address (`data:`), drawn as a browser
// draws one: read where it is, never fetched.
//
// The demo gives the pictures its user posts such addresses, and an `<img>`
// draws them, but neither the session's transport nor AsyncImage takes one.
// VirgaNetwork's DataURL reads the address as the Fetch standard does
// (base64 or percent-encoded, and nothing a browser would refuse), off the
// main actor, since an address can hold megabytes; UIImage decodes what it
// holds. The demo's own SVG faces and post images are DemoPicture's, which
// callers try first.

#if canImport(UIKit)
import SwiftUI
import UIKit
import VirgaNetwork

/// A `data:` address's picture filling its frame, as an `<img>` with
/// `object-fit: cover` does; nothing while it's read or when it holds no
/// picture, and `onFailure` then.
struct DataPicture: View {
  let address: String
  var onFailure: (() -> Void)?
  @State private var image: UIImage?

  var body: some View {
    // A ZStack, not a Group: a Group's modifiers go on each view inside it,
    // so `.task` could start again when the picture takes the clear
    // view's place.
    ZStack {
      if let image {
        Image(uiImage: image).resizable().scaledToFill()
      } else {
        Color.clear
      }
    }
    .task(id: address) {
      image = nil
      let made = await Self.image(address)
      guard !Task.isCancelled else { return }
      image = made
      if made == nil { onFailure?() }
    }
  }

  /// The picture `address` holds, or nil when a browser wouldn't draw it
  /// (it doesn't read, or it's SVG) or UIImage can't decode its bytes.
  static func image(_ address: String) async -> UIImage? {
    let bytes = await Task.detached(priority: .userInitiated) { DataURL(address)?.picture }.value
    return bytes.flatMap { UIImage(data: $0) }
  }
}
#endif
