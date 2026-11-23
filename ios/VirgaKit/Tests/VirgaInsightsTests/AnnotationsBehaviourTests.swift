// What the annotations fixture can't show: every model for an account
// hearing a change, a store that refuses the write, the marks a chart
// draws, and the ids new notes get.

import Foundation
import Testing
import VirgaArchive
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

@Suite @MainActor struct AnnotationsModelBehaviour {
  @Test func everyModelForTheAccountHearsAChange() {
    let store = InMemoryKeyValueStore()
    let changes = AnnotationsChanges()
    var n = 0
    let newId = { () -> String in
      n += 1
      return "n\(n)"
    }
    let card = AnnotationsModel(did: "did:plc:me", store: store, changes: changes, timeZone: .gmt, newId: newId)
    let chart = AnnotationsModel(did: "did:plc:me", store: store, changes: changes, timeZone: .gmt, newId: newId)
    let other = AnnotationsModel(did: "did:plc:other", store: store, changes: changes, timeZone: .gmt, newId: newId)
    card.add("2026-10-03", "Zine went out")
    #expect(card.list.map(\.label) == ["Zine went out"])
    #expect(chart.list.map(\.label) == ["Zine went out"], "the chart above the notes card shows it at once")
    #expect(other.list.isEmpty)
    chart.remove("n1")
    #expect(card.list.isEmpty)
    #expect(store.getItem(Annotations.annotationsKey("did:plc:me")) == "[]")
  }

  @Test func aDidThatDiffersOnlyInNormalizationIsAnotherAccount() {
    let store = InMemoryKeyValueStore()
    let changes = AnnotationsChanges()
    let composed = AnnotationsModel(did: "did:plc:caf\u{E9}", store: store, changes: changes, timeZone: .gmt, newId: { "a" })
    let decomposed = AnnotationsModel(did: "did:plc:cafe\u{301}", store: store, changes: changes, timeZone: .gmt, newId: { "b" })
    composed.add("2026-10-03", "Mine")
    #expect(decomposed.list.isEmpty)
    #expect(store.snapshot.count == 1)
  }

  @Test func addReadsTheStoreNotItsOwnList() {
    // As the web's add does: a note written elsewhere since the model read
    // is kept.
    let store = InMemoryKeyValueStore()
    let changes = AnnotationsChanges()
    let model = AnnotationsModel(did: "did:plc:me", store: store, changes: changes, timeZone: .gmt, newId: { "mine" })
    try? store.setItem(Annotations.annotationsKey("did:plc:me"), #"[{"id":"there","day":"2026-01-01","label":"From elsewhere"}]"#)
    model.add("2026-02-01", "Mine")
    #expect(model.list.map(\.id) == ["there", "mine"])
  }

  @Test func aRefusedWriteLeavesTheListAsStored() {
    let store = InMemoryKeyValueStore([Annotations.annotationsKey("did:plc:me"): #"[{"id":"a","day":"2026-01-01","label":"Kept"}]"#])
    store.refusesWrites = true
    let model = AnnotationsModel(did: "did:plc:me", store: store, changes: AnnotationsChanges(), timeZone: .gmt, newId: { "b" })
    model.add("2026-02-01", "Lost")
    // The web reads the list again after the event, so the note is gone with the write.
    #expect(model.list.map(\.id) == ["a"])
  }

  @Test func notesDeletedWithTheAccountsDataAreGoneWhenReadAgain() {
    // Remove from this device with its data removes the key and tells no
    // model; the app reads the notes again when the account's shell opens
    // (ChartNotesModels.reload), as useAnnotations reads them on mount.
    let store = InMemoryKeyValueStore()
    let model = AnnotationsModel(did: "did:plc:me", store: store, changes: AnnotationsChanges(), timeZone: .gmt, newId: { "a" })
    model.add("2026-02-01", "Changed my handle")
    #expect(model.list.map(\.label) == ["Changed my handle"])
    store.removeItem(Annotations.annotationsKey("did:plc:me"))
    model.reload()
    #expect(model.list.isEmpty)
  }

  @Test func noStoreAtAll() {
    let model = AnnotationsModel(did: "did:plc:me", store: nil, changes: AnnotationsChanges(), timeZone: .gmt, newId: { "x" })
    model.add("2026-02-01", "Nowhere to keep it")
    #expect(model.list.isEmpty)
  }

  @Test func aModelThatIsGoneHearsNothing() {
    let changes = AnnotationsChanges()
    let store = InMemoryKeyValueStore()
    do {
      _ = AnnotationsModel(did: "did:plc:me", store: store, changes: changes, timeZone: .gmt)
    }
    let model = AnnotationsModel(did: "did:plc:me", store: store, changes: changes, timeZone: .gmt, newId: { "x" })
    model.add("2026-02-01", "Still here")
    #expect(changes.listeners.count == 1)
  }

  @Test func theMarksAChartDraws() {
    let zone = TimeZone(identifier: "UTC")!
    let formats = ReportFormats(locale: "en-US", weekStart: 1, timeZone: zone)
    let followers = (0..<120).map { i in
      FollowerRow(did: "did:plc:f\(i)", followedAt: JSDate.toISOString(JSDate.utc(2026, 9, 1, 12) + Double(i) * 3_600_000))
    }
    let archive = ReportArchive(
      did: "did:plc:marks", nowMs: 1, data: ArchiveData(loaded: true, followers: followers, rev: 77))
    let store = InMemoryKeyValueStore([
      Annotations.annotationsKey("did:plc:marks"): #"[{"id":"a","day":"2026-10-03","label":"Zine went out"}]"#,
    ])
    let model = AnnotationsModel(did: "did:plc:marks", store: store, changes: AnnotationsChanges(), timeZone: zone)
    let series = (0..<31).map { JSDate.utc(2026, 9, 1) + Double($0) * 86_400_000 }
    let plain = model.chartMarks(archive, series, .day, formats: formats)
    #expect(plain.map(\.i) == [2])
    let withMilestones = model.chartMarks(archive, series, .day, milestones: true, formats: formats)
    #expect(withMilestones.map(\.i) == [2, 4])
    #expect(withMilestones[1].items.map(\.label) == ["100 followers"])
    #expect(withMilestones[1].kind == .milestone)
    #expect(withMilestones[0].kind == .note)
  }

  @Test func newIdsLookLikeTheWebs() {
    let id = Annotations.newId(now: 1_794_700_000_000)
    #expect(id.hasPrefix("n" + String(1_794_700_000_000, radix: 36)))
    #expect(id.utf16.count == 1 + String(1_794_700_000_000, radix: 36).utf16.count + 4)
  }

  @Test func aDayMustBeAString() {
    // The web would keep ['2026-10-03'] (String() of it reads as the day);
    // nothing writes one, and a typed note has a string day.
    let raw: JSONValue = [["id": "x", "day": ["2026-10-03"], "label": "An array"]]
    #expect(Annotations.cleanAnnotations(raw, timeZone: .gmt).isEmpty)
  }
}
