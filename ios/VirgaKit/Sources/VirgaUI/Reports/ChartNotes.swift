// Ports src/reports/ChartNotes.jsx
// Ports src/reports/useAnnotations.js (useChartMarks)
//
// Notes on the charts: a day and a few words, kept per account (under the
// web's key, virga:annotations:<did>), marked on every chart over time as a
// dashed rule with a diamond, named in the readout and listed under the
// chart; the follower charts mark the follower milestones by themselves.
// One AnnotationsModel per account (ChartNotesModels), so a note added on
// one report shows on every chart at once. Return in What happened adds
// the note, as the web's form does.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

/// The open accounts' notes, one model each.
@MainActor
enum ChartNotesModels {
  private static var models: [String: AnnotationsModel] = [:]

  static func model(_ did: String, store: (any KeyValueStore)?) -> AnnotationsModel {
    if let held = models[did] { return held }
    let made = AnnotationsModel(did: did, store: store)
    models[did] = made
    return made
  }

  /// `useChartMarks(archive, series, unit, { milestones })`.
  static func marks(
    _ app: AppModel, _ archive: ReportArchive, _ series: [SeriesPoint], _ unit: AnalyticsUnit, milestones: Bool = false
  ) -> [SeriesMark] {
    model(archive.did, store: app.stores.keyValue).chartMarks(archive, series.map(\.t), unit, milestones: milestones)
  }
}

struct ChartNotes: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  let did: String
  @State private var day = Annotations.todayKey(SyncStatus.now())
  @State private var label = ""

  var body: some View {
    let notes = ChartNotesModels.model(did, store: app.stores.keyValue)
    let today = Annotations.todayKey(SyncStatus.now())
    let ready = !label.jsTrimmed().isEmpty && Periods.dayStartMs(day).isFinite
    ReportCard(title: "Notes on your charts", sub: "A day and a few words, marked on every chart over time. Kept in this browser.", tools: nil) {
      ViewThatFits(in: .horizontal) {
        HStack(alignment: .bottom, spacing: theme.space3) { fields(today) ; add(notes, ready) }
        VStack(alignment: .leading, spacing: theme.space3) { fields(today) ; add(notes, ready) }
      }
      if notes.list.isEmpty {
        EmptyState("No notes yet. Follower milestones are marked on the follower charts by themselves.")
      } else {
        // `.chart-notes-list`: 18 under the form, on a rule in ink; each row
        // at least 46 tall, its day in a column of 108 (84 at 760 and under).
        VStack(alignment: .leading, spacing: 0) {
          ForEach(notes.list.reversed(), id: \.id) { note in
            HStack(spacing: Measure.Reports.notesGap) {
              Text(Time.formatDateShort(Periods.dayStartMs(note.day)))
                .virgaText(.textBase)
                .foregroundStyle(theme.muted)
                .lineLimit(1)
                .frame(width: theme.isTablet ? Measure.Reports.narrowNotesDay : Measure.Reports.notesDay, alignment: .leading)
              Text(note.label)
                .virgaText(.textBase)
                .foregroundStyle(theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
              Button {
                notes.remove(note.id)
              } label: {
                Image(systemName: Glyph.close)
              }
              .buttonStyle(.virga(.ghost, size: .small, icon: true))
              .accessibilityLabel("Remove the note “\(note.label)”")
            }
            .frame(minHeight: Measure.Reports.notesRowMinHeight)
            .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
          }
        }
        .overlay(alignment: .top) { Rectangle().fill(theme.rule).frame(height: 1) }
        .padding(.top, Measure.Reports.notesListSpaceAbove)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chart-notes-list")
      }
    }
  }

  @ViewBuilder
  private func fields(_ today: String) -> some View {
    DayField(label: "Day", day: $day, earliest: nil, latest: today)
    VStack(alignment: .leading, spacing: theme.space2) {
      FieldLabel("What happened")
      TextField("Changed my handle, a post went round, a week away…", text: $label)
        .virgaField()
        // The fields are a form: Return adds the note, as Add note does.
        .submitLabel(.done)
        .onSubmit(addNote)
        .onChange(of: label) { _, next in
          if next.count > Annotations.annotationLabelMax { label = String(next.prefix(Annotations.annotationLabelMax)) }
        }
        .accessibilityIdentifier("chart-note-label")
    }
  }

  /// The form's submit: add the note when it is ready, and clear the words.
  private func addNote() {
    let ready = !label.jsTrimmed().isEmpty && Periods.dayStartMs(day).isFinite
    guard ready else { return }
    ChartNotesModels.model(did, store: app.stores.keyValue).add(day, label)
    label = ""
  }

  private func add(_ notes: AnnotationsModel, _ ready: Bool) -> some View {
    Button {
      addNote()
    } label: {
      Label("Add note", systemImage: Glyph.plus)
    }
    .buttonStyle(.virga)
    .disabled(!ready)
    .accessibilityIdentifier("chart-note-add")
  }
}
#endif
