// Ports src/posting/PostingSettingsSection.jsx
// Ports src/posting/ui/ComposerDefaults.jsx
// Ports src/posting/ui/QueueSettings.jsx
// Ports src/posting/pages/scheduleParts.jsx (SwitchButton, as Settings › Posting uses it)
// Ports src/settings/SettingsPage.jsx (its Posting section)
//
// Settings › Posting, per account, over the account's PostingSettingsModel
// (usePostingSettings): what a new post starts with (its languages, who can
// reply and quote, what the main button does, and three habits), the
// weekly queue, the default timer and the post adviser. The last three need
// Virga's server, so an account without a long session sees why instead.
// With more than one account signed in, the reader picks whose settings
// these are. Each change is saved as it's made; a refused one says why.
//
// The languages and who can reply are the composer's own pickers
// (LanguagePicker, GatesEditor in VirgaUI/Composer). The queue's line about
// the week, its time zone's name and moving the week to another zone are
// scheduleModel.js's (VirgaPosting's ScheduleModel: weeklyCount, weekSummary,
// zoneLabel, moveToZone); its time-zone picker is scheduleParts'
// TimezoneSelect (Posting/ScheduleParts.swift).
//
// The post adviser's settings are AdviserSettingsCard (Adviser/), and an
// account without a long session sees NeedsBackendNotice in the server's
// cards' place.
//
// The default timer is LifespanDefaultsCard (Posting/LifespanDefaults.swift).

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaNetwork
import VirgaInsights
import VirgaPosting
import VirgaSession

struct PostingSettingsSection: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  @State private var chosen: String?

  var body: some View {
    let session = app.session
    let active = session.did
    let choices = session.accounts.filter { $0.status != .needsSignIn || $0.did.jsEquals(active ?? "") }
    let did = choices.contains { Optional($0.did).jsEquals(chosen) } ? chosen : active
    let server = did.map { session.capabilitiesFor($0).canSchedule } ?? false
    VStack(alignment: .leading, spacing: theme.sectionGap) {
      if choices.count > 1 {
        SettingsSectionView(title: "Whose settings", sub: "Each account keeps its own posting settings, on this device.") {
          SettingsRow(label: "Account", hint: nil as String?) {
            SettingsSelect(label: "Account", options: choices.map { ($0.did, Self.choiceName($0)) }, selection: did ?? "") {
              chosen = $0
            }
            .modifier(PostingSettingsSelectWidth())
            .accessibilityIdentifier("posting-settings-account")
          }
        }
      }
      PostingSettingsCards(did: did, server: server)
        .id(did ?? "")
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("posting-settings")
  }

  /// An account's choice: `accountName(a)`, with ` (@handle)` when it has
  /// a display name and a handle.
  static func choiceName(_ a: SessionAccount) -> String {
    let named = Accounts.accountName(a)
    let handle = a.handle ?? ""
    return !handle.isEmpty && !(a.displayName ?? "").isEmpty ? "\(named) (@\(handle))" : named
  }
}

/// `.settings-row-control > select.input { flex: 1 1 220px; max-width:
/// 320px }`, and the whole line from 760 down, where the select sits under
/// the words.
struct PostingSettingsSelectWidth: ViewModifier {
  @Environment(\.virgaTheme) private var theme

  func body(content: Content) -> some View {
    content.frame(
      minWidth: theme.isTablet ? nil : Measure.Settings.selectMinWidth,
      maxWidth: theme.isTablet ? .infinity : Measure.Settings.selectMaxWidth,
      alignment: .leading)
  }
}

/// What a callout says when a change is refused: `role="alert"`, read out
/// as it appears (the words-alone danger Callout), with the
/// `.settings-section-body > .callout { margin: 16px 0 4px }` round it.
struct PostingSettingsRefusal: View {
  let words: String

  var body: some View {
    Callout(tone: .danger, words)
      .padding(.top, Measure.Settings.calloutSpaceAbove)
      .padding(.bottom, Measure.Settings.calloutSpaceBelow)
  }
}

extension Measure {
  /// Settings › Posting's own measures, from the stylesheets the posting
  /// section brings to Settings.
  enum SettingsPosting {
    /// composer.css `.settings-row-control--stack { gap: 12px }`, its
    /// `.lang-picker` and `.gates-editor` at most 420 wide.
    static let stackGap: CGFloat = 12
    static let stackMax: CGFloat = 420
    /// settings.css `.settings-rule-editor { max-width: 640px }`.
    static let ruleEditorMax: CGFloat = 640
  }
}

