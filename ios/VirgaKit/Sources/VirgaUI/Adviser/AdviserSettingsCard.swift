// Ports src/posting/ui/AdviserSettings.jsx
// Ports src/posting/ui/adviser.css (.adviser-set-stack, .adviser-set-radios, .adviser-check, .adviser-indent, .adviser-style, .adviser-set-usage, .adviser-sent-body)
//
// Settings › Posting: the post adviser for one account, as rows like the
// rest of Settings, over the account's PostingSettingsModel. Off until it's
// turned on; the first time, it comes on with a recommended setup (every
// check, both general goals) that the rows under it can change
// (AdviserSetup.nextPostingAdviserState). Only for an account signed in
// through Virga's server, which can use AI: otherwise it says what's
// missing (NeedsBackend). Says what is sent, and to whom.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting
import VirgaSession

struct AdviserSettingsCard: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  let did: String?
  let model: PostingSettingsModel
  @State private var error = ""
  @State private var styleOpen = false

  static let reviewOptions = [SegmentedOption("significant", "When something’s off"), SegmentedOption("always", "Every time")]
  /// A choice with its words and the line under them.
  struct Option: Hashable {
    var key: String
    var label: String
    var hint = ""
  }

  static let scopeOptions = [
    Option(key: "all", label: "All posts"), Option(key: "topLevel", label: "New posts and my own threads"),
    Option(key: "replies", label: "Only replies to other people"),
  ]
  static let goalPresets = [
    Option(key: "reduceNegativity", label: "Reduce negativity", hint: "Flag a hostile, cruel or doom-heavy tone."),
    Option(key: "lessConfrontational", label: "Less confrontational", hint: "Flag dunking, sarcastic replies or pointed criticism."),
  ]
  static let writingChecks = [
    Option(key: "typos", label: "Typos", hint: "A wrong or misspelled word, like “out” where you meant “our”."),
    Option(key: "grammar", label: "Grammar", hint: "Grammar that would trip a reader up. A casual style is yours to keep."),
    Option(key: "clarity", label: "Clarity", hint: "A sentence likely to confuse people or land differently than you meant."),
  ]

  var body: some View {
    let canUseAi = did.map { app.session.capabilitiesFor($0).canUseAi } ?? false
    if !canUseAi {
      SettingsSectionView(title: "Post adviser", sub: "Reads a post against goals you set, and proofreads it, before it goes out.") {
        NeedsBackendNotice(did: did)
          .padding(.vertical, theme.rowPadLg)
      }
    } else {
      enabledCard
    }
  }

  private var adviser: AdviserSettings { AdviserSetup.normalizeAdviserSettings(model.settings.adviser) }

  @ViewBuilder
  private var enabledCard: some View {
    let adviser = self.adviser
    SettingsSectionView(
      title: "Post adviser",
      sub:
        "Reads a post against goals you set for yourself, and proofreads it, before it goes out. It never stops a post: you can always publish anyway."
    ) {
      SettingsRow(
        label: "Use the post adviser",
        hint: adviser.enabled
          ? "The composer has a “Check this post” button, and checks posts as set below."
          : "Off. The first time it’s turned on, every check below comes on with it; change any of them after.",
        compactControl: true
      ) {
        SettingsSwitch(label: "Use the post adviser", isOn: adviser.enabled) { _ in
          save(AdviserSetup.nextPostingAdviserState(adviser.json))
        }
        .accessibilityIdentifier("adviser-enabled")
      }
      if adviser.enabled {
        on(adviser)
      }
      usage
      Disclosure("What’s sent, and to whom") { sent }
        .padding(.vertical, theme.rowPadLg)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
      if !error.isEmpty {
        Callout(tone: .danger) { Text(error) }
          .padding(.top, Measure.Settings.calloutSpaceAbove)
      }
    }
    .adviserStyleDialog(isPresented: $styleOpen, did: did, model: model)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("posting-adviser")
  }

  @ViewBuilder
  private func on(_ adviser: AdviserSettings) -> some View {
    SettingsRow(
      label: "Check before posting",
      hint:
        "Reads each post when you press Post (not when you schedule one). If it takes more than 10 seconds or can’t be reached, the post goes out as it is.",
      compactControl: true
    ) {
      SettingsSwitch(label: "Check before posting", isOn: adviser.checkBeforePublish) { on in change { $0.checkBeforePublish = on } }
    }
    if adviser.checkBeforePublish {
      SettingsRow(label: "Stop me", hint: "“When something’s off” stops for a post that goes against a goal, or a slip in the writing.") {
        Segmented(label: "When the check stops a post", options: Self.reviewOptions, selection: adviser.reviewMode, size: .small) { v in
          change { $0.reviewMode = v }
        }
      }
      SettingsRow(label: "Which posts", hint: "A reply to your own post counts as one of your threads. The button checks any post.", block: true) {
        VStack(alignment: .leading, spacing: Measure.Adviser.radiosGap) {
          ForEach(Self.scopeOptions, id: \.key) { option in
            Toggle(
              option.label,
              isOn: Binding(get: { adviser.checkScope == option.key }, set: { if $0 { change { $0.checkScope = option.key } } })
            )
            .toggleStyle(.virgaCheck)
            .accessibilityAddTraits(adviser.checkScope == option.key ? .isSelected : [])
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Which posts")
      }
    }
    SettingsRow(
      label: "Read replies with their conversation",
      hint:
        "For a reply or a quote, the posts it answers are read too, so the adviser can say if you may have misread someone. Those are other people’s public posts.",
      compactControl: true
    ) {
      SettingsSwitch(label: "Read replies with their conversation", isOn: adviser.checkReplyContext) { on in
        change { $0.checkReplyContext = on }
      }
    }
    SettingsRow(
      label: "Your goals", hint: "What a post is read against. The adviser says when one goes against them; it doesn’t rewrite it.",
      block: true
    ) {
      goals(adviser)
    }
    SettingsRow(label: "Proofread", hint: "The slips it looks for. It offers a fix for each; taking one is up to you.", block: true) {
      proofread(adviser)
    }
  }

  private func goals(_ adviser: AdviserSettings) -> some View {
    let topic = adviser.goals.presets.limitTopic
    let topicLimit = AdviserSetup.adviserTextLimits["topic"] ?? 200
    let goalsLimit = AdviserSetup.adviserTextLimits["goalsText"] ?? 500
    return VStack(alignment: .leading, spacing: Measure.Adviser.stackGap) {
      ForEach(Self.goalPresets, id: \.key) { option in
        let key = option.key
        check(
          option.label, option.hint,
          isOn: key == "reduceNegativity" ? adviser.goals.presets.reduceNegativity : adviser.goals.presets.lessConfrontational
        ) { on in
          change { a in
            if key == "reduceNegativity" { a.goals.presets.reduceNegativity = on } else { a.goals.presets.lessConfrontational = on }
          }
        }
      }
      check("Post less about some topics", "Flag a post that leans on them. Separate topics with commas.", isOn: topic.enabled) { on in
        change { $0.goals.presets.limitTopic.enabled = on }
      }
      if topic.enabled {
        TextField(
          "For example: politics, the news",
          text: Binding(
            get: { topic.topic },
            set: { next in change { $0.goals.presets.limitTopic.topic = next.jsSlice(0, topicLimit) } })
        )
        .virgaField()
        .accessibilityLabel("Topics to post less about")
        .padding(.leading, Measure.Adviser.indent)
      }
      VStack(alignment: .leading, spacing: theme.points(ThemeKit.fieldGap)) {
        Text("Goals in your own words").virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
        TextEditor(
          text: Binding(
            get: { adviser.goals.customText },
            set: { next in change { $0.goals.customText = next.jsSlice(0, goalsLimit) } })
        )
        .frame(minHeight: theme.points(ThemeKit.textAreaMinHeight) * Measure.Adviser.notesRows / 3)
        .virgaTextArea()
        .accessibilityLabel("Goals in your own words")
        FieldHint("\(adviser.goals.customText.utf16.count) of \(goalsLimit)")
      }
    }
    .frame(maxWidth: Measure.Adviser.stackMax, alignment: .leading)
  }

  private func proofread(_ adviser: AdviserSettings) -> some View {
    let profile = adviser.writingChecks.styleProfile
    let notesLimit = AdviserSetup.adviserTextLimits["writingNotes"] ?? 500
    let learned = !profile.summary.jsTrimmed().isEmpty
    let line = StyleSessionWords.styleProfileLine(profile)
    return VStack(alignment: .leading, spacing: Measure.Adviser.stackGap) {
      ForEach(Self.writingChecks, id: \.key) { option in
        let key = option.key
        let on = key == "typos" ? adviser.writingChecks.typos : key == "grammar" ? adviser.writingChecks.grammar : adviser.writingChecks.clarity
        check(option.label, option.hint, isOn: on) { next in
          change { a in
            switch key {
            case "typos": a.writingChecks.typos = next
            case "grammar": a.writingChecks.grammar = next
            default: a.writingChecks.clarity = next
            }
          }
        }
      }
      VStack(alignment: .leading, spacing: theme.points(ThemeKit.fieldGap)) {
        Text("Notes for the proofread").virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
        TextEditor(
          text: Binding(
            get: { adviser.writingChecks.customText },
            set: { next in change { $0.writingChecks.customText = next.jsSlice(0, notesLimit) } })
        )
        .frame(minHeight: theme.points(ThemeKit.textAreaMinHeight) * Measure.Adviser.notesRows / 3)
        .virgaTextArea()
        .accessibilityLabel("Notes for the proofread")
        FieldHint("These come before everything else the proofread goes by.")
      }
      FlowLayout(spacing: Measure.Adviser.styleRowGap, lineSpacing: theme.space2) {
        VStack(alignment: .leading, spacing: Measure.Adviser.checkTextGap) {
          Text("Your writing style").virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
          Text(
            learned
              ? "\(line.isEmpty ? "Written by hand" : line). The proofread treats these habits as yours."
              : "Not learned yet. It can be read from your recent posts, so your habits aren’t flagged as slips."
          )
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .fixedSize(horizontal: false, vertical: true)
        }
        .frame(minWidth: Measure.Adviser.styleWordsMin, alignment: .leading)
        Button {
          styleOpen = true
        } label: {
          Label(learned ? "See or change it" : "Learn my style", systemImage: AdviserGlyph.book)
        }
        .buttonStyle(.virga(size: .small))
        .accessibilityIdentifier("adviser-learn-style")
      }
      .padding(.top, Measure.Adviser.styleRowTop)
      .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
    }
    .frame(maxWidth: Measure.Adviser.stackMax, alignment: .leading)
  }

  /// `.adviser-check`: a box, and its label over its hint.
  private func check(_ label: String, _ hint: String, isOn: Bool, onChange: @escaping (Bool) -> Void) -> some View {
    Toggle(isOn: Binding(get: { isOn }, set: onChange)) {
      VStack(alignment: .leading, spacing: Measure.Adviser.checkTextGap) {
        Text(label).virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
        Text(hint).virgaText(.textSm).foregroundStyle(theme.muted).fixedSize(horizontal: false, vertical: true)
      }
    }
    .toggleStyle(.virgaCheck)
  }

  @ViewBuilder
  private var usage: some View {
    let now = SyncStatus.now()
    let store = app.stores.keyValue
    let lines = [AdviserUsageFeature.adviser, .style, .altText].map { feature in
      AdviserUsageStore.adviserUsageLine(
        AdviserUsageStore.readAdviserUsage(did, feature: feature, now: now, store: store), feature: feature, now: now)
    }.filter { !$0.isEmpty }
    if !lines.isEmpty {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(lines, id: \.self) { Text($0) }
      }
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
      .padding(.vertical, theme.rowPadLg)
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    }
  }

  private var sent: some View {
    let host = AppConfig.backendHost(app.flags.backendURL)
    let items = [
      "the post’s text, your goals, your notes for the proofread and your style description;",
      "with “Read replies with their conversation” on, the posts a reply or quote answers: other people’s public posts and their names;",
      "to learn your style, your recent public posts; to describe an image, the image and the post’s text.",
    ]
    return VStack(alignment: .leading, spacing: Measure.Adviser.sentGap) {
      Text(
        "Only when the adviser reads a post, or you ask for a description or a style reading, this goes to Virga’s server (\(host)), signed in as this account:"
      )
      VStack(alignment: .leading, spacing: Measure.Adviser.sentListGap) {
        ForEach(items, id: \.self) { item in
          HStack(alignment: .firstTextBaseline, spacing: theme.space2) {
            Text("•").accessibilityHidden(true)
            Text(item)
          }
        }
      }
      .padding(.leading, Measure.Adviser.sentListInset / 2)
      Text(
        "Virga’s server passes it, with this account’s DID for counting use, to an AI model through an AI gateway, and sends the answer back. It doesn’t store what was sent; whether the model’s provider keeps it is set by the gateway’s account settings, not per request. Virga’s server keeps only counts: how many uses this account has had each month and each day. Your goals, notes and style description are kept only in this browser."
      )
    }
    .virgaText(.textSm)
    .foregroundStyle(theme.ink2)
    .fixedSize(horizontal: false, vertical: true)
    .frame(maxWidth: theme.characters(Measure.Adviser.sentMeasure), alignment: .leading)
    .padding(.top, Measure.Adviser.sentTop)
  }

  // MARK: Saving

  private func save(_ next: JSONValue) {
    do {
      try model.update(["adviser": next])
      error = ""
    } catch {
      self.error = PostingSettingsSave.message(error)
    }
  }

  /// `patch(fields)`: the setup as it is now, with one change, saved.
  private func change(_ edit: (inout AdviserSettings) -> Void) {
    var next = adviser
    edit(&next)
    save(next.json)
  }
}
#endif
