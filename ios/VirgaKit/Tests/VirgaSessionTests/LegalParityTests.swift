// src/legal/{version,acceptance,documents,termsService}.js against
// session.legal, and markdown.js against session.markdown.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaSession

private let fixture = "session.legal"
private let server = "https://virga.example"
private let did = "did:plc:abcdefghijklmnopqrstuvwx"
private let token = "vg_" + String(repeating: "0f", count: 32)

/// A note as a fixture writes one.
private func note(_ value: JSONValue?) -> TermsAcceptanceNote? {
  guard let value, !value.isNull else { return nil }
  return TermsAcceptanceNote(
    version: value["version"]?.intValue ?? 0,
    at: value["at"]?.stringValue,
    recorded: value["recorded"] == .bool(true),
    tries: value["tries"]?.intValue ?? 0,
    identity: value["identity"]?.stringValue)
}

@Suite struct LegalVersionParity {
  @Test func constants() throws {
    #expect(Parity.diff(.number(Double(LegalVersion.termsVersion)), try Parity.cases(fixture, fn: "TERMS_VERSION")[0].output) == nil)
    #expect(Parity.diff(.string(LegalVersion.termsEffectiveDate), try Parity.cases(fixture, fn: "TERMS_EFFECTIVE_DATE")[0].output) == nil)
    #expect(Parity.diff(.string(LegalVersion.termsPath), try Parity.cases(fixture, fn: "TERMS_PATH")[0].output) == nil)
    #expect(Parity.diff(.string(LegalVersion.privacyPath), try Parity.cases(fixture, fn: "PRIVACY_PATH")[0].output) == nil)
    #expect(Parity.diff(.string(Acceptance.termsAcceptedPrefix), try Parity.cases(fixture, fn: "TERMS_ACCEPTED_PREFIX")[0].output) == nil)
    #expect(Parity.diff(.number(Double(Acceptance.maxReportTries)), try Parity.cases(fixture, fn: "MAX_REPORT_TRIES")[0].output) == nil)
    let api: JSONValue = ["status": .string(TermsService.TermsAPI.status), "accept": .string(TermsService.TermsAPI.accept)]
    #expect(Parity.diff(api, try Parity.cases(fixture, fn: "TERMS_API")[0].output) == nil)
    let docs = try Parity.cases(fixture, fn: "DOCUMENTS")[0]
    #expect(Parity.diff(.of(LegalDocuments.all), docs.output) == nil)
  }

  @Test func formatLegalDate() throws {
    for c in try Parity.cases(fixture, fn: "formatLegalDate") {
      expectParity(LegalVersion.formatLegalDate(c.input["isoDate"]).map(JSONValue.string) ?? .null, c)
    }
  }
}

@Suite struct AcceptanceParity {
  @Test func termsKey() throws {
    for c in try Parity.cases(fixture, fn: "termsKey") {
      expectParity(.string(Acceptance.termsKey(c["did"].stringValue ?? "")), c)
    }
  }

  @Test func readAcceptance() throws {
    for c in try Parity.cases(fixture, fn: "readAcceptance") {
      let store = InMemoryKeyValueStore()
      if let stored = c["stored"].stringValue { try store.setItem(Acceptance.termsKey(did), stored) }
      let read = Acceptance.readAcceptance(store, c["did"].stringValue)
      expectParity(read.map { .of($0) } ?? .null, c)
    }
    #expect(Acceptance.readAcceptance(nil, did) == nil)
  }

  @Test func writeAcceptance() throws {
    for c in try Parity.cases(fixture, fn: "writeAcceptance") {
      let store = InMemoryKeyValueStore()
      let o = c["options"]
      Acceptance.writeAcceptance(
        store, c["did"].stringValue,
        version: o["version"]?.intValue ?? LegalVersion.termsVersion,
        at: o["at"] ?? .null,
        recorded: o["recorded"]?.boolValue ?? false,
        tries: o["tries"]?.intValue ?? 0,
        identity: o["identity"]?.stringValue)
      let written: JSONValue = .object(Dictionary(uniqueKeysWithValues: store.allKeys().map { ($0, .string(store.getItem($0) ?? "")) }))
      expectParity(written, c)
    }
    // A store that refuses is no error.
    let full = InMemoryKeyValueStore(quota: 0)
    Acceptance.writeAcceptance(full, did)
    #expect(full.count == 0)
  }

  @Test func predicates() throws {
    for c in try Parity.cases(fixture, fn: "coversCurrent") {
      let version = c["version"].intValue ?? LegalVersion.termsVersion
      expectParity(.bool(Acceptance.coversCurrent(note(c.input["entry"]), version: version)), c)
    }
    for c in try Parity.cases(fixture, fn: "needsReport") {
      let version = c["version"].intValue ?? LegalVersion.termsVersion
      expectParity(.bool(Acceptance.needsReport(note(c.input["entry"]), version: version)), c)
    }
    for c in try Parity.cases(fixture, fn: "opensGate") {
      expectParity(.bool(Acceptance.opensGate(note(c.input["entry"]), mode: c["mode"].stringValue)), c)
    }
    for c in try Parity.cases(fixture, fn: "startingStatus") {
      let status = Acceptance.startingStatus(entry: note(c.input["entry"]), mode: c["mode"].stringValue, canAsk: c["canAsk"].boolValue ?? false)
      expectParity(.string(status.rawValue), c)
    }
    for c in try Parity.cases(fixture, fn: "statusFromAnswer") {
      expectParity(.string(Acceptance.statusFromAnswer(c.input["answer"]).rawValue), c)
    }
  }