/// The cards for one account, each over the same PostingSettingsModel.
struct PostingSettingsCards: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  let did: String?
  let server: Bool
  @State private var model: PostingSettingsModel?

  var body: some View {
    VStack(alignment: .leading, spacing: theme.sectionGap) {
      if let model {
        ComposerDefaultsCard(did: did, model: model, transport: app.archiveEnvironment.transport)
        if server {
          QueueSettingsCard(model: model)
          LifespanDefaultsCard(did: did, model: model)
          AdviserSettingsCard(did: did, model: model)
        } else {
          NeedsBackendNotice(did: did)
        }
      }
    }
    .task {
      if model == nil {
        model = PostingSettingsModel(did: did, store: app.stores.keyValue, language: Locale.preferredLanguages.first)
      }
    }
    .onDisappear { model?.stop() }
  }
}

/// What a card says when a change is refused: `err.message`, or the web's fallback.
enum PostingSettingsSave {
  static func message(_ error: any Error) -> String {
    let said = (error as? PostingSettingsError)?.message ?? (error as? LocalizedError)?.errorDescription ?? ""
    return said.isEmpty ? "That setting couldn’t be saved." : said
  }
}

// MARK: - New posts

/// `ComposerDefaults`: what the composer starts with for this account.
struct ComposerDefaultsCard: View {
  @Environment(\.virgaTheme) private var theme
  let did: String?
  let model: PostingSettingsModel
  let transport: any HTTPTransport
  @State private var error: String?

