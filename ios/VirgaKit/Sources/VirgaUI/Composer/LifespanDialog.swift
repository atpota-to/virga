// Ports src/posting/composer/ComposerDialogs.jsx (LifespanDialog)
//
// The post's timer, in a dialog over the composer: the timer's editor
// (LifespanRuleEditor, LifespanEditor.jsx) over a copy of the post's rule,
// taken as the dialog opens and kept while it's up (the composer redraws
// meanwhile, a read finishing or the default timer changing, and that
// mustn't undo what's being chosen), and given to the post with Done. Why
// the post has no timer, or that the one chosen has no room (the composer's
// timerNote), is a warning over the editor.
//
// `fit` says what the post is (a reply, a thread), `publishAt` when it goes
// out (its scheduled time, else now), `limits` the account's (the free
// timers), `did` the writer (its lists for "Limit replies"), `holds` the
// timer a scheduled post being edited already has.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaNetwork
import VirgaPosting

struct LifespanDialog: View {
  let fit: LifespanEditorFit
  let publishAt: String?
  let limits: JSONValue?
  let did: String
  let holds: JSONValue?
  let note: String
  let transport: any HTTPTransport
  let onSave: (JSONValue) -> Void
  let onClose: () -> Void
  /// The rule being chosen: the post's as the dialog opened (`useState(value)`),
  /// then each one the editor hands back.
  @State private var rule: JSONValue

  init(
    value: JSONValue, fit: LifespanEditorFit, publishAt: String?, limits: JSONValue?, did: String, holds: JSONValue?,
    note: String, transport: any HTTPTransport, onSave: @escaping (JSONValue) -> Void, onClose: @escaping () -> Void
  ) {
    self.fit = fit
    self.publishAt = publishAt
    self.limits = limits
    self.did = did
    self.holds = holds
    self.note = note
    self.transport = transport
    self.onSave = onSave
    self.onClose = onClose
    _rule = State(initialValue: value)
  }

  var body: some View {
    DialogFrame(title: "Timer", onClose: onClose) {
      DialogForm {
        if !note.isEmpty {
          Callout(tone: .warn) { Text(note) }
            .accessibilityIdentifier("lifespan-dialog-note")
        }
        editor
      }
    } actions: {
      Button("Cancel", action: onClose)
        .buttonStyle(.virga)
        .accessibilityIdentifier("lifespan-dialog-cancel")
      Button("Done", action: done)
        .buttonStyle(.virga(.primary))
        .accessibilityIdentifier("lifespan-dialog-done")
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("lifespan-dialog")
  }

  private var editor: some View {
    LifespanRuleEditor(
      value: SelfDestruct.normalizeTimer(rule),
      onChange: { next in rule = next.json },
      fit: fit, publishAt: publishAt, limits: limits, did: did, holds: holds, transport: transport)
  }

  private func done() {
    onSave(rule)
    onClose()
  }
}
#endif
