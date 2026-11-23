// The demo's pictures, drawn as a browser draws them.
//
// The harness's faces and post images are SVG data addresses, which a
// browser draws and AsyncImage and UIImage can't decode (VirgaDemo's
// DemoPicture says why and reads them). Here they are drawn with shapes and
// Text instead: scaled to cover their frame and centred, as an `<img>` with
// `object-fit: cover` is, and cut by whatever clips the frame (an avatar's
// circle, a thumbnail's rounded corners). An initial is in the system face,
// as `system-ui` is on an iPhone, at its size in the picture: a picture
// doesn't grow with Dynamic Type or Bold Text, and neither does this.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaDemo

struct DemoPictureView: View {
  let picture: DemoPicture

  var body: some View {
    GeometryReader { proxy in
      let width = CGFloat(picture.width)
      let height = CGFloat(picture.height)
      let scale = max(proxy.size.width / width, proxy.size.height / height)
      let origin = CGPoint(x: (proxy.size.width - width * scale) / 2, y: (proxy.size.height - height * scale) / 2)
      ZStack(alignment: .topLeading) {
        // The background covers the picture, and the picture its frame.
        picture.background.color
        ForEach(picture.marks.indices, id: \.self) { index in
          mark(picture.marks[index], scale: scale, origin: origin)
        }
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityAddTraits(.isImage)
  }

  /// A point of the picture's, in the frame.
  private func place(_ x: Double, _ y: Double, scale: CGFloat, origin: CGPoint) -> CGPoint {
    CGPoint(x: origin.x + CGFloat(x) * scale, y: origin.y + CGFloat(y) * scale)
  }

  @ViewBuilder
  private func mark(_ mark: DemoPicture.Mark, scale: CGFloat, origin: CGPoint) -> some View {
    switch mark {
    case .text(let words, let x, let baseline, let size, let weight, let fill):
      // `text-anchor="middle"`: the words' middle on x, their baseline on y.
      let anchor = place(x, baseline, scale: scale, origin: origin)
      Color.clear.overlay(alignment: .topLeading) {
        Text(verbatim: words)
          .font(.system(size: CGFloat(size) * scale, weight: Self.weight(weight)))
          .foregroundStyle(fill.color)
          .lineLimit(1)
          .fixedSize()
          .environment(\.legibilityWeight, .regular)
          .alignmentGuide(.leading) { d in d[HorizontalAlignment.center] - anchor.x }
          .alignmentGuide(.top) { d in d[VerticalAlignment.firstTextBaseline] - anchor.y }
      }
    case .polygon(let points, let fill):
      let corners = points.map { place($0.x, $0.y, scale: scale, origin: origin) }
      Path { path in
        path.addLines(corners)
        path.closeSubpath()
      }
      .fill(fill.color)
    case .circle(let center, let radius, let fill):
      let middle = place(center.x, center.y, scale: scale, origin: origin)
      let r = CGFloat(radius) * scale
      Path(ellipseIn: CGRect(x: middle.x - r, y: middle.y - r, width: 2 * r, height: 2 * r))
        .fill(fill.color)
    }
  }

  /// A CSS font weight (100 to 900) as the nearest of the system's.
  static func weight(_ css: Double) -> Font.Weight {
    if css < 150 { return .ultraLight }
    if css < 250 { return .thin }
    if css < 350 { return .light }
    if css < 450 { return .regular }
    if css < 550 { return .medium }
    if css < 650 { return .semibold }
    if css < 750 { return .bold }
    if css < 850 { return .heavy }
    return .black
  }
}

#Preview("Demo pictures") {
  VirgaPreviewHost {
    HStack(spacing: 12) {
      Avatar(src: DemoWorld.preview.worlds.first?.profile.avatar, name: "Mira Okafor", size: .small)
      Avatar(src: DemoWorld.preview.worlds.first?.cast.first?.avatar, name: "Bo Underhill")
      Avatar(src: DemoWorld.preview.worlds.first?.cast.first?.avatar, name: "Bo Underhill", size: .large)
    }
    .padding()
  }
}
#endif
