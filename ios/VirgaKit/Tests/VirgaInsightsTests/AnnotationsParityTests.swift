// Chart notes and follower milestones (ios/parity/cases/insights.annotations
// .js): stored lists read and written, adding and removing, the round
// numbers and their days, marks on a series in every unit, zone and week
// start, and the hook run step by step. Then what a fixture can't show.

import Foundation
import Testing
import VirgaArchive
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

extension ParityCase {
  var locale: String { self["locale"].stringValue ?? "en-US" }
}

func annotationList(_ value: JSONValue?) -> [Annotation]? {
  guard let items = value?.arrayValue else { return nil }
  return items.map {
    Annotation(id: $0["id"]?.stringValue ?? "", day: $0["day"]?.stringValue ?? "", label: $0["label"]?.stringValue ?? "")
  }
}

@Suite struct AnnotationsParity {
  let fixture = "insights.annotations"

  @Test func constants() throws {
    let c = try Parity.cases(fixture, fn: "constants")[0]
    expectOutput(
      ["ANNOTATION_LABEL_MAX": .number(Double(Annotations.annotationLabelMax)), "ANNOTATIONS_MAX": .number(Double(Annotations.annotationsMax))],
      c, strictNulls: true)
  }

  @Test func annotationsKey() throws {
    for c in try Parity.cases(fixture, fn: "annotationsKey") {
      expectOutput(.string(Annotations.annotationsKey(c["did"].stringValue ?? "")), c)
    }
  }

  @Test func cleanAnnotations() throws {
    for c in try Parity.cases(fixture, fn: "cleanAnnotations") {
      expectOutput(.array(Annotations.cleanAnnotations(c.input["raw"], timeZone: c.zone).map(\.json)), c, strictNulls: true)
    }
  }

  @Test func readAnnotations() throws {
    for c in try Parity.cases(fixture, fn: "readAnnotations") {
      let did = c["did"].stringValue ?? ""
      var items: [String: String] = [:]
      if let stored = c["stored"].stringValue { items[Annotations.annotationsKey(did)] = stored }
      let store = InMemoryKeyValueStore(items)
      let actual: JSONValue = [
        "list": .array(Annotations.readAnnotations(did, store: store, timeZone: c.zone).map(\.json)),
        "other": .array(Annotations.readAnnotations("did:plc:b", store: store, timeZone: c.zone).map(\.json)),
      ]
      expectOutput(actual, c)
    }
  }

  @Test func writeAnnotations() throws {
    for c in try Parity.cases(fixture, fn: "writeAnnotations") {
      let store = InMemoryKeyValueStore()
      // The web cleans whatever it is handed; so does this, from the raw JSON.
      let list = Annotations.cleanAnnotations(c.input["list"], timeZone: c.zone)
      Annotations.writeAnnotations(c["did"].stringValue ?? "", list, store: store, timeZone: c.zone)
      for (key, expected) in c.output.objectValue ?? [:] {
        let text = expected.stringValue ?? ""
        let written = store.getItem(key) ?? ""
        if text.contains("\\ud8") {
          // A label cut through an emoji: the web keeps the lone half and
          // writes it `\ud83d`; a Swift string holds U+FFFD there. Both read
          // back as U+FFFD (JSON.parse's port), so the lists are compared.
          let d = exactDiff((try? JSONValue.parse(written)) ?? .null, (try? JSONValue.parse(text)) ?? .null)
          #expect(d == nil, "\(c): \(d ?? "")")
        } else {
          #expect(written == text, "\(c): wrote \(written), expected \(text)")
        }
      }
      #expect(store.snapshot.count == (c.output.objectValue ?? [:]).count, "\(c): keys written")
    }
  }

