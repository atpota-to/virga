// Ports src/reports/useAnnotations.js
//
// The account's chart notes as observable state, and the marks a chart
// draws. Every chart on a screen reads the same list, so a note added in
// the notes card shows on the chart above it at once: a change is announced
// (on the web, a 'virga:annotations-changed' event on the window), and each
// model for that account reads the list again.

import Foundation
import Observation
import VirgaArchive
import VirgaCore

/// Where a change to an account's notes is announced: the web's window
/// event, `detail` the DID. Each AnnotationsModel listens on one.
@MainActor public final class AnnotationsChanges {
  public static let shared = AnnotationsChanges()

  struct Listener {
    weak var model: AnnotationsModel?
  }

  var listeners: [Listener] = []

  public init() {}

  func listen(_ model: AnnotationsModel) {
    listeners.removeAll { $0.model == nil }
    listeners.append(Listener(model: model))
  }

  /// `window.dispatchEvent(new CustomEvent(CHANGED, { detail: did }))`:
  /// every model for `did` reads its notes again.
  public func announce(_ did: String) {
    listeners.removeAll { $0.model == nil }
    for listener in listeners {
      if let model = listener.model, model.did.jsEquals(did) { model.reload() }
    }
  }
}

/// `useAnnotations(did)`: the account's notes, kept in the key-value store
/// under the web's key, and `add`/`remove`, which write the store and tell
/// every other model for the account.
@MainActor @Observable public final class AnnotationsModel {
  public let did: String
  /// The notes, oldest day first.
  public private(set) var list: [Annotation]

  @ObservationIgnored let store: (any KeyValueStore)?
  @ObservationIgnored let changes: AnnotationsChanges
  @ObservationIgnored let newId: () -> String
  @ObservationIgnored let timeZone: TimeZone

  public init(
    did: String, store: (any KeyValueStore)?, changes: AnnotationsChanges = .shared,
    timeZone: TimeZone = AppLocale.activeTimeZone(), newId: @escaping () -> String = { Annotations.newId() }
  ) {
    self.did = did
    self.store = store
    self.changes = changes
    self.timeZone = timeZone
    self.newId = newId
    self.list = Annotations.readAnnotations(did, store: store, timeZone: timeZone)
    changes.listen(self)
  }

  /// Reads the notes again (a change was announced for this account).
  public func reload() {
    list = Annotations.readAnnotations(did, store: store, timeZone: timeZone)
  }

  func save(_ next: [Annotation]) {
    Annotations.writeAnnotations(did, next, store: store, timeZone: timeZone)
    changes.announce(did)
  }

  /// Adds a note for `day` ('YYYY-MM-DD'). An empty label or a day that
  /// isn't one changes nothing (the stored list is written back as it is).
  public func add(_ day: String, _ label: String) {
    let held = Annotations.readAnnotations(did, store: store, timeZone: timeZone)
    save(Annotations.addAnnotation(held, day: day, label: label, id: newId(), timeZone: timeZone))
  }

  public func remove(_ id: String) {
    save(Annotations.removeAnnotation(Annotations.readAnnotations(did, store: store, timeZone: timeZone), id))
  }

  /// `useChartMarks(archive, series, unit, { milestones })`: the marks one
  /// chart draws from these notes (and the follower milestones).
  public func chartMarks(
    _ archive: ReportArchive, _ series: [Double], _ unit: AnalyticsUnit, milestones: Bool = false,
    formats: ReportFormats = .active
  ) -> [SeriesMark] {
    Annotations.chartMarks(notes: list, archive: archive, series: series, unit: unit, milestones: milestones, formats: formats)
  }
}
