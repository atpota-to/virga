// Ports src/defense/AddToList.jsx
// Ports src/defense/defense.css (.defense-add-form, .defense-legend, .defense-band-tick, .defense-band-never, .defense-add-where, .defense-new-list, .defense-done, .defense-why-not, .defense-confirm)
//
// "Add to a list", under a scan's result: tick bands, pick a list (or make
// one), say why if you like, and approve. The plan goes to Virga's server
// (DefenseService.planAndApprove) and the people in it are added by its run
// route, a batch every few minutes, with the veto read again at every
// write. Nothing is offered from a scan that couldn't count who you know
// in common: without that count, "no connection" is a guess.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaDefense
import VirgaSession

/// `whyNot({ result, caps, session, lists })`: why a scan's people can't be
/// added from here, or nil when they can.
struct DefenseWhy: Hashable {
  var key: String
  var text: String

  @MainActor
  static func whyNot(vouchCheck: VouchCheck, caps: AccountCapabilities, authMode: String, lists: DefenseListsModel) -> DefenseWhy? {
    if vouchCheck != .canary {
      return DefenseWhy(key: "vouches", text: "This scan couldn’t check who you know in common, so nothing from it can go on a list. Scan again later.")
    }
    if caps.mode != "backend" {
      return authMode == "backend"
        ? DefenseWhy(
          key: "long",
          text: "Lists are written by Virga’s server while your browser is closed, so they need a long session. Reconnect for a longer session from the account menu."
        )
        : DefenseWhy(key: "long", text: "Lists are written by Virga’s server, which isn’t taking long sessions here.")
    }
    if let error = lists.error { return DefenseWhy(key: "error", text: error) }
    guard let data = lists.data, !data.isNull else { return DefenseWhy(key: "loading", text: "Reading your lists…") }
    if data["writes"] == .bool(false) {
      return DefenseWhy(
        key: "off",
        text: "Defense’s lists aren’t turned on on Virga’s server yet. A scan still shows you everything, and Export takes it with you.")
    }
    if caps.lists == "missing" {
      return DefenseWhy(
        key: "scope", text: "Defense needs one more permission to make lists and add people to them: writing list records in your repo, nothing else.")
    }
    return nil
  }
}

/// `WhyNot`: the reason, and for a missing permission the sign-in that asks for it.
struct DefenseWhyNotView: View {
  @Environment(\.virgaTheme) private var theme
  let why: DefenseWhy
  let asking: DefenseAccountModel.Asking?
  let onAsk: () -> Void

  var body: some View {
    let busy = DefenseWords.busy(asking)
    VStack(alignment: .leading, spacing: theme.space4) {
      Callout(tone: why.key == "scope" || why.key == "loading" ? .plain : .warn) { Text(why.text) }
        .accessibilityIdentifier("defense-why-not")
      if why.key == "scope" {
        Button(busy ? DefenseWords.opening : "Let Defense make lists", action: onAsk)
          .buttonStyle(.virga)
          .disabled(busy)
        if let error = DefenseWords.error(asking) {
          Callout(tone: .danger) { Text(error) }
        }
      }
    }
  }
}

/// The lists the server answered, read loosely: `{ id, name, purpose, … }`.
enum DefenseListRows {
  static func lists(_ data: JSONValue?) -> [JSONValue] { data?["lists"]?.arrayValue ?? [] }
  static func id(_ list: JSONValue?) -> String { list?["id"].map(\.jsString) ?? "" }
  static func name(_ list: JSONValue?) -> String { list?["name"]?.stringValue ?? "" }
  static func purpose(_ list: JSONValue?) -> String { list?["purpose"]?.stringValue ?? "" }
}

/// What an approval came to: `{ list, queued, kept, already }`.
struct DefenseDone: Hashable {
  var list: String
  var queued: Double
  var kept: Double
  var already: Double
}

