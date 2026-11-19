// Ports src/settings/sections.js
//
// The sections of Settings, in the order they are listed, each with the
// line that goes under its title. A file of its own, so the sidebar and the
// command palette can list them without the page.
// ios/parity/cases/insights-early.settings.js holds it to the web's.

import Foundation

/// One section of Settings. Its address is /settings/<key>.
public struct SettingsSection: Codable, Hashable, Sendable, Identifiable {
  public var key: String
  public var label: String
  public var desc: String
  public var id: String { key }
  public init(key: String, label: String, desc: String) {
    self.key = key
    self.label = label
    self.desc = desc
  }
}

public enum SettingsSections {
  public static let sections: [SettingsSection] = [
    SettingsSection(key: "account", label: "Account", desc: "The accounts signed in on this browser, and how long each sign-in lasts."),
    SettingsSection(key: "data", label: "Data and sync", desc: "What Virga keeps in this browser, how fresh it is, and how to take it with you."),
    SettingsSection(key: "dashboards", label: "Dashboards", desc: "Your sets of reports, and where they’re kept."),
    SettingsSection(key: "posting", label: "Posting", desc: "How a new post starts, the weekly queue, timers and the post adviser."),
    SettingsSection(key: "appearance", label: "Appearance", desc: "How Virga looks in this browser. Changes show straight away."),
    SettingsSection(key: "permissions", label: "Permissions", desc: "What signing in lets Virga do, and what it can’t."),
    SettingsSection(key: "about", label: "About", desc: "What Virga is, its terms, and where its numbers come from."),
  ]
}
