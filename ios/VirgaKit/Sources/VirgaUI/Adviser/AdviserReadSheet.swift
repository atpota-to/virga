// Ports src/posting/ui/AdviserSheet.jsx
// Ports src/posting/ui/adviser.css (.adviser-sheet, .adviser-read, .adviser-verdict, .adviser-draft, .adviser-mark, .adviser-fix, .adviser-notes, .adviser-met, .adviser-context, .adviser-empty, .adviser-skeleton)
//
// What the adviser made of a post (VirgaPosting's AdviserGateController
// hands it over as the sheet's read): the overall verdict, each goal's
// verdict, the post marked up (a slip struck through with its fix beside
// it, tap to take it; a passage a goal flags underlined and numbered to its
// note), the fixes to take one at a time or all at once, and the way past
// it. Facts only, no rewrites; it never stops a post on its own. A sheet,
// full height on a phone, with its buttons in the foot. While a read is
// still loading it shows a skeleton shaped like the read.
//
// A fix is a link inside the run of words (a span with a button's role, as
// on the web, so a long fix can break across lines); a numbered note lights
// its passage for a moment rather than scrolling to it, since the marked
// post is never long.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting

extension View {
  /// The adviser's sheet over this view while the gate model has a read.
  func adviserSheet(_ adviser: AdviserGateModel) -> some View {
    modifier(AdviserSheetPresenter(adviser: adviser))
  }
}

struct AdviserSheetPresenter: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  let adviser: AdviserGateModel

  func body(content: Content) -> some View {
    content.sheet(isPresented: Binding(get: { adviser.sheetOpen }, set: { if !$0 { adviser.closeSheet() } })) {
      if let read = adviser.sheet {
        AdviserReadSheet(
          read: read,
          onApplyFix: { fixes in adviser.applyFix(fixes) },
          onPublishAnyway: read.canPublish ? { adviser.publishFromSheet() } : nil,
          onKeepEditing: { adviser.keepEditingFromSheet() },
          onSaveDraft: read.canSaveDraft ? { adviser.saveDraftFromSheet() } : nil)
          .presentationDetents([.large])
          .presentationBackground(theme.surface)
          .presentationCornerRadius(Measure.Dialog.radius)
      }
    }
  }
}

struct AdviserReadSheet: View {
  @Environment(\.virgaTheme) private var theme
  let read: AdviserSheetRead?
  var onApplyFix: (([AdviserSheetFix]) -> Void)?
  var onPublishAnyway: (() -> Void)?
  let onKeepEditing: () -> Void
  var onSaveDraft: (() -> Void)?
  var busy = false

  var body: some View {
    let actions = AdviserSheetView.sheetActions(read?.json, canPublish: onPublishAnyway != nil, canSaveDraft: onSaveDraft != nil)
    DialogFrame(title: AdviserSheetView.sheetTitle(read?.json), onClose: onKeepEditing, hasActions: true) {
      Group {
        if busy {
          AdviserSkeleton(count: read?.goalItems.count ?? 2)
        } else if let read {
          if read.status == "ready" {
            AdviserReadView(read: read, onApplyFix: onApplyFix)
          } else {
            AdviserNotice(read: read)
          }
        }
      }
      .accessibilityIdentifier("adviser-sheet")
    } actions: {
      if busy {
        Button("Keep editing", action: onKeepEditing).buttonStyle(.virga)
      } else if actions.closeOnly {
        Button("Close", action: onKeepEditing).buttonStyle(.virga(.primary))
          .accessibilityIdentifier("adviser-close")
      } else {
        Button("Keep editing", action: onKeepEditing)
          .buttonStyle(.virga(actions.primary == "edit" ? .primary : .quiet))
          .accessibilityIdentifier("adviser-sheet-keep-editing")
        if actions.draft, let onSaveDraft {
          Button("Save as draft", action: onSaveDraft).buttonStyle(.virga)
        }
        if let publish = actions.publish, let onPublishAnyway {
          Button(publish.label, action: onPublishAnyway)
            .buttonStyle(.virga(actions.primary == "publish" ? .primary : .quiet))
            .accessibilityIdentifier("adviser-sheet-publish")
        }
      }
    }
  }
}

