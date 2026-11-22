// Ports src/tools/InteractionLookup.jsx (Chosen, PersonCard, Totals, Timeline, EngagedPosts, YourPosts, Events, EventRow, HowCounted)
// Ports src/tools/tools.css (.lookup-person, .lookup-facts, .lookup-totals, .lookup-total, .lookup-edge, .lookup-event, .lookup-cannot)
//
// Someone chosen: who they are and how the two of you are connected, the
// totals of each kind each way beside the months they happened in, the
// posts of yours they engaged with beside your replies to them and quotes
// of them, every interaction with its filters and its export, and how it
// is all counted.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

struct ChosenHistory: View {
  @Environment(\.virgaTheme) private var theme
  let tool: ToolEntry
  let archive: ArchiveModel
  let who: String
  let sets: RelationSets
  let search: AnyView
  let onClear: () -> Void
  @State private var direction = "all"
  @State private var kind = "all"
  @State private var exporting: ExportFile?

  var body: some View {
    let report = ReportArchive(archive)
    let model = InteractionModel.interactionModel(report, who, nowMs: archive.nowMs)
    let card = ToolPeople.cardFor(archive, who, sets: sets)
    let name = ToolPeople.displayName(card, who)
    let filtered = InteractionModel.filterEvents(model.events, direction: direction, kind: kind)
    VirgaPage(header: ToolHeader.header(tool)) {
      search
      LookupPersonCard(card: card, who: who, model: model, onClear: onClear)
      if model.isSelf {
        EmptyState("This is the account you’re signed in with. Replies to your own posts are threads, so there’s no history to show.")
      } else if model.events.isEmpty {
        EmptyState(
          "Nothing on record between you and \(name)\(model.coverage.inboundSinceMs.map { ". Your notifications reach back to \(Time.formatDateShort($0)); anything before that wouldn’t show." } ?? ".")"
        )
      } else {
        SplitLayout(
          minColumn: 300, columnGap: theme.gridGapX, rowGap: theme.gridGap, shares: [1, 2],
          stacked: theme.windowWidth <= Measure.Tools.lookupTopSplit
        ) {
          LookupTotals(model: model)
          if let timeline = model.timeline {
            LookupTimeline(timeline: timeline, name: name)
          }
        }
        if model.engagedPosts.known {
          SplitLayout(columnGap: theme.gridGapX, rowGap: theme.gridGap) {
            EngagedPostsView(model: model, did: archive.did)
            YourPostsView(model: model, did: archive.did, who: who)
          }
        } else {
          EngagedPostsView(model: model, did: archive.did)
          YourPostsView(model: model, did: archive.did, who: who)
        }
        LookupEvents(
          model: model, name: name, filtered: filtered, direction: $direction, kind: $kind,
          onExport: { events in exportEvents(events, card: card) })
      }
      if !model.isSelf {
        HowCounted(model: model)
      }
    }
    .wantActors(archive, [who])
    .exportSheet($exporting)
  }

  private func exportEvents(_ events: [InteractionEvent], card: PersonCard?) {
    let rows = InteractionModel.eventsCsvRows(events, did: who, handle: card?.handle ?? "")
    exporting = archive.exportRows("interactions-\(InteractionLookup.fileSafe(card?.handle ?? who))", ToolExport.rows(rows))
  }
}

// MARK: - The person

enum LookupWords {
  static func theyFollow(_ rel: InteractionRelationship.TheyFollow) -> String {
    if !rel.known { return "Not known yet. Your follower list arrives with a sync." }
    if rel.is { return rel.since.map { "Yes, since \(Time.formatDateShort($0))" } ?? "Yes, date not known" }
    if let left = rel.left {
      let after = left.followedAt.flatMap { $0.isEmpty ? nil : ", after following since \(Time.formatDateShort($0))" } ?? ""
      let noticed = left.noticedAt.map { Time.formatDateShort($0) } ?? ""
      if let since = left.since {
        return "No. They stopped between \(Time.formatDateShort(since)) and \(noticed)\(after)."
      }
      return "No. They had stopped by \(noticed)\(after)."
    }
    return "No"
  }

