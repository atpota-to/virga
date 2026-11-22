// Ports src/defense/DefensePage.jsx (DefensePage, ScanPage, TurnOn, DefenseOn, ScanForm, ScanProgress, ScanFailure, Bands)
// Ports src/defense/defense.css (.defense-prose, .defense-field, .defense-recent, .defense-posts, .defense-progress, .defense-failure, .defense-band-list)
//
// Defense: scan a post, and add who it found to a list (AddToList.swift).
// The Lists and History pages are their own; this one routes to them.
//
// Paste a link to a post, or pick one of yours that people have been
// answering, and see everyone who engaged with it on the radar, sorted by
// how close each of them is to you. A scan itself writes, blocks, mutes and
// keeps nothing, and stays in the app's memory (ScanStore) until another
// replaces it.
//
// A scan needs one permission the ordinary sign-in doesn't ask for: the
// signed-in getProfiles, which carries how many of the people you follow
// follow each account. Until the session has it, the page says what it is
// for and offers to sign in again asking for it (Turn on Defense). A
// session whose grant nobody has read yet is let try; a scan refused for
// want of the permission comes back to the same offer.
//
// The scan reads Constellation and the public AppView through the
// session's transport (the made-up world's, in the demo) and the
// signed-in getProfiles through the session's agent.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaDefense
import VirgaInsights
import VirgaSession

/// Defense's pages: a scan (the front page), its lists and their history.
struct DefensePage: View {
  @Environment(AppModel.self) private var app
  let pageKey: String

  var body: some View {
    switch pageKey {
    case "lists": DefenseListsPage(session: app.session)
    case "history": DefenseHistoryPage(session: app.session)
    default: DefenseScanPage(session: app.session)
    }
  }
}

/// The words a Defense control says while a sign-in opens.
enum DefenseWords {
  static let opening = "Opening the sign-in…"

  static func busy(_ asking: DefenseAccountModel.Asking?) -> Bool { asking == .busy }

  static func error(_ asking: DefenseAccountModel.Asking?) -> String? {
    if case .error(let text)? = asking { return text }
    return nil
  }
}

struct DefenseScanPage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  @State private var defense: DefenseAccountModel
  @State private var lists: DefenseListsModel

  init(session: SessionModel) {
    _defense = State(initialValue: DefenseAccountModel(session: session))
    _lists = State(initialValue: DefenseListsModel(did: nil, session: session))
  }

  private var store: ScanStore { ScanStore.shared }

  var body: some View {
    let did = defense.did
    let scan = did.map { store.scanFor($0) } ?? .idle
    let refused = scan.status == .failed && (scan.error as? ScanError)?.code == .permission
    let caps = defense.caps
    let needsPermission = caps.defense == "missing" || refused
    // Read only once a scan has something to add; the server's answer
    // decides what Add to a list can offer.
    let listsDid = scan.status == .done ? did : nil
    VirgaPage(
      PageHeaderModel(
        title: "Defense",
        sub: "Everyone who engaged with a post, sorted by how close each of them is to you, before anything is done about any of them.",
        access: ["read"])
    ) {
      if needsPermission {
        TurnOnCard(account: defense.account, asking: defense.asking, refused: refused) {
          Task { await defense.askFor(.scan) }
        }
      } else if let archive {
        ScanFormCard(archive: archive, running: scan.status == .running) { begin($0) }
      }
      switch scan.status {
      case .running:
        ScanProgressCard(scan: scan) { if let did { store.stopScan(did) } }
      case .failed:
        if !refused {
          ScanFailureView(scan: scan) { if let input = scan.input { begin(input) } }
        }
      case .done:
        if let result = scan.result, let archive {
          ScanResultView(archive: archive, result: result) {
            if let input = scan.input { begin(input) }
          }
          AddToListCard(result: result, defense: defense, lists: lists)
        }
      case .idle:
        BandsCard()
      }
      if caps.defense == "granted" && !needsPermission {
        DefenseOnCard(account: defense.account, asking: defense.asking) {
          Task { await defense.askFor(nil) }
        }
      }
    }
    .task { await lists.start() }
    .task(id: listsDid ?? "") { await lists.update(did: listsDid) }
    .onDisappear { lists.stop() }
  }

  /// `begin(input)`: a scan of the post `input` names, for the open account.
  private func begin(_ input: String) {
    guard let did = defense.did, let agent = app.session.agent, let archive else { return }
    let getProfiles = Scan.signedInProfiles(agent)
    let canary = CanaryArchive(
      following: archive.data.following.map { CanaryArchive.Follow(did: $0.did, followedAt: $0.followedAt) },
      followers: archive.data.followers.map { CanaryArchive.Account(did: $0.did) },
      inbound: archive.data.inbound.map { CanaryArchive.Account(did: $0.did) })
    let candidates = Scan.canaryCandidates(canary, ownerDid: did)
    let transport = app.archiveEnvironment.transport
    store.startScan(did, input: input) { onStage in
      try await Scan.runScan(
        input: input, ownerDid: did, getProfiles: getProfiles, candidates: candidates, onStage: onStage, transport: transport)
    }
  }
}

