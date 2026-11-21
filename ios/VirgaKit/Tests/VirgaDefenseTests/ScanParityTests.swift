// src/defense/scan.js against the web code (ios/parity/cases/
// defense.scan.js): the pure pieces, resolvePost over a scripted lookup,
// signedInProfiles through an Agent, runScan over scripted reads with every
// stage it reported, and one scan over the harness's network with the web's
// own reads, replayed from the exchanges it made.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaDefense

private let fixture = "defense.scan"

/// What a scan threw, as the fixture records it.
private func scanError(_ error: any Error) -> JSONValue {
  guard let e = error as? ScanError else {
    let fields = JSErrorFields(error)
    return ["$error": ["name": .string(fields?.name ?? "Error"), "code": .null, "message": .string(jsMessage(error))]]
  }
  return ["$error": ["name": .string(e.name), "code": .string(e.code.rawValue), "message": .string(e.message)]]
}

/// An error as a case describes it.
private func errorOf(_ spec: JSONValue?) -> (any Error)? {
  guard let spec, !spec.isNull else { return nil }
  let message = spec["message"]?.stringValue ?? ""
  switch spec["kind"]?.stringValue {
  case "ScoreError":
    return ScoreError(message, code: spec["code"]?.stringValue == "vouches" ? .vouches : .read, cause: errorOf(spec["cause"]))
  case "ScanError":
    return ScanError(message, code: ScanError.Code(rawValue: spec["code"]?.stringValue ?? "") ?? .harvest)
  default:
    return JSError(
      name: spec["name"]?.stringValue ?? "Error", message: message, status: spec["status"]?.intValue,
      error: spec["error"]?.stringValue)
  }
}

private func reasons(_ value: JSONValue?) -> ReasonMap {
  ReasonMap((value?.objectValue ?? [:]).sorted { $0.key < $1.key }.compactMap { k, v in v.stringValue.map { (k, $0) } })
}


@Suite struct ScanParity {
  @Test func constants() throws {
    let c = try Parity.cases(fixture, fn: "constants")[0]
    let actual: JSONValue = [
      "STAGES": .of(Scan.stages),
      "CANARY_CANDIDATES": .number(Double(Scan.canaryCandidates)),
      "CANARY_REQUIRED_AT": .number(Double(Scan.canaryRequiredAt)),
    ]
    let d = Parity.diff(actual, c.output)
    #expect(d == nil, "\(c): \(d ?? "")")
  }