  @Test func acceptFailure() throws {
    for c in try Parity.cases(fixture, fn: "acceptFailure") {
      let error: JSError? = c["error"].isNull ? nil : JSError(json: c["error"])
      expectParity(.of(Acceptance.acceptFailure(error)), c)
    }
    // The client's own errors read the same way.
    let offline = BackendError(message: "Couldn’t reach Virga’s server.", status: 0, code: "NETWORK_ERROR")
    #expect(Acceptance.acceptFailure(offline).text.hasPrefix("Couldn’t reach Virga’s server, so"))
  }
}

@Suite struct LegalDocumentsParity {
  @Test func documentFor() throws {
    for c in try Parity.cases(fixture, fn: "documentFor") {
      expectParity(LegalDocuments.documentFor(c["path"].stringValue).map(JSONValue.string) ?? .null, c)
    }
  }

  @Test func resolveDocumentLink() throws {
    for c in try Parity.cases(fixture, fn: "resolveDocumentLink") {
      let d = Parity.diff(.of(LegalDocuments.resolveDocumentLink(c["href"].stringValue)), c.output, strictNulls: true)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func readDocument() throws {
    for c in try Parity.cases("session.markdown", fn: "readDocument") {
      let key = c["key"].stringValue ?? ""
      let file = LegalDocuments.document(key)?.file
      let source = try file.map { try Repo.text($0) }
      guard let doc = LegalDocuments.readDocument(key, source: source) else {
        expectParity(.null, c)
        continue
      }
      var actual = JSONValue.of(doc)
      actual["outline"] = .of(LegalMarkdown.outlineOf(doc.blocks))
      actual["outline3"] = .of(LegalMarkdown.outlineOf(doc.blocks, level: 3))
      let d = Parity.diff(actual, c.output, strictNulls: true)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  /// The loader the app uses reads through `LegalDocuments.loader`, once.
  @Test func readDocumentThroughTheLoader() throws {
    let terms = try Repo.text("TERMS_OF_SERVICE.md")
    let previous = LegalDocuments.loader.wrappedValue
    defer {
      LegalDocuments.loader.set(previous)
      LegalDocuments.parsed.set([:])
    }
    let loads = Locked(0)
    LegalDocuments.parsed.set([:])
    LegalDocuments.loader.set { doc in
      loads.withLock { $0 += 1 }
      return doc.key == "terms" ? terms : nil
    }
    #expect(LegalDocuments.readDocument("terms")?.title == "Terms of Service")
    #expect(LegalDocuments.readDocument("terms")?.problems == [])
    #expect(LegalDocuments.readDocument("privacy") == nil)
    #expect(LegalDocuments.readDocument("nothing") == nil)
    #expect(loads.wrappedValue == 2)
  }

  /// documents.test.js: both documents carry the date and version, link only
  /// to places that exist, and haven't changed since the version was decided.
  @Test func theDocumentsHoldTogether() throws {
    let fingerprints = [
      "terms": "7209e387abe07ab9f77023f8cee4113da1dde55af7463734b47ad25c20bdbc03",
      "privacy": "09baacd6c9bc347e397314381f6b36e36ed2ded4a859037c37f843bec29e52a3",
    ]
    for doc in LegalDocuments.all {
      let source = try Repo.text(doc.file)
      let read = try #require(LegalDocuments.readDocument(doc.key, source: source))
      #expect(read.problems.isEmpty)
      let line = "**Last updated:** \(LegalVersion.formatLegalDate(LegalVersion.termsEffectiveDate)!) (version \(LegalVersion.termsVersion))"
      #expect(source.components(separatedBy: "\n").contains(line))
      #expect(SHA256.hex(SHA256.hash(Data(source.utf8))) == fingerprints[doc.key], "\(doc.file) changed: decide whether TERMS_VERSION goes up")
    }
  }
}

@Suite struct TermsServiceParity {
  private func requester(_ transport: MockTransport) -> VirgaBackend {
    VirgaBackend(backendUrl: server, token: { token }, did: did, transport: transport)
  }

  @Test func fetchTermsStatus() async throws {
    for c in try Parity.cases(fixture, fn: "fetchTermsStatus") {
      await expectReplay(c) { transport, _ in
        do {
          return try await TermsService.fetchTermsStatus(requester(transport)).json
        } catch {
          return ["error": errorShape(error)]
        }
      }
    }
  }

  @Test func recordAcceptance() async throws {
    for c in try Parity.cases(fixture, fn: "recordAcceptance") {
      await expectReplay(c) { transport, _ in
        do {
          let version = c["version"].intValue ?? LegalVersion.termsVersion
          return ["acceptedAt": .string(try await TermsService.recordAcceptance(requester(transport), version: version))]
        } catch {
          return ["error": errorShape(error)]
        }
      }
    }
  }

  @Test func reportAcceptance() async throws {
    for c in try Parity.cases(fixture, fn: "reportAcceptance") {
      await expectReplay(c) { transport, _ in
        do {
          let target = c.input["did"].map { $0.stringValue } ?? did
          let identity = try await TermsService.reportAcceptance(
            did: target, version: c["version"].intValue ?? LegalVersion.termsVersion,
            backendUrl: c.input["backendUrl"]?.stringValue ?? server, transport: transport)
          return ["identity": identity]
        } catch {
          return ["error": errorShape(error)]
        }
      }
    }
  }
}