// MARK: - Turning it on

/// `TurnOn`: what a scan needs, and the sign-in that asks for it.
struct TurnOnCard: View {
  @Environment(\.virgaTheme) private var theme
  let account: SessionAccount?
  let asking: DefenseAccountModel.Asking?
  let refused: Bool
  let onTurnOn: () -> Void

  var body: some View {
    let who = account?.handle.flatMap { $0.isEmpty ? nil : "@\($0)" } ?? "this account"
    let busy = DefenseWords.busy(asking)
    VirgaSection(
      title: "Turn on Defense for \(who)",
      sub: refused
        ? "The scan was refused: this sign-in doesn’t include the one read a scan needs."
        : "A scan needs one more permission than signing in asked for."
    ) {
      VStack(alignment: .leading, spacing: theme.space3) {
        Text(
          "To sort the people who engaged with a post, Virga asks Bluesky, as you, how many of the people you follow also follow each of them. Only a signed-in read of their profiles says that ("
        )
          + Text("app.bsky.actor.getProfiles").font(theme.codeFont(around: theme.textBase))
          + Text("), so turning Defense on signs you in again, asking for that one read as well. It reads; it can’t block, mute or post.")
        Text(
          "Who engaged comes from Constellation, the public index of the network, from this browser. \(account?.mode == "backend" ? "This account’s session is held by Virga’s server, so the read of their profiles goes through it, which passes it on to Bluesky and keeps none of it." : "The read of their profiles goes from this browser straight to Bluesky.") Nothing a scan finds is kept after this tab closes."
        )
      }
      .virgaText(.textBase)
      .foregroundStyle(theme.ink2)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: theme.measure, alignment: .leading)
      Button(action: onTurnOn) {
        Label(busy ? DefenseWords.opening : "Turn on Defense", systemImage: Glyph.defense)
      }
      .buttonStyle(.virga)
      .disabled(busy)
      .padding(.top, theme.space5)
      .accessibilityIdentifier("defense-turn-on")
      if let error = DefenseWords.error(asking) {
        Callout(tone: .danger, error)
          .padding(.top, theme.space4)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("defense-turn-on-card")
  }
}

/// `DefenseOn`: Defense is on, and the way to turn it off.
struct DefenseOnCard: View {
  @Environment(\.virgaTheme) private var theme
  let account: SessionAccount?
  let asking: DefenseAccountModel.Asking?
  let onTurnOff: () -> Void

  var body: some View {
    let handle = account?.handle.flatMap { $0.isEmpty ? nil : $0 }
    VirgaSection(
      title: "Defense is on\(handle.map { " for @\($0)" } ?? "")",
      sub:
        "Its sign-in includes reading who you know in common with an account, and writing your lists if you let it. Turning it off signs you in again without them. Anyone still waiting to be added waits until it is turned on again; take them back on History if they shouldn’t be.",
      trailing: AnyView(
        Button("Turn off", action: onTurnOff)
          .buttonStyle(.linkAction)
          .disabled(DefenseWords.busy(asking)))
    ) {
      if let error = DefenseWords.error(asking) {
        Callout(tone: .danger, error)
          .padding(.top, theme.space4)
      }
    }
  }
}

// MARK: - Choosing a post

/// `ScanForm`: a link to paste, or one of your posts that people have been
/// answering.
struct ScanFormCard: View {
  @Environment(\.virgaTheme) private var theme
  let archive: ArchiveModel
  let running: Bool
  let onScan: (String) -> Void
  @State private var text = ""