struct AddToListCard: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  let result: ScanResult
  let defense: DefenseAccountModel
  let lists: DefenseListsModel
  @State private var bands: [Band] = Plan.defaultBands
  @State private var listId = ""
  @State private var newName = ""
  @State private var newPurpose = "block"
  @State private var note = ""
  @State private var confirming = false
  @State private var busy = false
  @State private var error: String?
  @State private var done: DefenseDone?
  /// A list made here whose approval then failed: the retry adds to it
  /// rather than making another of the same name.
  @State private var made: JSONValue?

  private struct Plan_ {
    var counts: [Band: Int]
    var adding: [PlanRow]
    var addingByBand: [Band: Int]
    var available: [JSONValue]
    var chosen: JSONValue?
    var making: Bool
  }

  private var plan: Plan_ {
    let counts = Plan.bandCounts(result.summary)
    let rows = Plan.planRows(result.summary, bands)
    let kept = Set((lists.data?["kept"]?.arrayValue ?? []).compactMap { $0["did"]?.stringValue }.map(JSKey.init))
    let adding = rows.filter { !kept.contains(JSKey($0.did)) }
    var byBand: [Band: Int] = [:]
    for r in adding { byBand[r.band, default: 0] += 1 }
    let known = DefenseListRows.lists(lists.data)
    var available = known
    if let made, !known.contains(where: { DefenseListRows.id($0).jsEquals(DefenseListRows.id(made)) }) { available.append(made) }
    let chosen = available.first { DefenseListRows.id($0).jsEquals(listId) } ?? (listId == "new" ? nil : available.first)
    return Plan_(
      counts: counts, adding: adding, addingByBand: byBand, available: available, chosen: chosen,
      making: listId == "new" || available.isEmpty)
  }

  var body: some View {
    let p = plan
    let why = DefenseWhy.whyNot(
      vouchCheck: result.summary.vouchCheck, caps: defense.caps, authMode: defense.session.authMode, lists: lists)
    VirgaSection(
      title: "Add to a list",
      sub:
        "Choose who from this post goes on one of your block or mute lists. Anyone you follow, keep, or have on a curation list is left off, checked again as each one is written."
    ) {
      if let why {
        DefenseWhyNotView(why: why, asking: defense.asking) { Task { await defense.askFor(.lists) } }
      } else if let done {
        doneView(done)
      } else {
        form(p)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("defense-add")
    .virgaDialog(isPresented: $confirming, title: confirmTitle(p)) {
      confirmWords(p)
    } actions: {
      Button("Cancel") { confirming = false }
        .buttonStyle(.virga(.ghost))
        .disabled(busy)
      Button(busy ? "Adding…" : "Add \(AppLocale.fmtInt(Double(p.adding.count)))") {
        Task { await approve(p) }
      }
      .buttonStyle(.virga(.primary))
      .disabled(busy)
      .accessibilityIdentifier("defense-add-confirm")
    }
  }

  // MARK: The form

  private func form(_ p: Plan_) -> some View {
    let n = p.adding.count
    let fmt = { (n: Int) in AppLocale.fmtInt(Double(n)) }
    return VStack(alignment: .leading, spacing: theme.space5) {
      VStack(alignment: .leading, spacing: 0) {
        Text("Who")
          .virgaText(.textSm, weight: VirgaWeight.semibold)
          .foregroundStyle(theme.ink2)
          .padding(.bottom, theme.space2)
          .frame(maxWidth: .infinity, alignment: .leading)
          .overlay(alignment: .bottom) { Rectangle().fill(theme.rule).frame(height: 1) }
          .accessibilityAddTraits(.isHeader)
        ForEach(Plan.approvableBands, id: \.self) { band in
          tick(band, count: p.counts[band] ?? 0)
        }
        HStack(spacing: Measure.Defense.tickGap) {
          BandMark(band: .protected)
          Text("\(fmt(result.summary.totals.byBand[.protected] ?? 0)) protected are never added.")
        }
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
        .padding(.top, theme.rowPad)
        .padding(.leading, Measure.Defense.neverInset)
      }
      VStack(alignment: .leading, spacing: theme.space4) {
        FieldStack("To") {
          Picker("To", selection: Binding(get: { p.making ? "new" : DefenseListRows.id(p.chosen) }, set: { listId = $0 })) {
            ForEach(Array(p.available.enumerated()), id: \.offset) { _, l in
              Text("\(DefenseListRows.name(l)) (\(DefenseListRows.purpose(l) == "mute" ? "mute" : "block"))").tag(DefenseListRows.id(l))
            }
            Text("A new list…").tag("new")
          }
          .pickerStyle(.menu)
          .tint(theme.ink)
          .frame(maxWidth: .infinity, alignment: .leading)
          .virgaField()
        }
        if p.making {
          DefenseNewListFields(name: $newName, purpose: $newPurpose, nameLabel: "Its name")
        }
        FieldStack("Why, in your words (optional)") {
          TextField("The quote pile-on, 18 November", text: $note)
            .virgaField()
            .onChange(of: note) { _, next in if next.utf16.count > Plan.noteMax { note = next.jsSlice(0, Plan.noteMax) } }
            .accessibilityLabel("Why, in your words (optional)")
          FieldHint("Kept with each of them, so “why is this person on my list” has an answer.")
        }
      }
      if n > Plan.planMax {
        Callout(tone: .warn) { Text("That’s more than \(fmt(Plan.planMax)), the most one plan holds. Tick fewer bands.") }
      }
      FlowLayout(spacing: theme.space3, lineSpacing: theme.space3, alignment: .center) {
        Button(n > 0 ? "Add \(fmt(n))…" : "Nobody ticked") {
          error = nil
          if n > 0 && (!p.making || !newName.jsTrimmed().isEmpty) { confirming = true }
        }
        .buttonStyle(.virga)
        .disabled(n == 0 || n > Plan.planMax || (p.making && newName.jsTrimmed().isEmpty) || busy)
        .accessibilityIdentifier("defense-add-go")
        if n > 0 {
          MetaLine(["\(Plan.estimateWords(n)) at Virga’s pace"])
        }
      }
      if let error {
        Callout(tone: .danger) { Text(error) }
      }
    }
    .frame(maxWidth: Measure.Defense.columnMax, alignment: .leading)
  }

  /// A band to tick: the box, its mark and name, how many, and what it
  /// means on the line under.
  private func tick(_ band: Band, count: Int) -> some View {
    let on = bands.contains(band)
    let disabled = count == 0
    let ink = disabled ? theme.faint : theme.ink
    return Button {
      if on { bands.removeAll { $0 == band } } else { bands.append(band) }
    } label: {
      HStack(alignment: .top, spacing: Measure.Defense.tickGap) {
        ToolCheck(isOn: .constant(on), label: BandWords.bandWord[band] ?? "", disabled: disabled)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: Measure.Defense.tickLineGap) {
          HStack(spacing: Measure.Defense.tickGap) {
            BandMark(band: band)
            Text(BandWords.bandWord[band] ?? "").virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(ink)
            Spacer(minLength: 0)
            Text(AppLocale.fmtInt(Double(count))).virgaText(.textBase).foregroundStyle(disabled ? theme.faint : theme.ink2)
          }
          Text(BandWords.bandMeans[band] ?? "")
            .virgaText(.textSm)
            .foregroundStyle(disabled ? theme.faint : theme.muted)
            .fixedSize(horizontal: false, vertical: true)
            .multilineTextAlignment(.leading)
        }
        .padding(.top, theme.space2)
      }
      .padding(.vertical, theme.rowPad / 2)
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(disabled)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityLabel("\(BandWords.bandWord[band] ?? ""), \(AppLocale.fmtInt(Double(count)))")
    .accessibilityHint(BandWords.bandMeans[band] ?? "")
    .accessibilityAddTraits(on ? .isSelected : [])
    .accessibilityIdentifier("defense-tick-\(band.rawValue)")
  }

  // MARK: Done

  private func doneView(_ done: DefenseDone) -> some View {
    let fmt = { (n: Double) in AppLocale.fmtInt(n) }
    let head =
      done.queued != 0
      ? "\(fmt(done.queued)) queued for “\(done.list)”. Writing starts within a few minutes and takes \(Plan.estimateWords(done.queued))."
      : "Nobody new to add to “\(done.list)”: everyone ticked is on it already or kept."
    let kept = done.kept != 0 ? " \(fmt(done.kept)) you keep by hand left off." : ""
    let already = done.already != 0 ? " \(fmt(done.already)) on it already." : ""
    return VStack(alignment: .leading, spacing: theme.space3) {
      Text(head + kept + already)
        .virgaText(.textBase)
        .foregroundStyle(theme.ink)
        .fixedSize(horizontal: false, vertical: true)
      FlowLayout(spacing: theme.space5, lineSpacing: theme.space2, alignment: .firstTextBaseline) {
        MoreLink("Follow it on Lists", to: "/defense/lists")
        Button("Add more from this post") { self.done = nil }
          .buttonStyle(.linkAction)
      }
    }
    .frame(maxWidth: theme.measure, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("defense-done")
  }

  // MARK: Confirming

  private func confirmTitle(_ p: Plan_) -> String {
    let n = AppLocale.fmtInt(Double(p.adding.count))
    return p.making ? "Add \(n) to a new list, “\(newName.jsTrimmed())”?" : "Add \(n) to “\(DefenseListRows.name(p.chosen))”?"
  }

  private func confirmWords(_ p: Plan_) -> some View {
    let n = p.adding.count
    let counted = bands.filter { (p.addingByBand[$0] ?? 0) > 0 }
      .map { "\(AppLocale.fmtInt(Double(p.addingByBand[$0] ?? 0))) \(BandWords.bandCounted[$0] ?? "")" }
      .joined(separator: ", ")
    let words = Plan.estimateWords(n)
    let when = words == "a minute or two" ? "in a minute or two" : "over \(words)"
    let verb = newPurpose == "mute" ? "mute" : "block"
    return VStack(alignment: .leading, spacing: theme.space3) {
      Text("\(counted). They go on \(p.making ? "a new list in your repo" : "the list") \(when), a batch at a time.")
      Text("Anyone you follow by then, keep, or have on a curation list is left off at the moment they would be written. History can take the whole lot back.")
      if p.making {
        Text(
          "The list is made in your own repo, where anyone can see it on your profile. Once it’s there, open it in Bluesky and \(verb) it, so its members are \(verb == "mute" ? "muted" : "blocked") for you."
        )
      }
    }
    .fixedSize(horizontal: false, vertical: true)
    .frame(maxWidth: Measure.Defense.confirmMax, alignment: .leading)
  }

  /// Make the list if it is a new one, then the plan, and approve it.
  private func approve(_ p: Plan_) async {
    busy = true
    error = nil
    defer {
      busy = false
      confirming = false
    }
    do {
      let req = lists.requester
      var list = p.chosen
      if p.making {
        let madeList = try await DefenseService.createList(req, name: newName.jsTrimmed(), purpose: newPurpose)
        made = madeList
        listId = DefenseListRows.id(madeList)
        list = madeList
      }
      guard let list else { return }
      var totals: [String: JSONValue] = ["participants": .number(Double(result.summary.totals.participants))]
      for (band, count) in result.summary.totals.byBand { totals[band.rawValue] = .number(Double(count)) }
      let out = try await DefenseService.planAndApprove(
        req, listId: list["id"] ?? .null, postUri: result.post.uri.isEmpty ? nil : result.post.uri, rows: p.adding,
        totals: JSONValue.object(totals), bands: bands.map(\.rawValue), note: Plan.cleanNote(note))
      // `out.queued` and the rest as numbers; one the server left out is none.
      func count(_ name: String) -> Double {
        let n = out[name].jsNumber
        return n.isNaN ? 0 : n
      }
      done = DefenseDone(list: DefenseListRows.name(list), queued: count("queued"), kept: count("kept"), already: count("already"))
      listId = DefenseListRows.id(list)
      newName = ""
      await lists.refresh()
    } catch {
      self.error = DefenseService.defenseErrorMessage(error)
    }
  }
}

/// A new list's name and what it is for (`.defense-new-list`): side by
/// side, the choice 12rem wide; one under the other on a phone.
struct DefenseNewListFields: View {
  @Environment(\.virgaTheme) private var theme
  @Binding var name: String
  @Binding var purpose: String
  let nameLabel: String

  var body: some View {
    let nameField = FieldStack(nameLabel) {
      TextField("Pile-ons", text: $name)
        .virgaField()
        .onChange(of: name) { _, next in if next.utf16.count > 64 { name = next.jsSlice(0, 64) } }
        .accessibilityLabel(nameLabel)
        .accessibilityIdentifier("defense-list-name")
    }
    let forField = FieldStack("For") {
      Picker("For", selection: $purpose) {
        Text("Blocking").tag("block")
        Text("Muting").tag("mute")
      }
      .pickerStyle(.menu)
      .tint(theme.ink)
      .frame(maxWidth: .infinity, alignment: .leading)
      .virgaField()
    }
    Group {
      if theme.isPhone {
        VStack(alignment: .leading, spacing: theme.space4) {
          nameField
          forField
        }
      } else {
        HStack(alignment: .bottom, spacing: theme.space4) {
          nameField
          forField.frame(width: Measure.Defense.selectColumn)
        }
      }
    }
  }
}
#endif
