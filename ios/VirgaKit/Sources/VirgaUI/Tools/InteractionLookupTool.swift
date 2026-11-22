// Ports src/tools/InteractionLookup.jsx (the page, the address, PersonSearch, PairCount, StartingPoint)
// Ports src/tools/tools.css (.lookup-search, .lookup-options, .lookup-option, .lookup-status, .lookup-pair, .lookup-legend, .lookup-start, .lookup-pick)
//
// Your whole history with one account, from what the archive already
// holds: who follows whom, every like, repost, reply, quote and mention on
// record, and when. The two directions are never added together: "them to
// you" and "you to them" sit side by side, in the same two colours all the
// way down. The chosen account lives in the address (`?who=<did>` on the
// navigator), so a history can be linked to and gone back to. Nothing is
// written anywhere, and nothing is fetched but the profile of an account
// the archive hasn't met (through the session's network: the made-up
// world's in the demo).
//
// The search's suggestions float over the page under the field; on a
// hardware keyboard ↑ and ↓ move through them, Return takes one and
// Escape closes them.

#if canImport(UIKit)
import SwiftUI
import UIKit
import VirgaArchive
import VirgaCore
import VirgaInsights
import VirgaNetwork

enum InteractionLookup {
  static let startPage = 12
  static let postsPage = 5
  static let eventsPage = 30
  /// How many of the busiest accounts get their names read up front, so
  /// the search can find them by name.
  static let namesUpFront = 50

  static let directionLabel = ["in": "Them to you", "out": "You to them"]
  static let kindOne = ["like": "a like", "repost": "a repost", "reply": "a reply", "quote": "a quote", "mention": "a mention"]

  static func nounOf(_ n: Int, _ one: String, _ many: String) -> String {
    "\(AppLocale.fmtInt(Double(n))) \(n == 1 ? one : many)"
  }

  /// `String(x).replace(/[^a-z0-9.-]+/gi, '-')`.
  static func fileSafe(_ text: String) -> String {
    var out = ""
    var inRun = false
    for scalar in text.unicodeScalars {
      let v = scalar.value
      let kept = (0x30...0x39).contains(v) || (0x41...0x5A).contains(v) || (0x61...0x7A).contains(v) || v == 0x2E || v == 0x2D
      if kept {
        out.unicodeScalars.append(scalar)
        inRun = false
      } else if !inRun {
        out += "-"
        inRun = true
      }
    }
    return out
  }

  /// The directory's cards: the resolved profile, else the follower row.
  @MainActor
  static func directory(_ archive: ArchiveModel, sets: RelationSets) -> [DirectoryPerson] {
    InteractionModel.peopleDirectory(ReportArchive(archive)) { did in
      if let card = archive.actors[did] { return card }
      return sets.followerCard(did).map { ActorCard(did: $0.did, handle: $0.handle, displayName: $0.displayName, avatar: $0.avatar) }
    }
  }
}

struct InteractionLookupTool: View {
  @Environment(AppModel.self) private var app
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  @Environment(ShellNavigator.self) private var navigator: ShellNavigator?
  let tool: ToolEntry

  var body: some View {
    if let archive {
      LookupPage(tool: tool, archive: archive, navigator: navigator, network: app.archiveEnvironment)
        .id(archive.did)
    } else {
      VirgaPage(header: ToolHeader.header(tool)) { EmptyView() }
    }
  }
}

/// The page: the chosen account's history, or the search and the people
/// you interact with most.
struct LookupPage: View {
  @Environment(\.virgaTheme) private var theme
  let tool: ToolEntry
  let archive: ArchiveModel
  let navigator: ShellNavigator?
  let network: ArchiveEnvironment
  /// How looking up an address that names a handle rather than a DID
  /// ended: for which, and "missing" or "failed".
  @State private var resolved: (named: String, status: String)?

  private var search: String { navigator?.search ?? "" }

