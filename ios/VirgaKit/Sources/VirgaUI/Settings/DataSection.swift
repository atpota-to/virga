// Ports src/settings/SettingsPage.jsx (DataSection, useStorageEstimate, megabytes, counted, archiveLine)
//
// Settings › Data and sync: what the archive holds and how fresh it is, the
// sync (every step while it runs, Cancel, what failed, Sync now or the rest
// of a build, Rebuild posts), the archive to take away (JSON, or the posts
// as CSV: ArchiveExports' file, saved where the person picks with the
// system's exporter), where it is kept, and deleting it (the archive's own
// delete, as the web's page does; the account and its sign-in stay). The
// words are the web's, "this browser" included, for now.
//
// Where the web asks the browser how much it holds (navigator.storage),
// this reads the size of the app's own folder; the in-memory demo has none
// to read, and says what the web says when there is no estimate. The web's
// "Keep it when space runs low" row is shown only where the browser can be
// asked (navigator.storage.persist); iOS has no such thing to ask, so it
// isn't drawn.
//
// The app's own row, with no web counterpart: whether the device's backups
// (iCloud's, or a computer's) take the archive and drafts' media, on unless
// it was turned off (AppStores' `backupKey`). A browser backs nothing up.

#if canImport(UIKit)
import SwiftUI
import UniformTypeIdentifiers
import VirgaArchive
import VirgaCore