  var body: some View {
    let now = archive.nowMs != 0 ? archive.nowMs : SyncStatus.now()
    let recent = PageModel.postsToScan(archive.data.posts, now: Date(timeIntervalSince1970: now / 1000)) { p in
      PostToScanFacts(uri: p.uri, at: p.at, replies: Double(p.replies), quotes: Double(p.quotes), reposts: Double(p.reposts))
    }
    VirgaSection(title: "Scan a post", sub: "Yours or anyone’s. Paste its bsky.app link.") {
      field
      if !recent.isEmpty {
        VStack(alignment: .leading, spacing: 0) {
          Text("Or one of yours that people have been answering")
            .virgaText(.textSm, weight: VirgaWeight.medium)
            .foregroundStyle(theme.ink2)
            .padding(.bottom, theme.space2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) { Rectangle().fill(theme.rule).frame(height: 1) }
          ForEach(Array(recent.enumerated()), id: \.element.uri) { index, post in
            recentRow(post, index: index)
          }
        }
        .padding(.top, theme.space6)
      }
    }
  }

  private func submit() {
    let typed = text.jsTrimmed()
    if !typed.isEmpty && !running { onScan(typed) }
  }

  /// The field's example, as plain words: a string literal would be read as
  /// Markdown and its address drawn as a link.
  static let linkPlaceholder = "https://bsky.app/profile/…/post/…"

  private var field: some View {
    let input = VirgaTextField(Self.linkPlaceholder, text: $text)
      .keyboardType(.URL)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
      .submitLabel(.go)
      .onSubmit { submit() }
      .virgaField(size: .large)
      .accessibilityLabel("Link to a post")
      .accessibilityIdentifier("defense-link")
    // On a phone the button spans the column, under the field
    // (`.defense-field { flex-direction: column; align-items: stretch }`),
    // as the sign-in form's does.
    let go = Button("Scan") { submit() }
      .buttonStyle(.virga)
      .environment(\.virgaFillsWidth, theme.isPhone)
      .disabled(text.jsTrimmed().isEmpty || running)
      .accessibilityIdentifier("defense-scan-link")
    return Group {
      if theme.isPhone {
        VStack(alignment: .leading, spacing: theme.space3) {
          input
          go
        }
      } else {
        HStack(spacing: theme.space3) {
          input
          go
        }
      }
    }
    .frame(maxWidth: Measure.Defense.columnMax, alignment: .leading)
  }

