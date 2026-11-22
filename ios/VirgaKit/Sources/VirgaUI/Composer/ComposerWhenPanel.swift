// Ports src/posting/composer/Composer.jsx (the when panel, "Goes into your weekly queue", the scheduled copy that couldn't be taken off)
// Ports src/posting/composer/composer.css (.when-panel, .when-panel-head, .composer-timer-note, .link-button)
//
// Under the post's settings, once Schedule is pressed (or the post opened
// as a scheduled one): Schedule for later with the WhenPicker, or Into your
// weekly queue with the next open time, each with Post now instead. A post
// headed for the queue with the panel shut says so in a line, with Change.
// Over the post, the scheduled copy a post that went out couldn't take
// off, with Cancel the scheduled copy and Close.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting

struct ComposerWhenPanel: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController
  let disabled: Bool

  /// The panel's place in the composer's scroll, to bring it into view as it opens.
  static let anchor = "composer-when-panel"

  var body: some View {
    let state = controller.state
    let mode = state.schedule?.mode ?? ""
    let open = controller.scheduling.whenOpen
    Group {
      if open && (mode == "at" || mode == "queue") {
        panel(mode: mode)
          .id(Self.anchor)
      } else if !open && mode == "queue" {
        queueNote
      }
    }
    .task(id: "\(mode)|\(controller.asDid)") {
      if mode == "queue" { await controller.readQueuePreview() }
    }
  }

  private func panel(mode: String) -> some View {
    // On a phone the settings' rows above already end on a hairline, so
    // the panel right under them draws no rule of its own (4 of padding).
    let underRows = theme.composerNarrow && !controller.optionsNoteShown
    return VStack(alignment: .leading, spacing: Measure.Schedule.panelGap) {
      // What it is on the left, the way back to posting now on the right,
      // on one baseline; wrapped when they don't fit.
      ViewThatFits(in: .horizontal) {
        HStack(alignment: .firstTextBaseline, spacing: Measure.Schedule.panelHeadGap) {
          head(mode: mode)
          Spacer(minLength: 0)
          postNow
        }
        FlowLayout(spacing: Measure.Schedule.panelHeadGap, lineSpacing: Measure.Schedule.panelHeadLineGap, alignment: .firstTextBaseline) {
          head(mode: mode)
          postNow
        }
      }
      if mode == "at" {
        picker
      } else {
        queuePreview
      }
    }
    .padding(.top, underRows ? ComposerMeasure.whenPanelUnderRows : Measure.Schedule.panelTop)
    .overlay(alignment: .top) {
      if !underRows { Rectangle().fill(theme.line).frame(height: 1) }
    }
    .disabled(disabled)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("When it goes out")
    .accessibilityIdentifier("when-panel")
  }

  private func head(mode: String) -> some View {
    FieldLabel(mode == "queue" ? "Into your weekly queue" : "Schedule for later")
  }

  private var postNow: some View {
    Button("Post now instead") { controller.postNowInstead() }
      .buttonStyle(.linkAction)
      .disabled(disabled)
      .accessibilityIdentifier("when-post-now")
  }

  private var picker: some View {
    let state = controller.state
    let replying = state.reply != nil
    let now = ScheduleText.now()
    return WhenPicker(
      schedule: controller.settings.queue.json, value: state.schedule?.at,
      onChange: { controller.setWhen($0) }, queue: !replying, requester: controller.requester,
      onQueue: { controller.dispatch(.setSchedule(.queue)) },
      min: now + PostingQueue.minLeadMs, max: now + Double(PostingQueue.queueHorizonDays) * 86_400_000,
      repeatRule: state.schedule?.json["repeat"].flatMap { $0.isTruthy ? $0 : nil },
      onRepeatChange: { controller.setRepeat($0) },
      repeatBlock: replying ? Repeat.repeatReplyHint : "", occurrence: controller.editingOccurrence)
  }

  /// The queue's next slot, before it's used, and the way back to a time.
  private var queuePreview: some View {
    let preview = controller.scheduling.preview
    let said: String
    if preview.status == "loading" {
      said = "Finding the next open time…"
    } else if preview.status == "error" {
      said = "Couldn’t read your queue just now; the time is found when you add it."
    } else if let at = preview.at {
      let when = AppLocale.toLocaleString(
        date: TimeValue.ms(.string(at)),
        DateFormatOptions(weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"),
        locale: AppLocale.activeLocale())
      said = "Goes out at the next open time: \(when)."
    } else {
      said = "Your weekly schedule has no open times in the next 90 days."
    }
    return FlowLayout(spacing: Measure.Schedule.noteGap, lineSpacing: 0, alignment: .firstTextBaseline) {
      FieldHint(said).fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("when-queue-preview")
      Button("Pick a time instead") {
        controller.dispatch(.setSchedule(.at(ComposerController.nextHour())))
      }
      .buttonStyle(WordsButtonStyle())
    }
  }

  /// With the panel shut, a post headed for the queue says so.
  private var queueNote: some View {
    FlowLayout(spacing: Measure.Schedule.noteGap, lineSpacing: 0, alignment: .center) {
      Image(systemName: ScheduleGlyph.listTree)
        .font(.system(size: Measure.Schedule.noteIcon))
        .foregroundStyle(theme.muted)
        .accessibilityHidden(true)
      FieldHint("Goes into your weekly queue.")
      Button("Change") { controller.scheduling.whenOpen = true }
        .buttonStyle(WordsButtonStyle())
        .disabled(disabled)
        .accessibilityIdentifier("when-change")
    }
    .padding(.top, -Measure.Schedule.noteLift)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("when-queue-note")
  }
}

/// `.link-button`: a thing to press that reads as words, in ink with a line under it.
struct WordsButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    WordsButtonBody(label: configuration.label)
  }
}

struct WordsButtonBody<Label: View>: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  let label: Label

  var body: some View {
    label
      .virgaText(.textSm, weight: VirgaWeight.medium)
      .foregroundStyle(theme.ink)
      .underline()
      .opacity(isEnabled ? 1 : ThemeKit.disabledOpacity)
      // A link action's reach: pressed past its words without making the hint's line taller.
      .touchReach(horizontal: Measure.LinkAction.reachSides, vertical: Measure.LinkAction.reachAbove)
  }
}

/// The scheduled copy a post that went out couldn't take off, and what to do.
struct ComposerSourceWarning: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController

  var body: some View {
    let warning = controller.scheduling.sourceWarning
    if !warning.isEmpty {
      // role="alert": its words, and the two ways on at their right.
      Callout(tone: .danger, alert: warning) {
        ComposerCalloutLine(warning) {
          Button("Cancel the scheduled copy") { controller.retryCancelSource() }
            .buttonStyle(.virga(size: .small))
          Button("Close") { controller.resetAfterSend(controller.state.asDid) }
            .buttonStyle(.virga(.ghost, size: .small))
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("composer-source-warning")
    }
  }
}
#endif
