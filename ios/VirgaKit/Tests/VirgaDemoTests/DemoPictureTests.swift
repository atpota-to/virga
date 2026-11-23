// DemoPicture reads back exactly what World.avatarFor and
// Views.placeholderImage write: their sizes, their marks, and their colours
// as a browser computes them (Chromium's getComputedStyle, rounded to
// bytes). Every other address, a real picture's above all, reads as nil.

import Testing
import VirgaCore
@testable import VirgaDemo

@Suite struct DemoPictureTests {
  /// A colour as the bytes a browser computes for it.
  static func bytes(_ color: ThemeColor) -> [Int] {
    [color.red, color.green, color.blue].map { Int(($0 * 255).rounded()) }
  }

  static func bytes(_ mark: DemoPicture.Mark) -> [Int] {
    switch mark {
    case .text(_, _, _, _, _, let fill), .polygon(_, let fill), .circle(_, _, let fill): return bytes(fill)
    }
  }

  @Test func readsAFaceBack() throws {
    let picture = try #require(DemoPicture.read(World.avatarFor("B", 28)))
    #expect(picture.width == 64)
    #expect(picture.height == 64)
    #expect(Self.bytes(picture.background) == [238, 196, 160])
    #expect(picture.marks.count == 1)
    guard case .text(let letter, let x, let baseline, let size, let weight, let fill) = picture.marks.first else {
      Issue.record("not an initial: \(picture.marks)")
      return
    }
    #expect(letter == "B")
    #expect([x, baseline, size, weight] == [32, 42, 30, 700])
    #expect(Self.bytes(fill) == [98, 59, 24])
  }

  @Test func readsMirasFaceInHerBlue() throws {
    let mira = try #require(DemoWorld.preview.world(World.me.did)?.profile.avatar)
    let picture = try #require(DemoPicture.read(mira))
    #expect(Self.bytes(picture.background) == [160, 196, 238])
    #expect(picture.marks.map(Self.bytes) == [[24, 59, 98]])
  }

  @Test func readsALandscapeBack() throws {
    let seed = "bafkreiharnessplaceholder"
    #expect(World.hashOf(seed) % 360 == 248)
    let picture = try #require(DemoPicture.read(try Views.placeholderImage(.string(seed))))
    #expect(picture.width == 400)
    #expect(picture.height == 300)
    #expect(Self.bytes(picture.background) == [194, 188, 230])
    let corners = [(0, 220), (120, 140), (210, 200), (290, 120), (400, 210), (400, 300), (0, 300)]
    #expect(picture.marks.count == 2)
    guard case .polygon(let points, _) = picture.marks.first, case .circle(let center, let radius, _) = picture.marks.last else {
      Issue.record("not a hill and a sun: \(picture.marks)")
      return
    }
    #expect(points == corners.map { DemoPicture.Point(x: Double($0.0), y: Double($0.1)) })
    #expect(center == DemoPicture.Point(x: 320, y: 70))
    #expect(radius == 28)
    #expect(picture.marks.map(Self.bytes) == [[120, 110, 185], [240, 212, 247]])
  }

  @Test func readsEveryFaceAndPictureInTheWorlds() throws {
    let people = DemoWorld.preview.worlds.flatMap { $0.cast + $0.followedOnly }
    let faces =
      people.map(\.avatar).filter { !$0.isEmpty } + DemoWorld.preview.worlds.compactMap(\.profile.avatar)
      + [World.lab.avatar].compactMap { $0 }
    #expect(faces.count > 60)
    for face in faces {
      let picture = try #require(DemoPicture.read(face))
      guard case .text(let letter, _, _, _, _, _) = picture.marks.first else {
        Issue.record("\(face) has no initial")
        continue
      }
      #expect(letter.count == 1)
    }
    for seed in ["", "bafkreiabc", "did:plc:virgaharnesscast00010", "x y z"] {
      #expect(DemoPicture.read(try Views.placeholderImage(.string(seed)))?.marks.count == 2)
    }
  }

  @Test func readsNothingElse() throws {
    let face = World.avatarFor("B", 28)
    let svg = try JSURI.decodeURIComponent(String(face.dropFirst("data:image/svg+xml,".count)))
    func address(_ text: String) -> String { "data:image/svg+xml,\(JSURI.encodeURIComponent(text))" }
    let others = [
      "",
      "https://cdn.bsky.app/img/avatar/plain/did:plc:abc/bafkrei@jpeg",
      "data:image/png;base64,iVBORw0KGgo=",
      "data:image/svg+xml;base64,PHN2Zy8+",
      "data:image/svg+xml,%E0%A4%A",
      address(svg.replacingOccurrences(of: "system-ui,sans-serif", with: "Georgia")),
      address(svg.replacingOccurrences(of: "text-anchor=\"middle\"", with: "text-anchor=\"start\"")),
      address(svg.replacingOccurrences(of: "hsl(28 70% 78%)", with: "#eec4a0")),
      address(svg.replacingOccurrences(of: ">B<", with: ">&amp;<")),
      address(svg.replacingOccurrences(of: ">B<", with: "> B<")),
      address(svg.replacingOccurrences(of: "<rect width=\"64\"", with: "<rect width=\"60\"")),
      address(svg.replacingOccurrences(of: "</svg>", with: "<circle cx=\"1\" cy=\"1\" r=\"1\" fill=\"hsl(0 0% 0%)\"/></svg>")),
      address(svg + " "),
    ]
    for other in others {
      #expect(DemoPicture.read(other) == nil, "\(other)")
    }
    // The same picture, written as the maker writes it, still reads.
    #expect(DemoPicture.read(address(svg)) != nil)
  }
}