  /// `useWho()`: the chosen account, from the address.
  private var who: String? {
    JSURI.searchParam(search, "who").flatMap { $0.isEmpty ? nil : $0 }
  }

  /// Choosing someone is a move of the address; nil clears it.
  private func choose(_ next: String?) {
    let href = InteractionModel.lookupHref(next, search)
    guard let navigator else { return }
    if href.jsEquals(navigator.path + navigator.search) { return }
    navigator.navigate(href, keepQuery: false)
  }

  var body: some View {
    let sets = ReportModels.relationSets(ReportArchive(archive))
    let directory = InteractionLookup.directory(archive, sets: sets)
    let who = self.who
    let named = who.flatMap { InteractionModel.isDid($0) ? nil : $0 }
    let namedHandle = named.flatMap { InteractionModel.parseActorInput($0)?.value }
    Group {
      if let who, named == nil {
        ChosenHistory(
          tool: tool, archive: archive, who: who, sets: sets,
          search: AnyView(PersonSearch(directory: directory, network: network, onChoose: { choose($0) }).zIndex(1)),
          onClear: { choose(nil) }
        )
        .id(who)
      } else {
        let state: String? = named == nil ? nil : namedHandle == nil ? "missing" : (resolved?.named).jsEquals(named) ? resolved?.status : "looking"
        VirgaPage(header: ToolHeader.header(tool)) {
          PersonSearch(
            directory: directory, network: network, onChoose: { choose($0) },
            hint: "Suggestions are the people your archive knows. To look up anyone else, type their whole handle or their DID."
          )
          .zIndex(1)
          if state == "looking", let named {
            EmptyState("Looking up \(named)…")
              .accessibilityAddTraits(.updatesFrequently)
          }
          if state == "missing" || state == "failed", let named {
            Callout(tone: .warn) {
              Text(
                state == "missing"
                  ? "The address names “\(named)”, which Bluesky doesn’t know as an account."
                  : "Couldn’t reach Bluesky to look up “\(named)”. Reload to try again.")
            }
          }
          if state != "looking" {
            StartingPoint(archive: archive, sets: sets, onChoose: { choose($0) })
          }
        }
      }
    }
    .task(id: namedHandle ?? "") { await resolve(named: named, handle: namedHandle) }
    .onDisappear { forgetWho() }
  }

  /// An address that names a handle: the DID takes its place (a handle
  /// can change hands).
  private func resolve(named: String?, handle: String?) async {
    guard let named, let handle else { return }
    do {
      let profile = try await Atproto.getProfile(handle, transport: network.transport)
      if Task.isCancelled { return }
      if let did = profile["did"]?.stringValue, !did.isEmpty {
        choose(did)
      } else {
        resolved = (named, "missing")
      }
    } catch {
      if Task.isCancelled { return }
      let status = (error as? AtprotoHTTPError)?.status
      resolved = (named, status == 400 ? "missing" : "failed")
    }
  }

  /// A move to another page carries the query along; the chosen account
  /// stays here, so coming back through the Tools page starts fresh.
  private func forgetWho() {
    guard let navigator else { return }
    var path = navigator.path
    while path.utf16.count > 1 && path.utf16.last == 0x2F { path = path.jsSlice(0, path.utf16.count - 1) }
    if path.jsEquals(InteractionModel.lookupPath) { return }
    let params = JSURI.parseSearchParams(navigator.search)
    guard params.contains(where: { $0.0 == "who" }) else { return }
    let rest = JSURI.searchParams(params.filter { $0.0 != "who" })
    navigator.navigate("\(navigator.path)\(rest.isEmpty ? "" : "?\(rest)")\(navigator.hash)", keepQuery: false)
  }
}

/// `PairCount`: how many there are each way, as two counts that never
/// touch, each in its direction's colour; with its arrows unless a legend
/// over the list names the two.
struct PairCount: View {
  @Environment(\.virgaTheme) private var theme
  let incoming: Int
  let outgoing: Int
  var arrows = true