  @Test func addAnnotation() throws {
    for c in try Parity.cases(fixture, fn: "addAnnotation") {
      let list = annotationList(c.input["list"])
      let next = Annotations.addAnnotation(
        list, day: c["day"].stringValue ?? "", label: c["label"].stringValue ?? "", id: c["id"].stringValue ?? "",
        timeZone: c.zone)
      // `same`: the list itself came back. A value can't say it is the same
      // array, only the same notes.
      let same = c.output["same"]?.boolValue ?? false
      if same { #expect(next == list, "\(c): the list itself comes back") }
      expectOutput(["next": .array(next.map(\.json)), "same": .bool(same)], c)
    }
  }

  @Test func removeAnnotation() throws {
    for c in try Parity.cases(fixture, fn: "removeAnnotation") {
      let next = Annotations.removeAnnotation(annotationList(c.input["list"]), c["id"].stringValue ?? "")
      expectOutput(.array(next.map(\.json)), c)
    }
  }

  @Test func milestoneSteps() throws {
    for c in try Parity.cases(fixture, fn: "milestoneSteps") {
      expectOutput(.array(Annotations.milestoneSteps(c["max"].doubleValue ?? .nan).map(JSONValue.number)), c)
    }
  }

  /// The followers a case's recipe makes (insights.annotations.js `followersOf`).
  func followers(_ recipe: JSONValue?) -> [FollowerRow]? {
    guard let recipe, !recipe.isNull else { return nil }
    let dated = recipe["dated"]?.intValue ?? 0
    let from = recipe["from"]?.doubleValue ?? Double(JSDate.utc(2026, 0, 1, 12))
    let step = recipe["step"]?.doubleValue ?? 86_400_000
    var list = (0..<dated).map { FollowerRow(did: "did:plc:\($0)", followedAt: JSDate.toISOString(from + Double($0) * step)) }
    if recipe["reverse"]?.boolValue == true { list.reverse() }
    list += (0..<(recipe["undated"]?.intValue ?? 0)).map { _ in FollowerRow(did: "did:plc:undated") }
    list += (recipe["extra"]?.arrayValue ?? []).map { FollowerRow(did: "did:plc:extra", followedAt: $0["followedAt"]?.stringValue) }
    return list
  }

  @Test func followerMilestones() throws {
    for c in try Parity.cases(fixture, fn: "followerMilestones") {
      let marks = Annotations.followerMilestones(followers(c.input["recipe"]), locale: c.locale, timeZone: c.zone)
      expectOutput(.array(marks.map(\.json)), c, strictNulls: true)
    }
  }

  @Test func noteMark() throws {
    for c in try Parity.cases(fixture, fn: "noteMark") {
      guard let note = annotationList(.array([c["annotation"]]))?.first else { continue }
      expectOutput(recorded(Annotations.noteMark(note, timeZone: c.zone).json), c, strictNulls: true)
    }
  }

  @Test func marksOnSeries() throws {
    for c in try Parity.cases(fixture, fn: "marksOnSeries") {
      let series = c.input["series"]?.arrayValue?.compactMap { $0["t"]?.doubleValue }
      let marks = c.input["marks"]?.arrayValue?.map { m in
        ChartMark(
          t: m["t"]?.stringValue == "$NaN" ? .nan : (m["t"]?.doubleValue ?? .nan), label: m["label"]?.stringValue ?? "",
          kind: ChartMark.Kind(rawValue: m["kind"]?.stringValue ?? "") ?? .note)
      }
      let unit = AnalyticsUnit(c["unit"].stringValue)
      let weekStart = c["weekStart"].intValue ?? 1
      let placed = Annotations.marksOnSeries(series, unit, marks, timeZone: c.zone, weekStart: weekStart)
      let text = placed.map { Annotations.markText($0, unit, locale: c.locale, timeZone: c.zone) }
      expectOutput(["placed": .array(placed.map(\.json)), "text": .array(text.map(JSONValue.string))], c)
    }
  }

  @Test func todayKey() throws {
    for c in try Parity.cases(fixture, fn: "todayKey") {
      expectOutput(.string(Annotations.todayKey(c["now"].doubleValue ?? .nan, timeZone: c.zone)), c)
    }
  }

  @Test @MainActor func theHookStepByStep() throws {
    for c in try Parity.cases(fixture, fn: "useAnnotations") {
      let did = c["did"].stringValue ?? ""
      var items: [String: String] = [:]
      for (key, value) in c["others"].objectValue ?? [:] { items[key] = value.stringValue }
      if let stored = c["stored"].stringValue { items[Annotations.annotationsKey(did)] = stored }
      let store = InMemoryKeyValueStore(items)
      let states = c.output["states"]?.arrayValue ?? []
      var ids = strings(c.output["ids"] ?? .null)
      let changes = AnnotationsChanges()
      let key = Annotations.annotationsKey(did)
      func state(_ model: AnnotationsModel) -> JSONValue {
        ["list": .array(model.list.map(\.json)), "stored": store.getItem(key).map(JSONValue.string) ?? .null]
      }
      var model = AnnotationsModel(did: did, store: store, changes: changes, timeZone: .gmt, newId: { ids.removeFirst() })
      #expect(exactDiff(state(model), states[0]) == nil, "\(c) at the start")
      for (index, step) in (c["steps"].arrayValue ?? []).enumerated() {
        if step["op"]?.stringValue == "add" {
          model.add(step["day"]?.stringValue ?? "", step["label"]?.stringValue ?? "")
        } else {
          model.remove(step["id"]?.stringValue ?? step["index"]?.intValue.flatMap { model.list.indices.contains($0) ? model.list[$0].id : nil } ?? "")
        }
        // The model that wrote has its new list already (the change came
        // back to it), as a fresh mount reads it.
        let d = exactDiff(state(model), states[index + 1])
        #expect(d == nil, "\(c) after step \(index + 1): \(d ?? "")")
        model = AnnotationsModel(did: did, store: store, changes: changes, timeZone: .gmt, newId: { ids.removeFirst() })
        let e = exactDiff(state(model), states[index + 1])
        #expect(e == nil, "\(c) read back after step \(index + 1): \(e ?? "")")
      }
      var others: [String: JSONValue] = [:]
      for (k, v) in store.snapshot where k != key { others[k] = .string(v) }
      #expect(exactDiff(.object(others), c.output["others"] ?? [:]) == nil, "\(c): other keys untouched")
    }
  }
}
