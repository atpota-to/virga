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
        SettingsSectionView(title: "Whose settings", sub: "Each account keeps its own posting settings, in this browser.") {
          SettingsRow(label: "Account", hint: nil as String?) {
            Picker(
              "Account",
              selection: Binding(get: { did ?? "" }, set: { chosen = $0 })
            ) {
              ForEach(choices, id: \.did) { a in
                let named = Accounts.accountName(a)
                let handle = a.handle ?? ""
                Text(!handle.isEmpty && !(a.displayName ?? "").isEmpty ? "\(named) (@\(handle))" : named).tag(a.did)
              }
            }
            .pickerStyle(.menu)
            .tint(theme.ink)
            .frame(minWidth: Measure.Settings.selectMinWidth, maxWidth: Measure.Settings.selectMaxWidth, alignment: .leading)
            .virgaField()
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
        LanguagePicker(value: Binding(get: { settings.langs }, set: { save(["langs": .array($0.map(JSONValue.string))]) }), label: "Languages")
      }
      SettingsRow(
        label: "Who can reply and quote",
        hint: own
          ? "New posts from Virga use what you choose here."
          : "New posts use the setting you chose in Bluesky. If it can’t be read, anyone can reply and quote.",
        block: true
      ) {
        VStack(alignment: .leading, spacing: theme.space4) {
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
              transport: transport)
          }
        }
      }
      SettingsRow(label: "Main button", hint: "What the composer’s main button does. The others stay in its menu.") {
        Picker(
          "Main button",
          selection: Binding(
            get: { PublishActions.normalizePublishAction(settings.defaultAction) }, set: { save(["defaultAction": .string($0)]) })
        ) {
          ForEach(PublishActions.publishActionOptions, id: \.value) { o in
            Text(o.label).tag(o.value)
          }
        }
        .pickerStyle(.menu)
        .tint(theme.ink)
        .frame(minWidth: Measure.Settings.selectMinWidth, maxWidth: Measure.Settings.selectMaxWidth, alignment: .leading)
        .virgaField()
        .accessibilityIdentifier("posting-main-button")
      }
      SettingsRow(label: "Require alt text", hint: "Don’t post an image until it has a description.", compactControl: true) {
        SettingsSwitch(label: "Require alt text", isOn: settings.requireAltText) { save(["requireAltText": .bool($0)]) }
      }
      SettingsRow(
        label: "Offer to split long posts", hint: "When a post runs past 300 characters, offer to make it a thread.", compactControl: true
      ) {
        SettingsSwitch(label: "Offer to split long posts", isOn: settings.showThreadSuggestion) {
          save(["showThreadSuggestion": .bool($0)])
        }
      }
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
      if let error {
        Callout(tone: .danger) { Text(error) }
          .padding(.top, Measure.Settings.calloutSpaceAbove)
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
      title: "Weekly queue", sub: "The times each week that a post added to the queue goes out. Kept in this browser, for this account."
    ) {
      SettingsRow(label: count == 1 ? "1 posting time a week" : "\(count) posting times a week", hint: ScheduleModel.weekSummary(schedule)) {
        Button {
          navigate(PostingRoutes.postingPageByKey["schedule"]?.path ?? PostingRoutes.postingBase)
        } label: {
          Label("Edit the week", systemImage: Glyph.calendarRange)
        }
        .buttonStyle(.virga)
      }
      SettingsRow(
        label: "Time zone",
        hint: tz.jsEquals(device)
          ? "The queue’s times are read on this clock."
          : "The queue’s times are read on this clock. This device is in \(ScheduleModel.zoneLabel(device))."
      ) {
        TimezoneSelect(value: tz, identifier: "posting-time-zone") {
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
      if let error {
        Callout(tone: .danger) { Text(error) }
          .padding(.top, Measure.Settings.calloutSpaceAbove)
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