  var body: some View {
    let width = theme.characters(Measure.Tools.pairMinWidth, size: theme.textSm)
    HStack(spacing: Measure.Tools.pairGap) {
      side(incoming, ToolGlyph.incoming, theme.accentInk, width)
      side(outgoing, ToolGlyph.outgoing, theme.secondInk, width)
    }
    .virgaText(.textSm, weight: VirgaWeight.medium)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(AppLocale.fmtInt(Double(incoming))) them to you, \(AppLocale.fmtInt(Double(outgoing))) you to them")
  }

  private func side(_ n: Int, _ glyph: String, _ ink: Color, _ width: CGFloat) -> some View {
    HStack(spacing: Measure.Tools.pairInnerGap) {
      if arrows { Image(systemName: glyph).font(.system(size: Measure.Tools.pairArrow)) }
      Text(AppLocale.fmtInt(Double(n)))
    }
    .foregroundStyle(ink)
    .frame(minWidth: width, alignment: .trailing)
  }
}

/// `.lookup-legend`: which colour is which way.
struct LookupLegend: View {
  @Environment(\.virgaTheme) private var theme

  var body: some View {
    HStack(spacing: Measure.Tools.legendGap) {
      ForEach(["in", "out"], id: \.self) { dir in
        HStack(spacing: Measure.Tools.pairInnerGap) {
          Image(systemName: ToolGlyph.direction(dir))
            .font(.system(size: Measure.Tools.pairArrow))
            .frame(width: Measure.Tools.pairArrow)
          Text(InteractionLookup.directionLabel[dir] ?? "")
        }
        .foregroundStyle(dir == "in" ? theme.accentInk : theme.secondInk)
      }
    }
    .virgaText(.textSm, weight: VirgaWeight.medium)
    .accessibilityHidden(true)
  }
}

// MARK: - Choosing someone

/// One suggestion: someone the archive knows, or the account to look up.
enum LookupOption: Identifiable {
  case person(DirectoryPerson)
  case lookup(ActorInput)

  var id: String {
    switch self {
    case .person(let p): return p.did
    case .lookup: return "lookup"
    }
  }
}

/// `PersonSearch`: the field over the people the archive knows, with one
/// more option when what was typed is a whole handle or DID, which looks
/// the account up on Bluesky.
struct PersonSearch: View {
  @Environment(\.virgaTheme) private var theme
  let directory: [DirectoryPerson]
  let network: ArchiveEnvironment
  let onChoose: (String) -> Void
  var hint: String? = nil
  @State private var query = ""
  @State private var open = false
  /// The suggestion ↑ and ↓ have reached, and Return takes.
  @State private var active = 0
  @State private var status: (error: Bool, text: String)?
  @State private var busy = false
  /// The field has the keyboard: the suggestions open with it and close a
  /// moment after it goes (`onFocus`, `onBlur`), so a press on one lands.
  @FocusState private var focused: Bool

  static func options(_ directory: [DirectoryPerson], _ query: String) -> [LookupOption] {
    let typed = InteractionModel.parseActorInput(query)
    var out = InteractionModel.matchPeople(directory, query, limit: 7).map { LookupOption.person($0) }
    // A whole handle that isn't already one of the suggestions can be
    // anyone: offer to ask Bluesky. A DID is offered only when nothing
    // matches, because half a DID reads as a whole one, and while it still
    // matches people the archive knows it is a search.
    if let typed {
      let listed: Bool
      if typed.kind == .did {
        listed = !out.isEmpty
      } else {
        listed = out.contains { option in
          if case .person(let p) = option { return p.handle.jsLowercased().jsEquals(typed.value) }
          return false
        }
      }
      if !listed { out.append(.lookup(typed)) }
    }
    return out
  }

