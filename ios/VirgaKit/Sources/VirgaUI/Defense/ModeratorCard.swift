// Ports src/defense/ModeratorCard.jsx
// Ports src/defense/defense.css (.defense-moderator, .defense-moderator-linked, .defense-moderator-code, .defense-link-code)
//
// Defense › Lists › The moderator: linking this account to Virga's
// moderator, the Bluesky account owners DM commands to ("block @someone",
// "undo", "history"). Linking is a short code made here and sent to the
// moderator from this same account; the moderator answers only accounts
// that did it. While a code waits to be sent, the link is read again every
// five seconds until it lands or the code expires.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaDefense
import VirgaNetwork

struct ModeratorCard: View {
  /// CODE_POLL_MS.
  static let codePollMs: Double = 5_000

  @Environment(\.virgaTheme) private var theme
  let lists: DefenseListsModel
  @State private var link: JSONValue?
  @State private var code: (code: String, expiresAt: String)?
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    let all = DefenseListRows.lists(lists.data)
    let handle = link?["moderator"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
    let linked = link?["linked"]?.isTruthy ?? false
    VirgaSection(
      title: "The moderator",
      sub:
        "Virga’s Bluesky account for doing this by DM: send it “block @someone”, “undo” or “history” from this account, and it answers. It reads the commands it knows and nothing else, and acts only on your own lists.",
      trailing: linked && handle != nil
        ? AnyView(
          Button("Unlink") {
            act {
              _ = try await DefenseService.unlinkModerator(lists.requester)
              await load()
            }
          }
          .buttonStyle(.linkAction)
          .disabled(busy))
        : nil
    ) {
      if !link.isPresent {
        if let error {
          Callout(tone: .danger) { Text(error) }
            .toolAnnounces(error, onAppear: true)
        } else {
          ToolEmptyLine("Reading…")
        }
      } else if let handle {
        if linked {
          linkedView(handle, all: all)
        } else if let code {
          codeView(handle, code: code.code)
        } else {
          Button(busy ? "Making a code…" : "Link the moderator") {
            act {
              let made = try await DefenseService.makeLinkCode(lists.requester)
              code = (made["code"].map(\.jsString) ?? "", made["expiresAt"].map(\.jsString) ?? "")
            }
          }
          .buttonStyle(.virga)
          .disabled(busy)
          .padding(.top, theme.space5)
          .accessibilityIdentifier("defense-moderator-link")
        }
      } else {
        Callout { Text("Virga’s moderator isn’t set up on this server yet.") }
      }
      if link.isPresent, let error {
        Callout(tone: .danger) { Text(error) }
          .toolAnnounces(error, onAppear: true)
          .padding(.top, theme.space4)
      }
    }
    .task(id: lists.did ?? "") { await load() }
    .task(id: code?.code ?? "") { await waitForTheLink() }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("defense-moderator")
  }

  private func profile(_ handle: String) -> AttributedString {
    var name = AttributedString("@\(handle)")
    name.link = URL(string: "https://bsky.app/profile/\(handle)")
    return name
  }

  private func linkedView(_ handle: String, all: [JSONValue]) -> some View {
    let since = link?["linkedAt"]?.stringValue.flatMap { $0.isEmpty ? nil : " since \(Time.formatDateShort($0))" } ?? ""
    var words = AttributedString("Linked\(since). DM ")
    words += profile(handle)
    words += AttributedString(" from this account; “help” lists what it does.")
    let chosen = link?["listId"].map(\.jsString) ?? ""
    let value = all.contains { DefenseListRows.id($0).jsEquals(chosen) } ? chosen : ""
    let choices: [SelectChoice<String>] =
      [SelectChoice("", "Ask me which")] + all.map { SelectChoice(DefenseListRows.id($0), DefenseListRows.name($0)) }
    return VStack(alignment: .leading, spacing: theme.space3) {
      Text(words).virgaText(.textBase).foregroundStyle(theme.ink2).tint(theme.ink).fixedSize(horizontal: false, vertical: true)
      if all.count > 1 {
        FieldStack("“block @someone” adds to") {
          VirgaSelect(
            "“block @someone” adds to",
            selection: Binding(
              get: { value },
              set: { next in
                act {
                  _ = try await DefenseService.chooseLinkList(lists.requester, next.isEmpty ? nil : .string(next))
                  await load()
                }
              }),
            options: choices
          )
          .disabled(busy)
        }
        .frame(maxWidth: Measure.Defense.moderatorField, alignment: .leading)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("defense-moderator-linked")
  }

  private func codeView(_ handle: String, code: String) -> some View {
    var send = AttributedString("Send this to ")
    send += profile(handle)
    send += AttributedString(" in a DM, from this account, within fifteen minutes:")
    return VStack(alignment: .leading, spacing: theme.space3) {
      Text(send).virgaText(.textBase).foregroundStyle(theme.ink2).tint(theme.ink).fixedSize(horizontal: false, vertical: true)
      // 1.125rem, which grows with Dynamic Type as a rem does with the
      // browser's text size; its tracking an em of that.
      let codeSize = theme.scaled(Measure.Defense.codeSize)
      Text("link \(code)")
        .font(.system(size: codeSize, design: .monospaced))
        .tracking(codeSize * Measure.Defense.codeTracking)
        .foregroundStyle(theme.ink)
        .textSelection(.enabled)
        .padding(.vertical, Measure.Defense.codePaddingV)
        .padding(.horizontal, Measure.Defense.codePaddingH)
        .background(RoundedRectangle(cornerRadius: theme.radiusSm).fill(theme.surface2))
        .overlay(RoundedRectangle(cornerRadius: theme.radiusSm).strokeBorder(theme.line, lineWidth: 1))
      MetaLine(["It works only from this account, and only once. This page notices when it lands."])
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("defense-moderator-code")
    // `role="status"`: the code to send is read out when it arrives, with
    // the rest of what the region says.
    .toolAnnounces(
      "Send this to @\(handle) in a DM, from this account, within fifteen minutes:\nlink \(code)\nIt works only from this account, and only once. This page notices when it lands.",
      onAppear: true)
  }

  /// `load()`: the link as the server has it.
  private func load() async {
    guard let req = lists.requester else { return }
    do {
      let next = try await DefenseService.fetchLink(req)
      link = next
      if next["linked"]?.isTruthy ?? false { code = nil }
    } catch {
      self.error = DefenseService.defenseErrorMessage(error)
    }
  }

  /// While a code is out, look for the link to land, until the code expires.
  private func waitForTheLink() async {
    guard let expiresAt = code?.expiresAt else { return }
    while !Task.isCancelled {
      try? await Task.sleep(nanoseconds: UInt64(Self.codePollMs * 1_000_000))
      if Task.isCancelled { return }
      let ends = JSDate.parse(expiresAt, timeZone: AppLocale.activeTimeZone())
      if ends <= SyncStatus.now() {
        code = nil
        return
      }
      await load()
    }
  }

  private func act(_ work: @escaping () async throws -> Void) {
    Task {
      busy = true
      error = nil
      defer { busy = false }
      do {
        try await work()
      } catch {
        self.error = DefenseService.defenseErrorMessage(error)
      }
    }
  }
}
#endif