/// Everything that isn't a read: an empty post, nothing set up, none left, a failure.
struct AdviserNotice: View {
  @Environment(\.virgaTheme) private var theme
  let read: AdviserSheetRead

  var body: some View {
    switch read.status {
    case "error":
      Callout(tone: .danger, systemImage: AdviserGlyph.conflict) {
        VStack(alignment: .leading, spacing: theme.space1) {
          Text(read.error.flatMap { $0.isEmpty ? nil : $0 } ?? "The adviser couldn’t read this post.")
          Text("Nothing was changed. You can try again, or post it as it is.")
        }
      }
    case "limit":
      empty(
        AdviserGlyph.sparkles, "This month’s free checks are used up",
        "\(read.usageLine.isEmpty ? "They start again on the first of next month." : read.usageLine) Checks are counted for each account.")
    case "empty":
      empty(
        AdviserGlyph.sparkles, "Nothing to check against yet",
        "The adviser reads a post against goals you set, like a gentler tone or posting less about a topic, and can proofread it for typos. Choose what it checks in Settings › Posting, under Post adviser."
      )
    default:
      empty(AdviserGlyph.pen, "Write something first", "Then ask the adviser what it thinks.")
    }
  }

  private func empty(_ symbol: String, _ title: String, _ words: String) -> some View {
    VStack(alignment: .leading, spacing: Measure.Adviser.emptyGap) {
      Image(systemName: symbol)
        .font(.system(size: Measure.Adviser.emptyIcon))
        .foregroundStyle(theme.ink2)
        .padding(.bottom, theme.space1)
        .accessibilityHidden(true)
      Text(title).virgaText(.textMd, weight: VirgaWeight.semibold).foregroundStyle(theme.ink)
      Text(words)
        .virgaText(.textBase)
        .foregroundStyle(theme.ink2)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: theme.characters(Measure.Adviser.emptyMeasure), alignment: .leading)
    }
    .padding(.top, Measure.Adviser.emptyTop)
    .padding(.bottom, Measure.Adviser.emptyBottom)
    .accessibilityElement(children: .combine)
  }
}

/// `AdviserRead`: the verdict, the marked post, the notes, what it's fine
/// against, what it was read with, and the month's checks.
struct AdviserReadView: View {
  @Environment(\.virgaTheme) private var theme
  let read: AdviserSheetRead
  let onApplyFix: (([AdviserSheetFix]) -> Void)?
  /// The note whose passage is lit for a moment.
  @State private var shown: String?