  private func recentRow(_ post: PostRow, index: Int) -> some View {
    let words = ToolPosts.postText(post)
    var facts = [ToolPosts.postWhen(post.at, now: SyncStatus.now())]
    facts.append("\(AppLocale.fmtInt(Double(post.replies))) \(post.replies == 1 ? "reply" : "replies")")
    if post.quotes > 0 { facts.append("\(AppLocale.fmtInt(Double(post.quotes))) \(post.quotes == 1 ? "quote" : "quotes")") }
    return HStack(alignment: .center, spacing: theme.space4) {
      VStack(alignment: .leading, spacing: Measure.Defense.postGap) {
        Text(words)
          .virgaText(.textBase)
          .foregroundStyle(theme.ink)
          .lineLimit(1)
        MetaLine(facts)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      Button("Scan") { onScan(post.uri) }
        .buttonStyle(.virga(size: .small))
        .disabled(running)
        .accessibilityLabel("Scan the post “\(words.jsSlice(0, 60))”")
        .accessibilityIdentifier("defense-scan-recent-\(index)")
    }
    .padding(.vertical, theme.rowPad)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}

// MARK: - A scan under way, and one that failed

/// `ScanProgress`: the stage, its count, Stop, and the bar.
struct ScanProgressCard: View {
  @Environment(\.virgaTheme) private var theme
  let scan: ScanState
  let onStop: () -> Void

  var body: some View {
    let fraction = PageModel.stageFraction(scan)
    VStack(alignment: .leading, spacing: 0) {
      SectionHead(
        "Scanning", sub: nil,
        trailing: AnyView(
          Button(action: onStop) {
            Label("Stop", systemImage: "square")
          }
          .buttonStyle(.linkAction)
          .accessibilityIdentifier("defense-stop"))
      )
      // The stage is announced as it changes; the running count isn't.
      (Text(PageModel.stageLabel(scan)) + Text(PageModel.stageCount(scan)))
        .virgaText(size: theme.points(ThemeKit.cardSubFontSize))
        .foregroundStyle(theme.color(ThemeKit.cardSubInk))
        .padding(.top, theme.points(ThemeKit.cardSubSpaceAbove))
        .accessibilityLabel(PageModel.stageLabel(scan))
        .accessibilityAddTraits(.updatesFrequently)
        .toolAnnounces(PageModel.stageLabel(scan), onAppear: true)
        .accessibilityIdentifier("defense-stage")
      ProgressLine(value: max(4, (fraction * 100).jsRounded) / 100)
        .frame(maxWidth: Measure.Defense.columnMax)
        .padding(.top, theme.points(ThemeKit.cardHeadSpaceBelow))
        .accessibilityHidden(true)
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("defense-progress")
  }
}

/// `ScanFailure`: what stopped it, and Try again unless the link was the
/// trouble.
struct ScanFailureView: View {
  @Environment(\.virgaTheme) private var theme
  let scan: ScanState
  let onRetry: () -> Void

  var body: some View {
    let error = scan.error as? ScanError
    let linkProblem = error?.code == .link || error?.code == .author
    let message = error?.message ?? scan.error.map { jsMessageOf($0) } ?? ""
    VStack(alignment: .leading, spacing: theme.space3) {
      Callout(tone: .danger, message.isEmpty ? "The scan stopped." : message)
        .accessibilityIdentifier("defense-failure")
      if !linkProblem {
        Button(action: onRetry) {
          Label("Try again", systemImage: Glyph.rebuild)
        }
        .buttonStyle(.linkAction)
      }
    }
  }

  private func jsMessageOf(_ error: any Error) -> String {
    (error as? LocalizedError)?.errorDescription ?? ""
  }
}

// MARK: - Before any scan

/// `Bands`: how a scan sorts people.
struct BandsCard: View {
  @Environment(\.virgaTheme) private var theme

  var body: some View {
    VirgaSection(
      title: "How a scan sorts people",
      sub: "By one thing: how many of the people you follow also follow them. It doesn’t judge anyone. It tells you who would notice."
    ) {
      VStack(alignment: .leading, spacing: 0) {
        Rectangle().fill(theme.rule).frame(height: 1)
        ForEach(Score.bands, id: \.self) { band in
          bandRow(band)
        }
      }
      .frame(maxWidth: Measure.Defense.columnMax, alignment: .leading)
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("defense-bands")
  }

  private func bandRow(_ band: Band) -> some View {
    let word = HStack(spacing: Measure.Defense.bandLabelGap) {
      BandMark(band: band)
      Text(BandWords.bandWord[band] ?? "").virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
    }
    let means = Text(BandWords.bandMeans[band] ?? "")
      .virgaText(.textBase)
      .foregroundStyle(theme.muted)
      .fixedSize(horizontal: false, vertical: true)
    return Group {
      if theme.isPhone {
        VStack(alignment: .leading, spacing: Measure.Defense.phoneBandGap) {
          word
          means
        }
      } else {
        HStack(alignment: .firstTextBaseline, spacing: theme.space4) {
          word.frame(width: Measure.Defense.bandLabel, alignment: .leading)
          means.frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }
    .padding(.vertical, theme.rowPad)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .combine)
  }
}
#endif