  var body: some View {
    let options = Self.options(directory, query)
    let shown = open && !query.jsTrimmed().isEmpty ? options : []
    VStack(alignment: .leading, spacing: Measure.Tools.lookupSearchGap) {
      // The suggestions float over the page under the field, 6 below it,
      // over whatever follows (`.lookup-options`).
      field(options: options, shown: shown)
        .overlay(alignment: .bottom) {
          if !shown.isEmpty {
            suggestions(shown)
              .fixedSize(horizontal: false, vertical: true)
              .alignmentGuide(.bottom) { d in d[.top] - Measure.Tools.optionsSpaceAbove }
          }
        }
        .zIndex(1)
      if let line = status?.text ?? hint {
        Text(line)
          .virgaText(.textSm)
          .foregroundStyle(status?.error == true ? theme.danger : theme.muted)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: theme.characters(Measure.Tools.statusMeasure, size: theme.textSm), alignment: .leading)
          .accessibilityIdentifier("lookup-status")
      }
    }
    .frame(maxWidth: Measure.Tools.lookupMax, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Choose an account")
  }

  private func field(options: [LookupOption], shown: [LookupOption]) -> some View {
    ZStack(alignment: .leading) {
      TextField("Search by name, handle or DID", text: $query)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .submitLabel(.search)
        .disabled(busy)
        .virgaField(size: .large, leading: Measure.Tools.largeSearchLeading)
        .focused($focused)
        .accessibilityLabel("Find an account")
        .accessibilityIdentifier("lookup-field")
        .onSubmit { submit(options: options, shown: shown) }
        .onChange(of: focused) { _, now in
          if now {
            open = true
          } else {
            Task { @MainActor in
              try? await Task.sleep(nanoseconds: UInt64(Measure.Tools.optionsCloseDelay * 1_000_000_000))
              if !focused { open = false }
            }
          }
        }
        .onChange(of: query) { _, _ in
          open = true
          active = 0
          status = nil
        }
        .simultaneousGesture(TapGesture().onEnded { open = true })
        // ↑ and ↓ open the suggestions, then move through them, round at
        // the ends; Escape closes them.
        .onKeyPress(keys: [.upArrow, .downArrow]) { press in
          if options.isEmpty { return .ignored }
          if !open {
            open = true
            return .handled
          }
          let step = press.key == .downArrow ? 1 : -1
          active = (active + step + options.count) % options.count
          return .handled
        }
        .onKeyPress(.escape) {
          if shown.isEmpty { return .ignored }
          open = false
          return .handled
        }
        .accessibilityValue(shown.isEmpty ? "" : Self.activeName(shown[min(active, shown.count - 1)]))
      Image(systemName: Glyph.search)
        .font(.system(size: Measure.Tools.largeSearchIcon))
        .foregroundStyle(theme.muted)
        .padding(.leading, Measure.Tools.largeSearchIconInset)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
  }

  /// Return: takes the first suggestion, opens them, or says why there's none.
  private func submit(options: [LookupOption], shown: [LookupOption]) {
    let typed = query.jsTrimmed()
    if typed.isEmpty { return }
    if !shown.isEmpty {
      take(shown[min(active, shown.count - 1)])
    } else if !options.isEmpty {
      open = true
    } else {
      status = (
        false,
        "Nobody your archive knows matches “\(typed)”. To look up anyone else, type their whole handle (name.example.com) or their DID."
      )
    }
  }

  private func suggestions(_ shown: [LookupOption]) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(shown.enumerated()), id: \.element.id) { index, option in
        let selected = index == min(active, shown.count - 1)
        Button {
          take(option)
        } label: {
          optionRow(option)
        }
        .buttonStyle(LookupOptionStyle(selected: selected))
        .onHover { inside in
          if inside && active != index { active = index }
        }
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("lookup-option-\(index)")
      }
    }
    .padding(Measure.Tools.optionsPadding)
    .background(RoundedRectangle(cornerRadius: theme.radiusLg).fill(theme.surface))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line, lineWidth: 1))
    .virgaShadow(theme.shadow(theme.tokens.shadow(.shadowLg) ?? []))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Accounts")
  }

  @ViewBuilder
  private func optionRow(_ option: LookupOption) -> some View {
    switch option {
    case .lookup(let actor):
      let shownAs = actor.kind == .did ? actor.value : "@\(actor.value)"
      HStack(spacing: Measure.Tools.optionGap) {
        Image(systemName: ToolGlyph.mention)
          .font(.system(size: Measure.Tools.kindGlyph))
          .foregroundStyle(theme.ink2)
          .frame(width: Measure.Tools.optionGlyph, height: Measure.Tools.optionGlyph)
          .background(Circle().fill(theme.surface3))
          .accessibilityHidden(true)
        optionText(actor.kind == .did ? "Open this DID" : "Look up \(shownAs) on Bluesky", actor.kind == .did ? shownAs : "Not someone your archive knows by that handle")
      }
    case .person(let p):
      let meta = [
        !p.displayName.isEmpty && !p.handle.isEmpty ? "@\(p.handle)" : nil, p.handle.isEmpty ? "Known by DID only" : nil,
        p.followsYou ? "follows you" : nil,
      ].compactMap { $0 }.joined(separator: " · ")
      HStack(spacing: Measure.Tools.optionGap) {
        Avatar(src: p.avatar, name: !p.displayName.isEmpty ? p.displayName : (!p.handle.isEmpty ? p.handle : "?"), size: .small)
        optionText(!p.displayName.isEmpty ? p.displayName : (!p.handle.isEmpty ? "@\(p.handle)" : p.did), meta)
        if p.total > 0 { PairCount(incoming: p.in, outgoing: p.out) }
      }
    }
  }

  /// What a screen reader hears the field holding while ↑ and ↓ move:
  /// the suggestion they have reached (`aria-activedescendant`).
  static func activeName(_ option: LookupOption) -> String {
    switch option {
    case .lookup(let actor):
      return actor.kind == .did ? "Open this DID" : "Look up @\(actor.value) on Bluesky"
    case .person(let p):
      return !p.displayName.isEmpty ? p.displayName : (!p.handle.isEmpty ? "@\(p.handle)" : p.did)
    }
  }

  private func optionText(_ name: String, _ meta: String) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(name)
        .virgaText(.textBase, weight: VirgaWeight.medium)
        .foregroundStyle(theme.ink)
        .lineLimit(1)
      if !meta.isEmpty {
        Text(meta)
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func take(_ option: LookupOption) {
    switch option {
    case .person(let p): done(p.did)
    case .lookup(let actor): lookUp(actor)
    }
  }

  private func done(_ did: String) {
    query = ""
    open = false
    focused = false
    status = nil
    // The keyboard goes with the search it was typing in.
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    onChoose(did)
  }

  private func lookUp(_ actor: ActorInput) {
    if actor.kind == .did {
      done(actor.value)
      return
    }
    busy = true
    open = false
    status = (false, "Looking up @\(actor.value)…")
    let transport = network.transport
    Task { @MainActor in
      defer { busy = false }
      do {
        let profile = try await Atproto.getProfile(actor.value, transport: transport)
        guard let did = profile["did"]?.stringValue, !did.isEmpty else {
          status = (true, "Bluesky doesn’t know an account called @\(actor.value).")
          return
        }
        done(did)
      } catch {
        // The AppView answers 400 for a handle it can't resolve; anything
        // else is the request itself failing.
        let missing = (error as? AtprotoHTTPError)?.status == 400
        status = (
          true,
          missing
            ? "Bluesky doesn’t know an account called @\(actor.value)."
            : "Couldn’t reach Bluesky to look up @\(actor.value). Try again in a moment."
        )
      }
    }
  }
}

