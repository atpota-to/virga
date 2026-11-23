// lib/images.js held to composer.images: the re-encode's options, its
// refusals and the prepared image, over a scripted encoder.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaPosting

/// An encoder that does what a case's script says, recording each call.
actor ScriptedEncoder: ImageEncoder {
  let script: JSONValue
  var calls: [JSONValue] = []

  init(_ script: JSONValue) { self.script = script }

  static func record(_ file: ComposerFile) -> JSONValue {
    var json = file.json
    json["lastModified"] = nil
    return json
  }

  func compress(_ file: ComposerFile, _ options: ImageCompressOptions) async throws -> ComposerFile? {
    calls.append(["compress", Self.record(file), (try? JSONValue(encoding: options)) ?? .null])
    switch script["compress"] {
    case "throw"?: throw JSError(message: "decoder blew up")
    case "hang"?:
      while true { try await Task.sleep(nanoseconds: 1_000_000_000) }
    case .null?, nil: return nil
    case let spec?: return ComposerFile(type: "image/jpeg", size: spec["size"]?.doubleValue ?? 0)
    }
  }

  func decodeSize(_ file: ComposerFile) async throws -> ImageSize? {
    calls.append(["decode", Self.record(file)])
    switch script["decode"] {
    case "throw"?: throw JSError(message: "cannot decode")
    case let spec? where spec.isTruthy:
      return ImageSize(width: spec["width"]?.doubleValue ?? 0, height: spec["height"]?.doubleValue ?? 0)
    default: return nil
    }
  }
}

@Suite struct ImagesParity {
  static let f = "composer.images"

  @Test func constants() throws {
    for c in try cases(Self.f, "imagesConstants") {
      check(
        [
          "MAX_IMAGES": .number(Double(Images.maxImages)),
          "IMAGE_BUDGET": json(Images.imageBudget),
          "CARD_THUMB_BUDGET": json(Images.cardThumbBudget),
          "IMAGE_MIME_TYPES": json(Images.imageMimeTypes),
        ], c)
    }
    for c in try cases(Self.f, "isImageFile") { check(.bool(Images.isImageFile(c.input["file"])), c) }
  }

  @Test func prepareImage() async throws {
    for c in try cases(Self.f, "prepareImage") {
      let script = c.input["script"] ?? [:]
      let encoder = ScriptedEncoder(script)
      let file = ComposerFile(json: c.input["file"]) ?? ComposerFile(type: "", size: 0)
      let timesOut = script["timeoutMs"] != nil
      // The timeout fires at once in the case that waits for it, and never
      // in the others, so which comes first is never a race.
      let never: @Sendable (Double) async -> Void = { _ in
        while !Task.isCancelled { try? await Task.sleep(nanoseconds: 1_000_000_000) }
      }
      let atOnce: @Sendable (Double) async -> Void = { _ in }
      let sleep = timesOut ? atOnce : never
      var out: JSONValue
      do {
        let prepared = try await Images.prepareImage(
          file, budget: script["budget"] == "card" ? Images.cardThumbBudget : Images.imageBudget, encoder: encoder,
          timeoutMs: script["timeoutMs"]?.doubleValue ?? Images.compressTimeoutMs, sleep: sleep)
        var result = json(prepared)
        result["file"] = ScriptedEncoder.record(prepared.file)
        out = ["result": result, "calls": .array(await encoder.calls)]
      } catch let error as ImageProcessingError {
        out = ["$throws": .string(error.message), "code": .string(error.code), "calls": .array(await encoder.calls)]
      }
      check(out, c)
    }
  }
}

@Suite struct ImagesBehaviour {
  @Test func uploadsAsTheImagesType() async throws {
    let mock = MockTransport()
    mock.on(
      .path("/xrpc/com.atproto.repo.uploadBlob"),
      respond: .json([
        "blob": ["$type": "blob", "ref": ["$link": "bafkimg"], "mimeType": "image/jpeg", "size": 3]
      ]))
    let agent = XRPCAgent(service: "https://pds.example", transport: mock)
    let image = PreparedImage(
      file: ComposerFile(name: "a.jpg", type: "image/jpeg", size: 3), mime: "image/jpeg", size: 3, aspectRatio: nil)
    let blob = try await Images.uploadImage(agent: agent, image: image, data: Data([1, 2, 3]))
    #expect(blob.mimeType == "image/jpeg")
    #expect(mock.requests.first?.headers.get("content-type") == "image/jpeg")
  }
}