  @Test func readPostInput() throws {
    for c in try Parity.cases(fixture, fn: "readPostInput") {
      // A value that isn't a string reads as nothing, as `typeof input === 'string'`.
      let out = Scan.readPostInput(c.input["input"]?.stringValue)
      let d = Parity.diff(out.map { .of($0) } ?? .null, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func resolvePost() async throws {
    for c in try Parity.cases(fixture, fn: "resolvePost") {
      let asked = Heard<String>()
      let handles = c.input["handles"]
      let throwing = c.input["throws"]?.stringValue
      var out: JSONValue
      do {
        let post = try await Scan.resolvePost(c["input"].stringValue) { handle in
          asked.add(handle)
          if let throwing { throw JSError(message: throwing) }
          return handles?[handle]?.stringValue
        }
        out = ["post": .of(post)]
      } catch {
        out = scanError(error)
      }
      out["asked"] = .array(asked.all.map(JSONValue.string))
      let d = Parity.diff(out, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func canaryCandidates() throws {
    for c in try Parity.cases(fixture, fn: "canaryCandidates") {
      let archive = try c.input["archive"].map { try $0.decode(CanaryArchive.self) } ?? CanaryArchive()
      let zone = c.input["zone"]?.stringValue.flatMap(TimeZone.init(identifier:)) ?? utc
      let out = Scan.canaryCandidates(
        archive, ownerDid: c.input["ownerDid"]?.stringValue, limit: c.input["limit"]?.intValue ?? Scan.canaryCandidates,
        timeZone: zone)
      let d = Parity.diff(.array(out.map(JSONValue.string)), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func signedInProfiles() async throws {
    for c in try Parity.cases(fixture, fn: "signedInProfiles") {
      await expectReplay(c) { transport, _ in
        let read = Scan.signedInProfiles(XRPCAgent(service: "https://pds.example.com", transport: transport))
        do {
          return .array(try await read(c["dids"].arrayValue?.compactMap(\.stringValue) ?? []))
        } catch let e as XRPCError {
          return ["$error": ["status": .number(Double(e.status)), "error": .string(e.error), "message": .string(e.message)]]
        }
      }
    }
  }

  @Test func scanErrorFrom() throws {
    for c in try Parity.cases(fixture, fn: "scanErrorFrom") {
      let error = errorOf(c["error"])!
      let out = Scan.scanErrorFrom(error, aborted: c.input["aborted"]?.boolValue ?? false)
      let own = error as? ScanError
      let same = own.map { $0.message == out.message && $0.code == out.code && out.cause == nil } ?? false
      let actual: JSONValue = [
        "name": .string(out.name), "code": .string(out.code.rawValue), "message": .string(out.message),
        "same": .bool(same), "cause": out.cause.map { .string(jsMessage($0)) } ?? .null,
      ]
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func runScan() async throws {
    for c in try Parity.cases(fixture, fn: "runScan") {
      let spec = c.input
      let appView = ScriptedAppView(spec["appview"] ?? [:])
      let scope = errorOf(spec["scopeError"])
      let getProfiles: GetProfiles = scope.map { e in { @Sendable _ in throw e } } ?? appView.getProfiles
      let harvest = try spec["harvest"].map { try $0.decode(Harvest.self) }!
      let progress = spec["harvestProgress"]?.arrayValue?.map {
        HarvestProgress(done: $0["done"]?.intValue ?? 0, total: $0["total"]?.intValue ?? 0)
      } ?? []
      let stages = Heard<ScanStageReport>()
      let now = spec["now"]?.doubleValue ?? 0
      var out: JSONValue
      do {
        let result = try await Scan.runScan(
          input: spec["input"]?.stringValue,
          ownerDid: spec["ownerDid"]?.stringValue ?? "",
          getProfiles: getProfiles,
          candidates: spec["candidates"]?.arrayValue?.compactMap(\.stringValue) ?? [],
          onStage: { stages.add($0) },
          resolveHandle: { handle in
            if let t = spec["resolveThrows"]?.stringValue { throw JSError(message: t) }
            return spec["resolve"]?[handle]?.stringValue
          },
          harvest: { uri, onProgress in
            for p in progress { await onProgress(p) }
            if let t = spec["harvestThrows"]?.stringValue { throw JSError(message: t) }
            var h = harvest
            h.uri = uri
            return h
          },
          getRelationships: appView.getRelationships,
          readCurated: { _ in
            if let t = spec["curatedThrows"]?.stringValue { throw JSError(message: t) }
            return reasons(spec["curated"])
          },
          kept: spec["kept"].map(reasons),
          retryDelaysMs: spec["retryDelaysMs"]?.arrayValue?.compactMap(\.doubleValue),
          now: { date(ms: now) },
          timeZone: utc)
        out = ["result": .of(result)]
      } catch {
        out = ["result": scanError(error)]
      }
      out["stages"] = .of(stages.all)
      out["asked"] = .array(appView.sortedAsked.map { .array($0.map(JSONValue.string)) })
      out["relationshipCalls"] = .number(Double(appView.relationshipCalls))
      let d = Parity.diff(out, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func runScanOverTheNetwork() async throws {
    for c in try Parity.cases(fixture, fn: "runScanOverTheNetwork") {
      let spec = c.input
      let appView = ScriptedAppView(spec["appview"] ?? [:])
      let now = spec["now"]?.doubleValue ?? 0
      // The sources, the batches and the lists are read side by side.
      await expectReplay(c, ordered: false, sortedWaits: true) { transport, _ in
        let stages = Heard<ScanStageReport>()
        var out: JSONValue
        do {
          out = [
            "result": .of(
              try await Scan.runScan(
                input: spec["input"]?.stringValue,
                ownerDid: spec["ownerDid"]?.stringValue ?? "",
                getProfiles: appView.getProfiles,
                candidates: spec["candidates"]?.arrayValue?.compactMap(\.stringValue) ?? [],
                onStage: { stages.add($0) },
                retryDelaysMs: [0, 0],
                transport: transport,
                now: { date(ms: now) },
                timeZone: utc))
          ]
        } catch {
          out = ["result": scanError(error)]
        }
        out["stages"] = .of(stages.all)
        return out
      }
    }
  }
}
