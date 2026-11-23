// The command palette against the web code
// (ios/parity/cases/insights-early.commands.js): the whole list in each
// situation the app can be in, built from this target's own registries as
// well as from the fixture's, and every query ranked and grouped as the web
// ranks and groups it.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

@Suite struct CommandsParity {
  let fixture = "insights-early.commands"

  /// The fixture, read once.
  static let loaded = Result { try Parity.load("insights-early.commands") }

  func cases(_ fn: String) throws -> [ParityCase] {
    let found = try Self.loaded.get().cases.filter { $0.fn == fn }
    if found.isEmpty { throw ParityError.noCases(fixture: fixture, fn: fn) }
    return found
  }

  func contexts() throws -> [String: JSONValue] {
    try cases("contexts")[0].output.objectValue ?? [:]
  }

  /// The commands of a named context ("empty" is buildCommands()).
  func commands(_ name: String, _ c: ParityCase, _ contexts: [String: JSONValue]) -> [Command] {
    if name == "empty" { return Commands.buildCommands() }
    guard let json = contexts[name], let context = decoded(json, as: CommandContext.self, c) else { return [] }
    return Commands.buildCommands(context)
  }

  /// The case's commands: a named context's, a list the fixture holds once
  /// (`named`, e.g. the generated "fuzzCommands"), or the list it gives.
  func list(_ c: ParityCase, _ contexts: [String: JSONValue]) -> [Command] {
    if let name = c["context"].stringValue { return commands(name, c, contexts) }
    if let name = c["named"].stringValue {
      guard let held = try? cases(name).first?.output else {
        Issue.record("\(c): the fixture holds no list named \(name)")
        return []
      }
      return decoded(held, as: [Command].self, c) ?? []
    }
    if c["commands"].isNull { return [] }
    return decoded(c["commands"], as: [Command].self, c) ?? []
  }

  func ids(_ list: [Command]) -> JSONValue { .array(list.map { .string($0.id) }) }

  @Test func constants() throws {
    let c = try cases("constants")[0]
    let actual: JSONValue = [
      "COMMAND_GROUPS": .array(Commands.commandGroups.map(JSONValue.string)),
      "RECENT_GROUP": .string(Commands.recentGroup),
      "MAX_RECENT": .number(Double(Commands.maxRecent)),
    ]
    expectOutput(actual, c)
  }

  @Test func periodTitle() throws {
    for c in try cases("periodTitle") {
      let period = c["period"].isNull ? nil : decoded(c["period"], as: CommandContext.Period.self, c)
      expectOutput(.string(Commands.periodTitle(period)), c)
    }
  }

  @Test func buildCommands() throws {
    let contexts = try contexts()
    for c in try cases("buildCommands") {
      expectOutput(encoded(commands(c["context"].stringValue!, c, contexts)), c, strictNulls: true)
    }
  }

  /// The palette's own context, built from this target's registries, is
  /// the web's whole list: every report, tool, posting and Defense page and
  /// settings section, word for word.
  @Test func fromThisTargetsRegistries() throws {
    let all = try contexts()
    let built = try cases("buildCommands")
    for (name, defense) in [("full", true), ("noDefense", false)] {
      let c = built.first { $0.id == name }!
      guard let given = decoded(all[name]!, as: CommandContext.self, c) else { continue }
      let context = CommandContext.app(
        dashboards: given.dashboards.map { Dashboard(id: $0.id, name: $0.name) },
        accounts: given.accounts, activeDid: given.activeDid, periods: given.periods, period: given.period,
        sky: given.sky, route: AppRoute(section: .dashboard, dashboard: given.route.dashboard),
        archive: given.archive, defenseEnabled: defense)
      expectOutput(encoded(Commands.buildCommands(context)), c, strictNulls: true)
    }
  }

  @Test func fold() throws {
    for c in try cases("fold") {
      expectOutput(.string(Commands.fold(c["text"].stringValue)), c)
    }
  }

  @Test func rankCommands() throws {
    let contexts = try contexts()
    for c in try cases("rankCommands") {
      let ranked = Commands.rankCommands(list(c, contexts), c["query"].stringValue, recent: strings(c["recent"]))
      expectOutput(ids(ranked), c)
    }
  }

  @Test func paletteGroups() throws {
    let contexts = try contexts()
    for c in try cases("paletteGroups") {
      let groups = Commands.paletteGroups(list(c, contexts), c["query"].stringValue, recent: strings(c["recent"]))
      let actual: JSONValue = .array(groups.map { ["group": .string($0.group), "items": ids($0.items)] })
      expectOutput(actual, c)
    }
  }

  @Test func rememberRecent() throws {
    for c in try cases("rememberRecent") {
      let actual = Commands.rememberRecent(stored: c["recent"], c["id"].stringValue)
      expectOutput(.array(actual.map(JSONValue.string)), c)
    }
  }

  @Test func parseRecent() throws {
    for c in try cases("parseRecent") {
      expectOutput(.array(Commands.parseRecent(c["raw"].stringValue).map(JSONValue.string)), c)
    }
  }

  @Test func moveActive() throws {
    for c in try cases("moveActive") {
      let actual = Commands.moveActive(c["key"].stringValue!, c["index"].intValue!, c["count"].intValue!)
      expectOutput(actual.map { .number(Double($0)) } ?? .null, c)
    }
  }
}

@Suite struct CommandsBehaviour {
  @Test func everyAddressIsOneTheAppKnows() throws {
    let context = CommandContext.app(
      dashboards: Layouts.defaultLayout().dashboards, accounts: [], activeDid: nil, periods: [], period: nil,
      sky: "clock", route: AppRoute(section: .dashboard), archive: .init(built: true), defenseEnabled: true)
    let commands = Commands.buildCommands(context)
    #expect(Set(commands.map(\.id)).count == commands.count, "each id once")
    for command in commands {
      #expect(Commands.commandGroups.contains(command.group), "\(command.id)")
      #expect((command.go != nil) != (command.do != nil), "\(command.id) goes or does")
      if let go = command.go, go != "/terms", go != "/privacy" {
        #expect(try ShellRoutes.parseRoute(go).section != .missing, "\(go)")
      }
      if let icon = command.icon { #expect(Icons.hasSymbol(lucide: icon), "\(icon)") }
    }
  }

  @Test func typedRecentListsRoundTrip() {
    #expect(Commands.rememberRecent(["a", "b"], "b") == ["b", "a"])
    #expect(Commands.rememberRecent(nil, "a") == ["a"])
    #expect(Commands.parseRecent(#"["a","b"]"#) == ["a", "b"])
  }
}