  var body: some View {
    let settings = model.settings
    let own = settings.gates != nil
    SettingsSectionView(title: "New posts", sub: "What the composer starts with for this account. Each post can still change it.") {
      SettingsRow(
        label: "Languages", hint: "Bluesky uses these to show your posts to people who read them. Up to three.", block: true
      ) {
        // `bare`: the row names it, so its label is VoiceOver's alone.
        LanguagePicker(
          value: Binding(get: { settings.langs }, set: { save(["langs": .array($0.map(JSONValue.string))]) }), label: "Languages", bare: true
        )
        .frame(maxWidth: Measure.SettingsPosting.stackMax, alignment: .leading)
      }
      // Its suggestions float out of the row over the rows after it
      // (`z-index: 30`), drawn and pressed above them.
      .zIndex(1)
      SettingsRow(
        label: "Who can reply and quote",
        hint: own
          ? "New posts from Virga use what you choose here."
          : "New posts use the setting you chose in Bluesky. If it can’t be read, anyone can reply and quote.",
        block: true
      ) {
        VStack(alignment: .leading, spacing: Measure.SettingsPosting.stackGap) {
          Segmented(
            label: "Where the reply settings come from",
            options: [SegmentedOption("bluesky", "My Bluesky setting"), SegmentedOption("here", "Choose here")],
            selection: own ? "here" : "bluesky"
          ) { v in
            save(["gates": v == "here" ? (settings.gates ?? Gates.everyoneGates).json : .null])
          }
          if own, let gates = settings.gates, let did {
            // The composer's GatesEditor, over the stored gates.
            GatesEditor(
              did: did,
              reply: Binding(
                get: { gates.json["reply"]?.arrayValue },
                set: { next in save(["gates": ["reply": next.map(JSONValue.array) ?? .null, "quotes": .bool(gates.quotes)]]) }),
              quotes: Binding(
                get: { gates.quotes },
                set: { next in save(["gates": ["reply": gates.json["reply"] ?? .null, "quotes": .bool(next)]]) }),
              transport: transport
            )
            .frame(maxWidth: Measure.SettingsPosting.stackMax, alignment: .leading)
          }
        }
      }
      SettingsRow(label: "Main button", hint: "What the composer’s main button does. The others stay in its menu.") {
        SettingsSelect(
          label: "Main button", options: PublishActions.publishActionOptions.map { ($0.value, $0.label) },
          selection: PublishActions.normalizePublishAction(settings.defaultAction)
        ) { save(["defaultAction": .string($0)]) }
        .modifier(PostingSettingsSelectWidth())
        .accessibilityIdentifier("posting-main-button")
      }
      SettingsRow(label: "Require alt text", hint: "Don’t post an image until it has a description.", compactControl: true) {
        SettingsSwitch(label: "Require alt text", isOn: settings.requireAltText) { save(["requireAltText": .bool($0)]) }
      }
      .pressingName { save(["requireAltText": .bool(!settings.requireAltText)]) }
      SettingsRow(
        label: "Offer to split long posts", hint: "When a post runs past 300 characters, offer to make it a thread.", compactControl: true
      ) {
        SettingsSwitch(label: "Offer to split long posts", isOn: settings.showThreadSuggestion) {
          save(["showThreadSuggestion": .bool($0)])
        }
      }
      .pressingName { save(["showThreadSuggestion": .bool(!settings.showThreadSuggestion)]) }
      SettingsRow(
        label: "Number the posts of a split thread",
        hint:
          "End each post with its place and the total, such as 2/5, on a line of its own. You can still choose each time you split.",
        compactControl: true
      ) {
        SettingsSwitch(label: "Number the posts of a split thread", isOn: settings.threadNumbering == "counter") { on in
          save(["threadNumbering": .string(on ? "counter" : "off")])
        }
      }
      .pressingName { save(["threadNumbering": .string(settings.threadNumbering == "counter" ? "off" : "counter")]) }
      if let error {
        PostingSettingsRefusal(words: error)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("posting-new-posts")
  }

  private func save(_ patch: JSONValue) {
    do {
      try model.update(patch)
      error = nil
    } catch {
      self.error = PostingSettingsSave.message(error)
    }
  }
}

/// `SwitchButton`: a bare switch for a row whose label names it.
struct SettingsSwitch: View {
  let label: String
  let isOn: Bool
  var disabled = false
  let onChange: (Bool) -> Void

  var body: some View {
    Toggle(label, isOn: Binding(get: { isOn }, set: { onChange($0) }))
      .labelsHidden()
      .toggleStyle(.virgaSwitch)
      .disabled(disabled)
  }
}

// MARK: - The weekly queue

/// `QueueSettings`: the week in a line, its time zone, and suggestions.
struct QueueSettingsCard: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  let model: PostingSettingsModel
  @State private var error: String?

  var body: some View {
    let schedule = model.settings.queue.json
    let tz = PostingQueue.resolveTimezone(schedule)
    let device = PostingQueue.resolveTimezone(nil)
    let count = ScheduleModel.weeklyCount(schedule)
    SettingsSectionView(
      title: "Weekly queue", sub: "The times each week that a post added to the queue goes out. Kept on this device, for this account."
    ) {
      SettingsRow(label: count == 1 ? "1 posting time a week" : "\(count) posting times a week", hint: ScheduleModel.weekSummary(schedule)) {
        // `<Link className="btn">`: a way to a page, drawn as a button.
        Button {
          navigate(PostingRoutes.postingPath("schedule"))
        } label: {
          Label("Edit the week", systemImage: Glyph.calendarRange)
        }
        .buttonStyle(.virga)
        .accessibilityRemoveTraits(.isButton)
        .accessibilityAddTraits(.isLink)
      }
      SettingsRow(
        label: "Time zone",
        hint: tz.jsEquals(device)
          ? "The queue’s times are read on this clock."
          : "The queue’s times are read on this clock. This device is in \(ScheduleModel.zoneLabel(device))."
      ) {
        // From 760 down the select fills the line under the words
        // (`.settings-row-control > select.input { max-width: 100% }`).
        TimezoneSelect(value: tz, identifier: "posting-time-zone", fill: theme.isTablet) {
          save(["queue": ScheduleModel.moveToZone(schedule, .string($0))])
        }
      }
      SettingsRow(
        label: "Suggest posting times",
        hint: "From when this account’s own posts have done best, once the archive holds enough of them. Never added without asking.",
        compactControl: true
      ) {
        SettingsSwitch(label: "Suggest posting times", isOn: model.settings.suggestBestTimes) { save(["suggestBestTimes": .bool($0)]) }
      }
      .pressingName { save(["suggestBestTimes": .bool(!model.settings.suggestBestTimes)]) }
      if let error {
        PostingSettingsRefusal(words: error)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("posting-queue")
  }

  private func save(_ patch: JSONValue) {
    do {
      try model.update(patch)
      error = nil
    } catch {
      self.error = PostingSettingsSave.message(error)
    }
  }
}

#endif