struct DataSection: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(AppModel.self) private var app
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  @State private var confirm: Confirm?
  @State private var exporting: ExportFile?
  @State private var usage: Int?
  @State private var backsUp = true

  enum Confirm: Identifiable {
    case rebuild, delete
    var id: Self { self }
  }

  var body: some View {
    if let archive {
      sections(archive)
        .onAppear { backsUp = AppStores.backsUp(app.stores.keyValue) }
        .task { usage = await AppStores.bytesUsed(at: app.stores.filesDirectory) }
        .virgaDialog(isPresented: confirming(.rebuild), title: "Rebuild the post archive?") {
          Text(
            "Clears the post archive and reads every post again. It’s the only way deleted posts leave, and old posts’ counts fully refresh. It takes as long as the first build."
          )
          .fixedSize(horizontal: false, vertical: true)
        } actions: {
          Button("Cancel") { confirm = nil }
            .buttonStyle(.virga)
          Button("Rebuild") {
            confirm = nil
            Task { await archive.runSync(.full) }
          }
          .buttonStyle(.virga(.primary))
        }
        .virgaDialog(isPresented: confirming(.delete), title: "Delete this browser’s archive?") {
          Text(
            "Every post, follower, block, engagement event and repo record Virga holds for this account in this browser goes, along with the unfollow log. Your dashboards and settings stay."
          )
          .fixedSize(horizontal: false, vertical: true)
        } actions: {
          Button("Keep it") { confirm = nil }
            .buttonStyle(.virga)
          Button("Delete") {
            confirm = nil
            Task {
              await archive.deleteArchive()
              toasts?.push("The archive is deleted from this browser.")
              navigate("/")
            }
          }
          .buttonStyle(.virga(.danger))
          .accessibilityIdentifier("data-delete-confirm")
        }
        .fileExporter(
          isPresented: Binding(get: { exporting != nil }, set: { if !$0 { exporting = nil } }),
          document: exporting.map(ExportDocument.init), contentType: exporting.map(ExportDocument.contentType) ?? .plainText,
          defaultFilename: exporting?.filename
        ) { _ in
          exporting = nil
        }
    }
  }

  private func confirming(_ which: Confirm) -> Binding<Bool> {
    Binding(get: { confirm == which }, set: { if !$0 { confirm = nil } })
  }

  @ViewBuilder
  private func sections(_ archive: ArchiveModel) -> some View {
    let posts = archive.data.meta.posts
    let built = posts != nil
    VStack(alignment: .leading, spacing: theme.sectionGap) {
      SettingsSectionView(title: "Your archive", subView: AnyView(Self.archiveLine(archive))) {
        if let sync = archive.sync {
          VStack(alignment: .leading, spacing: theme.space4) {
            SyncSteps(sync: sync)
            Button("Cancel the sync") { archive.cancelSync() }
              .buttonStyle(.virga)
              .accessibilityIdentifier("data-cancel-sync")
          }
          .padding(.vertical, theme.rowPadLg)
          .frame(maxWidth: .infinity, alignment: .leading)
          // `.settings-sync` is a row like any other: a hairline under it.
          .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
        } else {
          if let error = archive.syncError {
            Callout(tone: .danger) {
              Text("The last sync had problems.").font(theme.font(.textBase, weight: VirgaWeight.semibold)) + Text(" \(error)")
            }
            .padding(.top, Measure.Settings.calloutSpaceAbove)
            .padding(.bottom, Measure.Settings.calloutSpaceBelow)
            .accessibilityIdentifier("data-sync-error")
          }
          SettingsRow(
            label: posts == nil ? "Build" : posts?.complete == true ? "Sync" : "Finish the build",
            hint: "A sync runs by itself when you open Virga and the archive is more than an hour old. It only fetches what’s new."
          ) {
            Button {
              let mode = SyncStatus.mode(archive)
              Task { await archive.runSync(mode) }
            } label: {
              Label(SyncStatus.runLabel(archive), systemImage: Glyph.refresh)
            }
            .buttonStyle(.virga)
            .accessibilityIdentifier("data-sync")
          }
          if built {
            SettingsRow(
              label: "Rebuild",
              hint: "Clears the post archive and reads every post again. It’s the only way deleted posts leave, and old posts’ counts fully refresh."
            ) {
              Button {
                confirm = .rebuild
              } label: {
                Label("Rebuild posts", systemImage: Glyph.rebuild)
              }
              .buttonStyle(.virga)
            }
          }
        }
      }

      SettingsSectionView(title: "Take it with you", sub: nil) {
        SettingsRow(label: "Everything, as JSON", hint: "Posts, followers, blocks, engagement and repo records, as this browser holds them.") {
          Button {
            exporting = try? archive.exportArchive()
          } label: {
            Label("Export JSON", systemImage: Glyph.download)
          }
          .buttonStyle(.virga)
          .disabled(!built)
          .accessibilityIdentifier("data-export-json")
        }
        SettingsRow(label: "Your posts, as CSV", hint: "Every post with its counts, newest first, for a spreadsheet.") {
          Button {
            exporting = archive.exportPosts()
          } label: {
            Label("Export CSV", systemImage: Glyph.download)
          }
          .buttonStyle(.virga)
          .disabled(!built)
          .accessibilityIdentifier("data-export-csv")
        }
      }

      SettingsSectionView(title: "Storage in this browser", sub: nil) {
        SettingsRow(label: "Kept on this device", hint: storageHint(archive), compactControl: true, kind: .state) {
          // Only the case to find is marked; kept, the line says where.
          if !archive.data.persistent {
            Badge("This session only", tone: .warn)
          }
        }
        SettingsRow(label: "iCloud Backup", hint: Self.backupHint, compactControl: true) {
          Toggle(
            "Include the archive in backups",
            isOn: Binding(
              get: { backsUp },
              set: { on in
                backsUp = on
                AppStores.setBacksUp(on, store: app.stores.keyValue, directory: app.stores.filesDirectory)
              })
          )
          .labelsHidden()
          .toggleStyle(.virgaSwitch)
          .accessibilityIdentifier("data-backup")
        }
      }

      SettingsSectionView(title: "Delete this archive", sub: nil, danger: true) {
        SettingsRow(
          label: "Everything Virga keeps for this account here",
          hint: "Your account, your repo and your followers aren’t touched. The next build reads it all again."
        ) {
          Button {
            confirm = .delete
          } label: {
            Label("Delete the archive…", systemImage: Glyph.trash)
          }
          // The quiet outline with its words in red (`is-danger`); the red
          // fill is the confirm dialog's.
          .buttonStyle(.virga(destructive: true))
          .disabled(!archive.data.loaded || archive.sync != nil)
          .accessibilityIdentifier("data-delete")
        }
      }
    }
  }

  private func storageHint(_ archive: ArchiveModel) -> String {
    if !archive.data.persistent {
      return archive.data.blocked
        ? "Another Virga tab is holding the archive open, so this one lasts the session only. Close that tab and reload to keep it."
        : "This browser holds the archive for this session only."
    }
    if let usage {
      return "Virga is using about \(Self.megabytes(usage)) here, for every account signed in on this browser."
    }
    return "In IndexedDB, in a database of its own for this account."
  }

  // MARK: The words

  /// What the backup switch decides. The app's own words.
  static let backupHint =
    "On, this device’s backups, to iCloud or to a computer, include the archive and your drafts’ pictures and video. Off, they stay on this device only: after a restore, the archive is built again from your accounts with its unfollow log starting over, and drafts come back without their pictures and video. Settings and dashboards are backed up either way. Sign-ins never are, so after a restore you sign in again."

  /// `megabytes(bytes)`: "3.4 MB", "128 MB".
  static func megabytes(_ bytes: Int?) -> String {
    guard let bytes else { return "—" }
    let mb = Double(bytes) / 1_048_576
    return "\(mb.jsToFixed(bytes < 10 * 1_048_576 ? 1 : 0)) MB"
  }

  /// `counted(n, one, many)`: "1,031 posts" or "1 post".
  static func counted(_ n: Int, _ one: String, _ many: String) -> String {
    "\(AppLocale.formatNumber(n)) \(n == 1 ? one : many)"
  }

  /// `archiveLine(archive, counts)`: "1,031 posts, 9,732 repo records and
  /// 4,810 followers that can be listed · synced 4m ago"; before the first
  /// build, only when. The dot goes with the words before it when the line
  /// breaks there, and "synced 4m ago" stays in one piece (`.settings-when`).
  static func archiveLine(_ archive: ArchiveModel) -> Text {
    let when = SyncStatus.when(archive)
    guard archive.data.meta.posts != nil else { return Text(when) }
    let counts = SyncStatus.counts(archive)
    let held =
      "\(counted(counts.posts, "post", "posts")), \(counted(counts.records, "repo record", "repo records")) and \(counted(counts.followers, "follower", "followers")) that can be listed"
    let lowered = String(when.prefix(1)).jsLowercased() + when.dropFirst()
    let whole = lowered.replacingOccurrences(of: " ", with: "\u{00A0}")
    return Text(held + "\u{00A0}· " + whole)
  }
}

/// An ExportFile, for the system's exporter.
struct ExportDocument: FileDocument {
  static var readableContentTypes: [UTType] { [.json, .commaSeparatedText, .plainText] }

  let data: Data

  init(_ file: ExportFile) {
    data = file.data
  }

  init(configuration: ReadConfiguration) throws {
    data = configuration.file.regularFileContents ?? Data()
  }

  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
    FileWrapper(regularFileWithContents: data)
  }

  /// The file's type, from its MIME type (`text/csv;charset=utf-8` is CSV).
  static func contentType(_ file: ExportFile) -> UTType {
    let mime = file.type.split(separator: ";").first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? file.type
    return UTType(mimeType: mime) ?? .plainText
  }
}
#endif
