// Ports src/shell/bits.jsx (usePeriod, PeriodPicker, RangeDialog)
// Ports src/shell/shell.css (.period-picker, .range-fields)
//
// The window every chart answers for, kept across visits (the period
// preference): one of the presets, or a range of dates. The picker sits in
// a page's header: the presets and Custom, which opens a dialog of two days,
// checked as they are picked. Custom says its range once there is one;
// from 560 down the key is its calendar alone, its words kept as its name.
// The days are the active time zone's (Periods.dayKey).

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore

extension PreferencesModel {
  /// `usePeriod()`'s value: the period chosen, resolved for now.
  func period(nowMs: Double = SyncStatus.now()) -> AnalyticsPeriod {
    Periods.resolvePeriod(prefs, nowMs: nowMs)
  }

  /// `usePeriod()`'s setter for a preset key.
  func setPeriod(_ key: String) {
    setPref(\.period, Preferences.Period(rawValue: key) ?? .days30)
  }

  /// `usePeriod()`'s setter for a custom range: two 'YYYY-MM-DD' days.
  func setCustomPeriod(from: String, to: String) {
    setPrefs { prefs in
      prefs.period = .custom
      prefs.periodFrom = from
      prefs.periodTo = to
    }
  }
}

/// `PeriodPicker`: the page's window, in its header.
public struct PeriodPicker: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(PreferencesModel.self) private var preferences
  @State private var picking = false
  @State private var range = DayRange(from: "", to: "")
  private let options: [String]?
  private let effective: String?

  /// `CUSTOM_PERIOD`.
  static let customKey: String = Periods.customPeriod

  /// The presets' short words (`SHORT`).
  static let short = ["7d": "7d", "30d": "30d", "90d": "90d", "1y": "1y", "all": "All"]

  /// - Parameters:
  ///   - options: the keys to offer ('7d' … 'all', and 'custom'), for a page
  ///     that answers for only some; every one by default.
  ///   - effective: the key to show pressed when the page reads a window
  ///     other than the one chosen, without changing the choice.
  public init(options: [String]? = nil, effective: String? = nil) {
    self.options = options
    self.effective = effective
  }

  public var body: some View {
    let period = preferences.period()
    let custom = period.isCustom
    let selection = effective ?? (custom ? Self.customKey : period.key)
    Segmented(label: "Period", options: keys(period), selection: selection) { key in
      if key.jsEquals(Self.customKey) {
        range = DayRange.initial(for: period)
        picking = true
      } else {
        preferences.setPeriod(key)
      }
    }
    .accessibilityIdentifier("period-picker")
    .virgaDialog(isPresented: $picking, title: "Custom range") {
      RangeFields(range: $range)
    } actions: {
      Button("Cancel") { picking = false }
        .buttonStyle(.virga)
      Button("Show this range") {
        guard range.problem == nil else { return }
        preferences.setCustomPeriod(from: range.from, to: range.to)
        picking = false
      }
      .buttonStyle(.virga(.primary))
      .disabled(range.problem != nil)
      .accessibilityIdentifier("range-apply")
    }
  }

  private func offered(_ key: String) -> Bool {
    options.map { $0.contains { $0.jsEquals(key) } } ?? true
  }

  private func keys(_ period: AnalyticsPeriod) -> [SegmentedOption<String>] {
    var out = Analytics.analyticsPeriods.filter { offered($0.key) }.map { preset in
      SegmentedOption(preset.key, Self.short[preset.key] ?? preset.label, accessibilityLabel: Periods.periodWindowWord(preset))
    }
    if offered(Self.customKey) {
      let custom = period.isCustom
      out.append(
        SegmentedOption(
          Self.customKey, custom ? period.label : "Custom", systemImage: Glyph.calendarRange,
          accessibilityLabel: custom ? "Custom range: \(period.label). Change the dates" : "Custom range of dates",
          // From 560 down only (shell.css): the calendar alone, its words its name.
          iconOnly: theme.isPhone))
    }
    return out
  }
}

/// The two days a custom range is picked as, 'YYYY-MM-DD', and what is
/// wrong with them, if anything.
struct DayRange: Equatable {
  var from: String
  var to: String