  static func youFollow(_ rel: InteractionRelationship.YouFollow) -> String {
    if !rel.known { return "Not known yet. Who you follow arrives with the next sync." }
    if rel.is { return rel.since.map { "Yes, since \(Time.formatDateShort($0))" } ?? "Yes, date not known" }
    return "No"
  }

  static func theyBlock(_ block: InteractionRelationship.TheyBlock) -> String {
    let how = block.direct && block.list ? "directly and through a moderation list" : block.list ? "through a moderation list" : "directly"
    return block.since.map { "Since \(Time.formatDateShort($0)), \(how)" } ?? "Yes, \(how); date not known"
  }
}

/// `PersonCard`: who they are, the way to them on Bluesky, Choose someone
/// else, and the facts about the two of you under a rule.
struct LookupPersonCard: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  let card: PersonCard?
  let who: String
  let model: Interaction
  let onClear: () -> Void

  var body: some View {
    let name = ToolPeople.displayName(card, who)
    let rel = model.relationship
    VStack(alignment: .leading, spacing: Measure.Tools.personCardGap) {
      FlowLayout(spacing: Measure.Tools.identityGap, lineSpacing: theme.space3, alignment: .center) {
        HStack(alignment: .center, spacing: Measure.Tools.identityGap) {
          Avatar(src: card?.avatar, name: card?.avatarName ?? "?", size: .large)
          VStack(alignment: .leading, spacing: 0) {
            Text(name)
              .virgaText(
                .textLead, weight: VirgaWeight.semibold, lineHeight: Measure.Tools.identityNameLineHeight,
                tracking: Measure.Tools.identityNameTracking)
              .foregroundStyle(theme.ink)
              .fixedSize(horizontal: false, vertical: true)
              .accessibilityIdentifier("lookup-name")
            if let handle = card?.handle, card?.displayName != nil {
              Text("@\(handle)").virgaText(.textBase).foregroundStyle(theme.muted)
            }
            // Without a card the name above is the DID already.
            if card?.handle != nil {
              Text(who)
                .font(theme.codeFont(around: theme.textSm))
                .foregroundStyle(theme.muted)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
            }
          }
        }
        HStack(spacing: theme.space4) {
          Button {
            if let url = ToolPeople.profileUrl(card, who) { openURL(url) }
          } label: {
            Label("Open on Bluesky", systemImage: Glyph.externalLink)
          }
          .buttonStyle(.linkAction)
          Button(action: onClear) {
            Label("Choose someone else", systemImage: Glyph.close)
          }
          .buttonStyle(.linkAction)
          .accessibilityIdentifier("lookup-clear")
        }
      }
      if !model.isSelf {
        VStack(alignment: .leading, spacing: 0) {
          Rectangle().fill(theme.rule).frame(height: 1)
          KVList {
            KVRow("They follow you", inline: true) { Text(LookupWords.theyFollow(rel.theyFollow)) }
            KVRow("You follow them", inline: true) { Text(LookupWords.youFollow(rel.youFollow)) }
            if let block = rel.theyBlock {
              KVRow("They block you", inline: true) { Text(LookupWords.theyBlock(block)) }
            }
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("lookup-facts")
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("The account")
  }
}

// MARK: - The totals

/// `Totals`: each kind each way, with a bar sized against the biggest
/// count either way; the sum, the first on record and the latest under them.
struct LookupTotals: View {
  @Environment(\.virgaTheme) private var theme
  let model: Interaction

  static func value(_ totals: KindTotals, _ kind: String) -> Int? {
    switch kind {
    case "like": return totals.like
    case "repost": return totals.repost
    case "reply": return totals.reply
    case "quote": return totals.quote
    default: return totals.mention
    }
  }

  var body: some View {
    let totals = model.totals
    var top = 1
    for k in InteractionModel.lookupKinds {
      top = Swift.max(top, Self.value(totals.in, k) ?? 0, Self.value(totals.out, k) ?? 0)
    }
    let biggest = top
    let pad = theme.points(ThemeKit.tableCellPadding.top)
    return VirgaSection(title: "By kind, each way") {
      Grid(alignment: .leading, horizontalSpacing: theme.space4, verticalSpacing: 0) {
        GridRow {
          Text("Kind")
            .virgaText(.textSm, weight: ThemeKit.tableHeadWeight)
            .foregroundStyle(theme.muted)
            .padding(.bottom, theme.points(ThemeKit.tableHeadSpaceBelow))
          head("in")
          head("out")
        }
        rule(theme.color(ThemeKit.tableHeadRule))
        ForEach(InteractionModel.lookupKinds, id: \.self) { k in
          GridRow {
            HStack(spacing: Measure.Tools.kindGap) {
              Image(systemName: ToolGlyph.kind(k)).font(.system(size: Measure.Tools.kindGlyph)).foregroundStyle(theme.muted)
              Text(InteractionModel.kindLabel[k] ?? k)
            }
            .virgaText(.textBase, weight: VirgaWeight.medium)
            .lineLimit(1)
            .padding(.vertical, pad)
            TotalCell(value: Self.value(totals.in, k), max: biggest, dir: "in").padding(.vertical, pad)
            TotalCell(value: Self.value(totals.out, k), max: biggest, dir: "out").padding(.vertical, pad)
          }
          rule(theme.color(ThemeKit.tableRowRule))
        }
        rule(theme.rule)
        GridRow {
          sumCell("All kinds", alignment: .leading)
          sumCell(AppLocale.fmtInt(Double(totals.in.total)), alignment: .trailing)
          sumCell(AppLocale.fmtInt(Double(totals.out.total)), alignment: .trailing)
        }
        rule(theme.color(ThemeKit.tableRowRule))
        GridRow {
          edgeLabel("First on record")
          EdgeCell(event: model.first.in).padding(.vertical, pad)
          EdgeCell(event: model.first.out).padding(.vertical, pad)
        }
        rule(theme.color(ThemeKit.tableRowRule))
        GridRow {
          edgeLabel("Latest")
          EdgeCell(event: model.latest.in).padding(.vertical, pad)
          EdgeCell(event: model.latest.out).padding(.vertical, pad)
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("lookup-totals")
  }

  private func rule(_ color: Color) -> some View {
    Rectangle().fill(color).frame(height: 1).gridCellUnsizedAxes(.horizontal)
  }

  private func head(_ dir: String) -> some View {
    HStack(spacing: Measure.Tools.kindGap) {
      if !theme.isPhone {
        Image(systemName: ToolGlyph.direction(dir)).font(.system(size: Measure.Tools.kindGlyph))
      }
      Text(InteractionLookup.directionLabel[dir] ?? "")
    }
    .virgaText(.textSm, weight: ThemeKit.tableHeadWeight)
    .foregroundStyle(dir == "in" ? theme.accentInk : theme.secondInk)
    .lineLimit(1)
    .frame(maxWidth: .infinity, alignment: .trailing)
    .padding(.bottom, theme.points(ThemeKit.tableHeadSpaceBelow))
    .gridColumnAlignment(.trailing)
  }

  private func sumCell(_ text: String, alignment: Alignment) -> some View {
    Text(text)
      .virgaText(.textBase, weight: VirgaWeight.semibold)
      .foregroundStyle(theme.ink)
      .frame(maxWidth: .infinity, alignment: alignment)
      .padding(.vertical, theme.points(ThemeKit.tableCellPadding.top))
  }

  private func edgeLabel(_ text: String) -> some View {
    Text(text)
      .virgaText(.textBase, weight: VirgaWeight.medium)
      .foregroundStyle(theme.ink2)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.vertical, theme.points(ThemeKit.tableCellPadding.top))
  }
}

struct TotalCell: View {
  @Environment(\.virgaTheme) private var theme
  let value: Int?
  let max: Int
  let dir: String

  var body: some View {
    if let value {
      HStack(spacing: Measure.Tools.totalGap) {
        GeometryReader { geometry in
          ZStack(alignment: .leading) {
            Capsule().fill(theme.line)
            Capsule()
              .fill(dir == "out" ? theme.chart2 : theme.chart1)
              .frame(width: geometry.size.width * CGFloat(max != 0 ? Double(value) / Double(max) : 0))
          }
        }
        .frame(minWidth: Measure.Tools.totalTrackMin, maxWidth: Measure.Tools.totalTrackMax)
        .frame(height: Measure.Tools.totalTrackHeight)
        .accessibilityHidden(true)
        Text(AppLocale.fmtInt(Double(value)))
          .virgaText(.textBase, weight: VirgaWeight.medium)
          .frame(minWidth: theme.textBase * Measure.Tools.totalNumberEm, alignment: .trailing)
      }
      .frame(maxWidth: .infinity, alignment: .trailing)
    } else {
      Text("—")
        .virgaText(.textBase, weight: VirgaWeight.medium)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .accessibilityLabel("Not on record")
    }
  }
}

/// `EdgeCell`: a date on one line, with its kind under it.
struct EdgeCell: View {
  @Environment(\.virgaTheme) private var theme
  let event: InteractionEvent?

  var body: some View {
    if let event {
      VStack(alignment: .trailing, spacing: 0) {
        Text(Time.formatDateShort(event.atMs)).virgaText(.textBase).foregroundStyle(theme.ink2).lineLimit(1)
        Text(InteractionLookup.kindOne[event.kind] ?? event.kind)
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
      }
      .frame(maxWidth: .infinity, alignment: .trailing)
    } else {
      Text("None").virgaText(.textBase).foregroundStyle(theme.ink2).frame(maxWidth: .infinity, alignment: .trailing)
    }
  }
}

// MARK: - The months

struct LookupTimeline: View {
  let timeline: InteractionTimeline
  let name: String

  var body: some View {
    let inbound = ChartPoint.of(timeline.inbound)
    let outbound = ChartPoint.of(timeline.outbound)
    let caption: String? = !timeline.inboundCovered
      ? "There are no notifications on record, so only your side has values."
      : timeline.inboundFromMs.map {
        "Them to you starts in \(Analytics.bucketLabel($0, .month)), where your notifications begin. The months before it have no value, which isn’t the same as none."
      }
    VirgaSection(
      title: "Interactions per month",
      sub: "Each way, from the first on record to now: \(InteractionLookup.nounOf(inbound.count, "month", "months"))"
    ) {
      SeriesChart(
        series: inbound, seriesLabel: "Them to you", secondary: ChartSecondary(label: "You to them", series: outbound), mode: .line,
        unit: .month, format: { $0 == nil ? "not on record" : ChartFormat.fmtCount($0) }, height: 240,
        accessibilityLabel: "Interactions with \(name) per month, them to you and you to them")
      ChartTable(series: inbound, secondary: outbound, unit: .month, valueHead: "Them to you", secondaryHead: "You to them")
      if let caption { CardCaption(caption) }
    }
  }
}

// MARK: - The posts

/// `EngagedPosts`: which of your posts they engaged with most, where the
/// events say; until they do, a line that says so.
struct EngagedPostsView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  let model: Interaction
  let did: String
  @State private var limit = InteractionLookup.postsPage

  var body: some View {
    let engaged = model.engagedPosts
    if !engaged.known {
      VirgaSection(
        title: "Your posts they engaged with most",
        sub: engaged.of != 0
          ? "The archive keeps who engaged and when, not which post it was for, so there’s no ranking to show. Their replies, quotes and mentions are in the list below, each with a link to their post."
          : "They haven’t liked, reposted, replied to or quoted you, as far as your notifications reach."
      ) {
        EmptyView()
      }
    } else {
      let shown = Array(engaged.rows.prefix(limit))
      VirgaSection(
        title: "Your posts they engaged with most",
        sub: engaged.counted < engaged.of
          ? "From the \(AppLocale.fmtInt(Double(engaged.counted))) of \(AppLocale.fmtInt(Double(engaged.of))) events that say which post" : nil,
        flush: true
      ) {
        if shown.isEmpty {
          EmptyState("None of the events that name a post name one of yours.").padding(.top, theme.rowPad)
        }
        ForEach(Array(shown.enumerated()), id: \.element.uri) { index, row in
          engagedRow(index, row)
        }
        ShowMoreFoot(shown: shown.count, total: engaged.rows.count, page: InteractionLookup.postsPage * 2) {
          limit += InteractionLookup.postsPage * 2
        }
      }
    }
  }

  private func engagedRow(_ index: Int, _ row: EngagedPost) -> some View {
    let kinds = InteractionModel.kindsLine(entries: row.byKind.map { (key: $0.kind, value: Double($0.count)) })
    var facts: [String] = []
    if let post = row.post { facts.append(ToolPosts.postWhen(post.at, now: SyncStatus.now())) }
    if !kinds.isEmpty { facts.append(kinds) }
    facts = facts.filter { !$0.isEmpty }
    return HStack(alignment: .firstTextBaseline, spacing: Measure.Tools.postRowGap) {
      Text(AppLocale.formatNumber(index + 1))
        .foregroundStyle(theme.muted)
        .frame(width: Measure.Tools.postRank, alignment: .leading)
      VStack(alignment: .leading, spacing: Measure.Tools.postMainGap) {
        Button {
          if let link = row.url, let url = URL(string: link) { openURL(url) }
        } label: {
          Text(row.post.map { ToolPosts.postText($0) } ?? "A post that isn’t in your archive")
            .virgaText(.textMd, lineHeight: Measure.Tools.postTextLineHeight)
            .foregroundStyle(theme.ink)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
        .accessibilityHint("Open on Bluesky")
        MetaLine(facts)
      }
    }
    .virgaText(.textBase)
    .padding(.vertical, theme.rowPad)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}

/// `YourPosts`: your replies to them and quotes of them, newest first.
struct YourPostsView: View {
  @Environment(\.virgaTheme) private var theme
  let model: Interaction
  let did: String
  let who: String
  @State private var limit = InteractionLookup.postsPage

  var body: some View {
    let posts = model.yourPosts
    let shown = Array(posts.prefix(limit))
    let replies = posts.filter { $0.replyTo.jsEquals(who) }.count
    let quotes = posts.filter { $0.quoteOf.jsEquals(who) }.count
    let now = SyncStatus.now()
    VirgaSection(
      title: "Your replies to them and quotes of them",
      sub: posts.isEmpty
        ? nil
        : "\(InteractionLookup.nounOf(replies, "reply", "replies")) and \(InteractionLookup.nounOf(quotes, "quote", "quotes")), newest first",
      flush: true
    ) {
      if shown.isEmpty {
        EmptyState(
          "You haven’t replied to them or quoted them\(model.coverage.postsComplete ? "." : ", in the part of your posts archived so far.")"
        )
        .padding(.top, theme.rowPad)
      }
      ForEach(shown, id: \.uri) { post in
        ToolPostRow(post: post, did: did, now: now)
      }
      ShowMoreFoot(shown: shown.count, total: posts.count, page: InteractionLookup.postsPage * 2) {
        limit += InteractionLookup.postsPage * 2
      }
    }
  }
}

// MARK: - Every interaction

/// `Events`: every interaction, newest first, with its two filters over
/// the heading and its export at the heading's right.
struct LookupEvents: View {
  @Environment(\.virgaTheme) private var theme
  let model: Interaction
  let name: String
  let filtered: [InteractionEvent]
  @Binding var direction: String
  @Binding var kind: String
  let onExport: ([InteractionEvent]) -> Void
  @State private var limit = InteractionLookup.eventsPage

  var body: some View {
    let total = model.events.count
    let rows = Array(filtered.prefix(limit))
    let narrowed = direction != "all" || kind != "all"
    let none =
      kind == "mention" && direction == "out" && model.totals.out.mention == nil
      ? "Mentions you made aren’t on record." : "Nothing on record matches these filters."
    let count = InteractionLookup.nounOf(total, "event", "events")
    VStack(alignment: .leading, spacing: 0) {
      filters
        .padding(.bottom, theme.space4)
      SectionHead(
        "Every interaction",
        sub: "\(narrowed ? "\(AppLocale.fmtInt(Double(filtered.count))) of \(count)" : count), newest first",
        trailing: AnyView(exportTool(narrowed: narrowed, total: total))
      )
      .padding(.bottom, theme.points(ThemeKit.flushHeadSpaceBelow))
      Rectangle().fill(theme.color(ThemeKit.flushHeadRule)).frame(height: theme.points(ThemeKit.flushHeadRule))
      if rows.isEmpty {
        EmptyState(none).padding(.top, theme.rowPad)
      } else {
        LazyVStack(alignment: .leading, spacing: 0) {
          ForEach(rows) { event in
            EventRowView(event: event)
          }
        }
      }
      ShowMoreFoot(shown: rows.count, total: filtered.count, page: InteractionLookup.eventsPage) { limit += InteractionLookup.eventsPage }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Every interaction")
    .accessibilityIdentifier("lookup-events")
  }

  /// Which way, then which kind.
  private var filters: some View {
    FlowLayout(
      spacing: theme.isPhone ? Measure.Tools.phoneToolbarColumnGap : Measure.Tools.toolbarColumnGap, lineSpacing: Measure.Tools.toolbarRowGap,
      alignment: .center
    ) {
      Segmented(
        label: "Direction",
        options: InteractionModel.directions.map {
          SegmentedOption($0.key, $0.label, systemImage: $0.key == "all" ? nil : ToolGlyph.direction($0.key))
        },
        selection: direction, size: .small
      ) { value in
        direction = value
        limit = InteractionLookup.eventsPage
      }
      Segmented(
        label: "Kind",
        options: [SegmentedOption("all", "All")]
          + InteractionModel.lookupKinds.map { SegmentedOption($0, InteractionModel.kindLabel[$0] ?? $0, systemImage: ToolGlyph.kind($0)) },
        selection: kind, size: .small
      ) { value in
        kind = value
        limit = InteractionLookup.eventsPage
      }
    }
  }

  /// One file when the list is whole, a choice when the filters narrowed it.
  @ViewBuilder
  private func exportTool(narrowed: Bool, total: Int) -> some View {
    if narrowed {
      ExportMenu(entries: [
        .item(
          MenuItem(
            "These \(InteractionLookup.nounOf(filtered.count, "event", "events")) (CSV)", key: "these",
            hint: "What the list shows, with its filters.", systemImage: Glyph.download
          ) { onExport(filtered) }),
        .item(
          MenuItem(
            "All \(InteractionLookup.nounOf(total, "event", "events")) (CSV)", key: "all", hint: "Everything on record with \(name), each way.",
            systemImage: Glyph.download
          ) { onExport(model.events) }),
      ])
    } else {
      Button {
        onExport(model.events)
      } label: {
        Label("Export", systemImage: Glyph.download)
      }
      .buttonStyle(.linkAction)
    }
  }
}

/// `EventRow`: when, the kind in its direction's colour, what happened (and
/// the post's words), and the way to the post.
struct EventRowView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  let event: InteractionEvent

  var body: some View {
    let phone = theme.isPhone
    let date = Text(Time.formatDateShort(event.atMs)).virgaText(.textSm).foregroundStyle(theme.muted)
    HStack(alignment: phone ? .top : .center, spacing: Measure.Tools.eventGap) {
      if !phone {
        date.frame(width: Measure.Tools.eventDate, alignment: .leading)
      }
      Image(systemName: ToolGlyph.kind(event.kind))
        .font(.system(size: Measure.Tools.kindGlyph))
        .foregroundStyle(event.dir == "out" ? theme.secondInk : theme.accentInk)
        .frame(width: Measure.Tools.eventGlyph, height: Measure.Tools.eventGlyph)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 0) {
        Text(InteractionModel.eventPhrase(event)).virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
        if !event.text.isEmpty {
          Text(event.text).virgaText(.textSm).foregroundStyle(theme.muted).lineLimit(2)
        }
        if phone { date }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if let link = event.url, let url = URL(string: link) {
        Button {
          openURL(url)
        } label: {
          HStack(spacing: Measure.Tools.linkGap) {
            Text(event.urlOwner == "you" ? "Your post" : "Their post")
              .virgaText(.textSm, weight: VirgaWeight.medium)
              .foregroundStyle(theme.ink)
            Image(systemName: Glyph.externalLink).font(.system(size: Measure.Tools.linkGlyph)).foregroundStyle(theme.muted)
          }
          .lineLimit(1)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
      }
    }
    .padding(.vertical, theme.rowPad)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .combine)
  }
}

// MARK: - How it's counted

struct HowCounted: View {
  @Environment(\.virgaTheme) private var theme
  let model: Interaction

  var body: some View {
    let coverage = model.coverage
    let totals = model.totals
    let inboundSince = coverage.inboundSinceMs.map { ". Yours reach back to \(Time.formatDateShort($0))" } ?? ". Yours hold nothing yet"
    let truncated = coverage.inboundTruncated ? " The last sync stopped before it reached the end of them, so the next one may find more." : ""
    let outboundSince = coverage.outboundSinceMs.map { ", read back to \(Time.formatDateShort($0)) so far" } ?? ", every one you have ever made"
    let archived = coverage.postsComplete ? "" : ", which are still being archived"
    let mentions =
      totals.out.mention == nil
      ? " Who your posts mention isn’t on record, so mentions are counted them to you only."
      : " So are your mentions; a post that replies to them and also mentions them counts as both."
    let known =
      model.engagedPosts.known
      ? ", except where the event says so." : ", which is also why it can’t rank your posts by how much they engaged with them."
    Disclosure("How this is counted") {
      VStack(alignment: .leading, spacing: theme.space3) {
        paragraph(
          "Them to you comes from your notifications: likes, reposts, replies, quotes and mentions aimed at you. Notifications only go back as far as Bluesky had kept them when your archive was first built, and a year at most\(inboundSince); what anyone did before that isn’t on record.\(truncated)"
        )
        paragraph(
          "You to them comes from two places. Your likes and reposts are records in your repo\(outboundSince). Your replies and quotes are read from your posts\(archived).\(mentions)"
        )
        paragraph(
          "A reply, a quote or a mention is a post, and is listed with a link to it. A like or a repost is listed without one: the archive keeps that it happened and when, not which post it was\(known)"
        )
        paragraph(
          "Who follows whom is as of your last sync, and each follow is dated by its own record; where that can’t be read, the date is left out. A follow that has ended leaves no record: someone who stopped following you shows only if the unfollow tracker saw it happen."
        )
        paragraph("Months are counted on your own calendar. Everything is read from the archive in this browser.")
      }
    }
  }

  private func paragraph(_ text: String) -> some View {
    Text(text)
      .virgaText(.textSm)
      .foregroundStyle(theme.ink2)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: theme.measure, alignment: .leading)
  }
}
#endif