  var body: some View {
    let model = read.model
    let taken = read.taken
    let remaining = model.fixes.filter { !taken.jsIncludes($0.key) }
    let tally = AdviserSheet.adviserWritingTally(model, taken: taken)
    let total = model.posts.count
    let visible = model.posts.enumerated().filter { !$0.element.text.jsTrimmed().isEmpty }
    let contextLine = AdviserSheetView.sheetContextLine(read.json)
    VStack(alignment: .leading, spacing: Measure.Adviser.readGap) {
      if let verdict = model.verdict {
        HStack(spacing: Measure.Adviser.verdictGap) {
          Image(systemName: Self.verdictGlyph(verdict))
            .font(.system(size: Measure.Adviser.verdictIcon))
            .foregroundStyle(Self.tone(verdict, theme))
            .accessibilityHidden(true)
          Text(AdviserSheetView.verdictCopy[verdict] ?? "")
            .virgaText(.textMd, weight: VirgaWeight.semibold)
            .foregroundStyle(theme.ink)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("adviser-verdict")
      }
      VStack(alignment: .leading, spacing: Measure.Adviser.draftGap) {
        FlowLayout(spacing: Measure.Adviser.draftMetaGap, lineSpacing: theme.space1) {
          Text(Self.capitalise(AdviserSheet.adviserDraftLabel(read.scenario, !(read.context?.thread ?? []).isEmpty)))
          if let tone = model.tone { Text("Tone: \(tone)") }
        }
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
        VStack(alignment: .leading, spacing: Measure.Adviser.draftPostsGap) {
          ForEach(Array(visible), id: \.offset) { index, post in
            draftPost(post, index: index, total: total, model: model, taken: taken)
          }
        }
        if let tally {
          HStack(spacing: Measure.Adviser.tallyGap) {
            Text(tally)
              .virgaText(.textSm)
              .foregroundStyle(theme.muted)
              .accessibilityAddTraits(.updatesFrequently)
            Spacer(minLength: 0)
            if !remaining.isEmpty, let onApplyFix {
              Button {
                onApplyFix(remaining)
              } label: {
                Label(AdviserSheetView.fixAllLabel(remaining.count), systemImage: AdviserGlyph.check)
              }
              .buttonStyle(.virga(size: .small))
              .accessibilityIdentifier("adviser-fix-all")
            }
          }
          .frame(minHeight: Measure.Adviser.tallyHeight)
        }
      }
      .padding(.top, Measure.Adviser.draftTop)
      .overlay(alignment: .top) { Rectangle().fill(theme.rule).frame(height: 1) }
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Your post, marked up")
      if !model.notes.isEmpty {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(model.notes, id: \.key) { note in
            noteRow(note)
          }
        }
        .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("What it noticed")
      }
      if !model.met.isEmpty {
        FlowLayout(spacing: Measure.Adviser.metGap, lineSpacing: Measure.Adviser.metRowGap) {
          Text("Fine against").virgaText(.textSm).foregroundStyle(theme.muted)
          ForEach(Array(model.met.enumerated()), id: \.offset) { _, label in
            HStack(spacing: Measure.Adviser.metItemGap) {
              Image(systemName: AdviserGlyph.check).font(.system(size: Measure.Adviser.metIcon)).foregroundStyle(theme.ok)
                .accessibilityHidden(true)
              Text(label.jsString).virgaText(.textSm).foregroundStyle(theme.ink2)
            }
            .padding(Measure.Adviser.goalPadding)
            .overlay(Capsule().strokeBorder(theme.line, lineWidth: 1))
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Goals it’s fine against")
      }
      if !contextLine.isEmpty {
        HStack(alignment: .top, spacing: Measure.Adviser.contextGap) {
          Image(systemName: AdviserGlyph.info).font(.system(size: Measure.Adviser.contextIcon)).padding(.top, 3).accessibilityHidden(true)
          Text(contextLine).fixedSize(horizontal: false, vertical: true)
        }
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
      }
      if !read.usageLine.isEmpty {
        Text(read.usageLine).virgaText(.textSm).foregroundStyle(theme.muted)
      }
    }
    .environment(
      \.openURL,
      OpenURLAction { url in
        // A fix inside the words: adviser-fix:<key>.
        if url.scheme == "adviser-fix", let onApplyFix {
          let key = url.absoluteString.jsSlice("adviser-fix:".utf16.count).removingPercentEncoding ?? ""
          if let fix = model.fixes.first(where: { $0.key.jsEquals(key) }) { onApplyFix([fix]) }
          return .handled
        }
        return .systemAction
      })
  }

  private func draftPost(_ post: AdviserMarkedPost, index: Int, total: Int, model: AdviserSheetModel, taken: [String]) -> some View {
    let label = AdviserSheetView.postIndexLabel(index, total)
    var words = Text("")
    if !label.isEmpty {
      words = Text("\(label)  ").font(theme.font(size: theme.textSm, weight: VirgaWeight.medium)).foregroundColor(theme.muted)
    }
    for segment in post.segments {
      words = words + self.segment(segment, model: model, taken: taken, underline: nil, keys: [])
    }
    return words
      .virgaText(.textMd, lineHeight: Measure.Adviser.draftLineHeight)
      .foregroundStyle(theme.ink)
      .tint(theme.ink)
      .fixedSize(horizontal: false, vertical: true)
  }

  /// One piece of a marked post, as text: plain words, a fix (struck
  /// through with its replacement, a link to take it, or the replacement
  /// underlined once taken), or a passage a goal flags (underlined in its
  /// tone, numbered to its notes).
  private func segment(_ segment: AdviserSegment, model: AdviserSheetModel, taken: [String], underline: Color?, keys: [String]) -> Text {
    switch segment {
    case .text(let text):
      var piece = AttributedString(text)
      if let underline {
        piece.underlineStyle = Text.LineStyle(pattern: .solid, color: underline)
        if let shown, keys.jsIncludes(shown) { piece.backgroundColor = theme.accentTint }
      }
      return Text(piece)
    case .fix(let key, let text):
      guard let fix = model.fixes.first(where: { $0.key.jsEquals(key) }) else { return Text(text) }
      let found = fix.issue["found"]?.stringValue ?? text
      let replacement = fix.issue["replacement"]?.stringValue ?? ""
      if taken.jsIncludes(key) {
        var done = AttributedString(replacement)
        done.underlineStyle = Text.LineStyle(pattern: .solid, color: theme.ok)
        return Text(done)
      }
      var gone = AttributedString(found)
      gone.strikethroughStyle = Text.LineStyle(pattern: .solid, color: theme.muted)
      gone.foregroundColor = theme.muted
      gone.backgroundColor = theme.surface3
      var put = AttributedString(" \(replacement)")
      put.foregroundColor = theme.ink
      put.backgroundColor = theme.surface3
      put.font = theme.font(size: theme.textMd, weight: VirgaWeight.semibold)
      if onApplyFix != nil {
        let link = URL(string: "adviser-fix:\(key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? key)")
        gone.link = link
        put.link = link
      }
      return Text(gone + put)
    case .span(let keys, let children):
      let marks = keys.compactMap { model.mark($0) }
      let tone = ["conflict", "caution", "note"].first { t in marks.contains { $0.tone == t } } ?? "note"
      let colour = tone == "conflict" ? theme.danger : tone == "caution" ? theme.warn : theme.faint
      var out = Text("")
      for child in children {
        out = out + self.segment(child, model: model, taken: taken, underline: colour, keys: keys)
      }
      let numbers = marks.map(\.number).sorted()
      if !numbers.isEmpty {
        out = out + Text(numbers.map(String.init).joined(separator: ","))
          .font(theme.font(size: theme.textMd * 0.7, weight: VirgaWeight.semibold))
          .baselineOffset(theme.textMd * 0.35)
          .foregroundColor(tone == "note" ? theme.muted : colour)
      }
      return out
    }
  }

  @ViewBuilder
  private func noteRow(_ note: AdviserSheetNote) -> some View {
    let words = HStack(alignment: .top, spacing: Measure.Adviser.noteGap) {
      marker(note)
      FlowLayout(spacing: Measure.Adviser.noteWordsGap, lineSpacing: Measure.Adviser.noteWordsLineGap, alignment: .firstTextBaseline) {
        if note.kind == "goal" {
          Text(note.label?.jsString ?? "").virgaText(.textBase, weight: VirgaWeight.semibold).foregroundStyle(theme.ink)
          Text(AdviserSheetView.statusWords[note.tone] ?? "").virgaText(.textBase).foregroundStyle(theme.muted)
        } else {
          Text(AdviserSheetView.writingTypeLabels[note.type?.stringValue ?? ""] ?? "Writing")
            .virgaText(.textBase, weight: VirgaWeight.semibold).foregroundStyle(theme.ink)
          if let detail = note.detail, !detail.isEmpty {
            Text(detail).virgaText(.textBase).foregroundStyle(theme.muted).fixedSize(horizontal: false, vertical: true)
          }
        }
      }
      .padding(.top, 1)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.vertical, Measure.Adviser.notePadding)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    if note.number != nil {
      Button {
        show(note.key)
      } label: {
        words.contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("\(Self.noteText(note)). Show it in the post")
    } else {
      words.accessibilityElement(children: .combine)
    }
  }

  private func marker(_ note: AdviserSheetNote) -> some View {
    let fill = note.tone == "conflict" ? theme.dangerWash : note.tone == "caution" ? theme.warnWash : theme.surface3
    let ink = note.tone == "conflict" ? theme.danger : note.tone == "caution" ? theme.warn : theme.ink2
    return Group {
      if let number = note.number {
        Text("\(number)").virgaText(.textXs, weight: VirgaWeight.semibold)
      } else {
        Image(systemName: note.tone == "conflict" ? AdviserGlyph.conflict : note.tone == "caution" ? AdviserGlyph.caution : AdviserGlyph.info)
          .font(.system(size: Measure.Adviser.noteMarkerIcon))
      }
    }
    .foregroundStyle(ink)
    .padding(.horizontal, Measure.Adviser.noteMarkerPadding)
    .frame(minWidth: Measure.Adviser.noteMarker, minHeight: Measure.Adviser.noteMarker)
    .background(Capsule().fill(fill))
    .accessibilityHidden(true)
  }

  /// A numbered note lights its passage for a moment.
  private func show(_ key: String) {
    shown = key
    Task { @MainActor in
      try? await Task.sleep(nanoseconds: UInt64(Measure.Adviser.markShownSeconds * 1_000_000_000))
      if shown == key { shown = nil }
    }
  }

  static func noteText(_ note: AdviserSheetNote) -> String {
    if note.kind == "goal" { return "\(note.label?.jsString ?? ""): \(AdviserSheetView.statusWords[note.tone] ?? "")" }
    let label = AdviserSheetView.writingTypeLabels[note.type?.stringValue ?? ""] ?? "Writing"
    return note.detail.flatMap { $0.isEmpty ? nil : "\(label): \($0)" } ?? label
  }

  static func capitalise(_ s: String) -> String {
    guard let first = s.first else { return s }
    return first.uppercased() + s.dropFirst()
  }

  static func verdictGlyph(_ verdict: String) -> String {
    verdict == "ok" ? AdviserGlyph.ok : verdict == "caution" ? AdviserGlyph.caution : AdviserGlyph.conflict
  }

  static func tone(_ verdict: String, _ theme: VirgaTheme) -> Color {
    verdict == "ok" ? theme.ok : verdict == "caution" ? theme.warn : theme.danger
  }
}

/// `AdviserSkeleton`: the read's shape while it loads (verdict, the post, the goals).
struct AdviserSkeleton: View {
  @Environment(\.virgaTheme) private var theme
  var count = 2
  @State private var dim = false

  var body: some View {
    let goals = max(1, min(count, 5))
    VStack(alignment: .leading, spacing: Measure.Adviser.readGap) {
      GeometryReader { g in bone(g.size.width * Measure.Adviser.skeletonVerdictShare, Measure.Adviser.skeletonVerdictHeight) }
        .frame(height: Measure.Adviser.skeletonVerdictHeight)
      VStack(alignment: .leading, spacing: Measure.Adviser.draftGap) {
        ForEach(Array([Measure.Adviser.skeletonShortShare, 1, 1, 0.6].enumerated()), id: \.offset) { _, share in
          GeometryReader { g in bone(g.size.width * share, Measure.Adviser.skeletonLineHeight) }
            .frame(height: Measure.Adviser.skeletonLineHeight)
        }
      }
      .padding(.top, Measure.Adviser.draftTop)
      .overlay(alignment: .top) { Rectangle().fill(theme.rule).frame(height: 1) }
      FlowLayout(spacing: Measure.Adviser.goalsGap, lineSpacing: Measure.Adviser.goalsGap) {
        ForEach(0..<goals, id: \.self) { _ in
          Capsule().fill(theme.surface3).frame(width: Measure.Adviser.skeletonChip.width, height: Measure.Adviser.skeletonChip.height)
        }
      }
    }
    .opacity(dim ? Measure.Adviser.pulseLow : 1)
    .onAppear {
      guard !theme.reduceMotion else { return }
      withAnimation(.easeInOut(duration: Measure.Adviser.pulseSeconds / 2).repeatForever(autoreverses: true)) { dim = true }
    }
    .accessibilityHidden(true)
  }

  private func bone(_ width: CGFloat, _ height: CGFloat) -> some View {
    RoundedRectangle(cornerRadius: theme.radiusSm).fill(theme.surface3).frame(width: width, height: height)
  }
}
#endif