/// `.lookup-option`: 44 tall, the one ↑ and ↓ have reached (or the
/// pointer is over, or a finger is on) on --hover.
struct LookupOptionStyle: ButtonStyle {
  var selected = false

  func makeBody(configuration: Configuration) -> some View {
    LookupOptionBody(label: configuration.label, isPressed: configuration.isPressed || selected)
  }
}

struct LookupOptionBody<Label: View>: View {
  @Environment(\.virgaTheme) private var theme
  let label: Label
  let isPressed: Bool

  var body: some View {
    label
      .padding(.vertical, Measure.Tools.optionPaddingV)
      .padding(.horizontal, Measure.Tools.optionPaddingH)
      .frame(maxWidth: .infinity, minHeight: Measure.Tools.optionMinHeight, alignment: .leading)
      .background(RoundedRectangle(cornerRadius: theme.radius).fill(isPressed ? theme.hover : Color.clear))
      .contentShape(Rectangle())
  }
}

// MARK: - Nobody chosen

/// `StartingPoint`: the people you interact with most, each way.
struct StartingPoint: View {
  @Environment(\.virgaTheme) private var theme
  let archive: ArchiveModel
  let sets: RelationSets
  let onChoose: (String) -> Void
  @State private var limit = InteractionLookup.startPage