  static let dayMs: Double = 86_400_000

  /// Starts from the range in use, or the window the preset covers, so the
  /// first thing to do is nudge an end rather than pick both from nothing.
  static func initial(for period: AnalyticsPeriod, nowMs: Double = SyncStatus.now()) -> DayRange {
    let today = Periods.dayKey(nowMs)
    if period.isCustom { return DayRange(from: period.from ?? "", to: period.to ?? "") }
    let days = Double(period.days.flatMap { $0 == 0 ? nil : $0 } ?? 30)
    return DayRange(from: Periods.dayKey(nowMs - (days - 1) * dayMs), to: today)
  }

  /// `customPeriod(from, to)`, or nil.
  func result(nowMs: Double = SyncStatus.now()) -> AnalyticsPeriod? {
    Periods.customPeriod(from, to, nowMs)
  }

  var problem: String? {
    if from.isEmpty || to.isEmpty { return "Pick both days." }
    // `range.to < range.from`, by code unit.
    if to.utf16.lexicographicallyPrecedes(from.utf16) { return "The last day is before the first." }
    if result() == nil { return "That range hasn’t started yet." }
    return nil
  }

  /// The line under the fields: the problem, or what the range covers.
  var hint: String {
    if let problem { return problem }
    let days = result()?.days ?? 0
    let count = AppLocale.formatNumber(days)
    return "\(count) \(days == 1 ? "day" : "days"), in your time zone. Changes are measured against \(days == 1 ? "the day" : "the \(days) days") before."
  }
}

/// The dialog's fields: First day and Last day, side by side where there is
/// room (each at least 180 wide), and the line under them.
struct RangeFields: View {
  @Environment(\.virgaTheme) private var theme
  @Binding var range: DayRange

  var body: some View {
    let today = Periods.dayKey(SyncStatus.now())
    DialogForm {
      LazyVGrid(
        columns: [GridItem(.adaptive(minimum: Measure.Period.fieldMinWidth), spacing: Measure.Period.fieldsGap, alignment: .top)],
        alignment: .leading, spacing: Measure.Period.fieldsGap
      ) {
        DayField(label: "First day", day: $range.from, earliest: nil, latest: range.to.isEmpty ? today : range.to)
          .accessibilityIdentifier("range-from")
        DayField(label: "Last day", day: $range.to, earliest: range.from.isEmpty ? nil : range.from, latest: today)
          .accessibilityIdentifier("range-to")
      }
      Text(range.hint)
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityAddTraits(.updatesFrequently)
        .accessibilityIdentifier("range-hint")
    }
  }
}

/// A day, picked on the system's calendar in the active time zone and kept
/// as 'YYYY-MM-DD'.
struct DayField: View {
  @Environment(\.virgaTheme) private var theme
  let label: String
  @Binding var day: String
  let earliest: String?
  let latest: String?

  var body: some View {
    let zone = AppLocale.activeTimeZone()
    let date = Binding<Date>(
      get: { Self.date(day, zone) ?? Date() },
      set: { day = Periods.dayKey($0.timeIntervalSince1970 * 1000, timeZone: zone) })
    let low = earliest.flatMap { Self.date($0, zone) } ?? .distantPast
    let high = latest.flatMap { Self.date($0, zone) } ?? .distantFuture
    VStack(alignment: .leading, spacing: theme.space2) {
      FieldLabel(label)
      DatePicker(label, selection: date, in: low...max(low, high), displayedComponents: .date)
        .labelsHidden()
        .datePickerStyle(.compact)
        .environment(\.timeZone, zone)
        .accessibilityLabel(label)
    }
  }

  /// The day's local midnight, or nil for no day.
  static func date(_ day: String, _ zone: TimeZone) -> Date? {
    let ms = Periods.dayStartMs(day, timeZone: zone)
    return ms.isFinite ? Date(timeIntervalSince1970: ms / 1000) : nil
  }
}

#Preview("Period") {
  VirgaPreviewHost {
    VStack(alignment: .leading, spacing: 24) {
      PeriodPicker()
      RangeFields(range: .constant(DayRange(from: "2026-10-01", to: "2026-10-31")))
    }
    .padding()
  }
}
#endif