  var body: some View {
    let ranked = InteractionModel.interactionIndex(ReportArchive(archive)).ranked
    let shown = Array(ranked.prefix(limit))
    let names = ranked.prefix(max(limit, InteractionLookup.namesUpFront)).map(\.did)
    let phone = theme.isPhone
    VirgaSection(
      caption:
        "Them to you comes from your notifications, which reach back about a year at most. You to them comes from your repo and your posts, and goes all the way back."
    ) {
      // The heading, a flush one. On a phone the legend would leave the
      // title a word a line, so it takes a line of its own under the
      // heading's words, still at the right, over the two columns it names.
      VStack(alignment: .leading, spacing: 0) {
        SectionHead(
          "People you interact with most",
          sub: "Everything on record, each way. Choose someone to see your history with them.",
          trailing: phone ? nil : AnyView(LookupLegend())
        )
        if phone {
          LookupLegend()
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.top, Measure.Tools.phoneLegendSpaceAbove)
        }
      }
      .padding(.bottom, theme.points(ThemeKit.flushHeadSpaceBelow))
      Rectangle().fill(theme.color(ThemeKit.flushHeadRule)).frame(height: theme.points(ThemeKit.flushHeadRule))
      if shown.isEmpty {
        EmptyState("No interactions on record yet. Search for someone above to see whether they follow you.")
          .padding(.top, theme.rowPad)
      } else {
        ForEach(shown, id: \.did) { row in
          pick(row)
        }
      }
      ToolMoreFoot(shown: shown.count, total: ranked.count, page: InteractionLookup.startPage) { limit += InteractionLookup.startPage }
    }
    .frame(maxWidth: Measure.Tools.lookupMax, alignment: .leading)
    .wantActors(archive, Array(names))
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("lookup-start")
  }

  /// A row that is one link: the whole of it opens that person's history.
  private func pick(_ row: InteractionCount) -> some View {
    let card = ToolPeople.cardFor(archive, row.did, sets: sets)
    let name = ToolPeople.displayName(card, row.did)
    let meta = card?.handle != nil ? (card?.displayName != nil ? "@\(card?.handle ?? "")" : "") : (card != nil ? "" : "Reading their name…")
    return Button {
      onChoose(row.did)
    } label: {
      HStack(alignment: .center, spacing: Measure.Tools.personGap) {
        Avatar(src: card?.avatar, name: card?.avatarName ?? "?")
        VStack(alignment: .leading, spacing: 0) {
          Text(name)
            .virgaText(.textMd, weight: VirgaWeight.medium, lineHeight: Measure.Tools.personLineHeight)
            .foregroundStyle(theme.ink)
            .lineLimit(1)
          if !meta.isEmpty {
            Text(meta).virgaText(.textSm).foregroundStyle(theme.muted).lineLimit(1)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        PairCount(incoming: row.in, outgoing: row.out, arrows: false)
      }
      .padding(.vertical, theme.rowPad)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityAddTraits(.isLink)
    .accessibilityHint("See your history with \(name)")
  }
}
#endif
