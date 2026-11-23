// Ports src/posting/ui/NeedsBackend.jsx
// Ports src/posting/posting.css (.needs-backend)
//
// Where a page or setting needs Virga's server and the account isn't
// signed in through it: what's missing, why, and the way to get it
// (BackendAccess.backendAccess). Draws nothing for an account that already
// has a long session, or that isn't on this device.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting
import VirgaSession

struct NeedsBackendNotice: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  let did: String?

  var body: some View {
    let session = app.session
    let account = session.accounts.first { Optional($0.did).jsEquals(did) }
    let access = BackendAccess.backendAccess(
      account, authMode: session.authMode, canSchedule: did.map { session.capabilitiesFor($0).canSchedule } ?? false)
    if !access.ready, let action = access.action, action != "none", let account {
      let name = Accounts.accountName(account)
      let host = AppConfig.backendHost(app.flags.backendURL)
      HStack(alignment: .top, spacing: Measure.Posting.needsBackendGap) {
        if !theme.isPhone {
          Image(systemName: "server.rack")
            .virgaGlyph(Measure.Posting.needsBackendIcon, beside: theme.points(ThemeKit.cardTitleFontSize))
            .foregroundStyle(theme.ink2)
            .padding(.top, Measure.Posting.needsBackendIconTop)
            .accessibilityHidden(true)
        }
        VStack(alignment: .leading, spacing: Measure.Posting.needsBackendTextGap) {
          Text(action == "signBackIn" ? "The long session has ended" : "Needs a long session")
            .virgaText(
              size: theme.points(ThemeKit.cardTitleFontSize), weight: ThemeKit.cardTitleWeight, lineHeight: ThemeKit.headingLineHeight,
              tracking: ThemeKit.cardTitleTracking)
            .foregroundStyle(theme.ink)
            .accessibilityAddTraits(.isHeader)
          Group {
            if action == "signBackIn" {
              Text(
                "Scheduled posts, timers and the post adviser run on Virga’s server (\(host)). Sign \(name) back in to see and change them. Anything already scheduled still goes out."
              )
            } else {
              Text(
                "Scheduled posts, timers and the post adviser run on Virga’s server (\(host)), so they keep working while this browser is closed. \(name) is signed in with a browser session, which only lasts while Virga is open here."
              )
            }
            if action == "unavailable" {
              Text("This copy of Virga doesn’t offer long sessions, so these features aren’t available here.")
            }
          }
          .virgaText(.textBase)
          .foregroundStyle(theme.color(ThemeKit.cardSubInk))
          .fixedSize(horizontal: false, vertical: true)
          if action == "reconnect" {
            Button {
              AccountActions.lengthen(account, session: session)
            } label: {
              Label("Reconnect for a longer session", systemImage: Glyph.timer)
            }
            .buttonStyle(.virga)
          }
          if action == "signBackIn" {
            Button {
              AccountCopy.requestReauth(account.did, immediate: true)
            } label: {
              Label("Sign back in", systemImage: Glyph.signIn)
            }
            .buttonStyle(.virga)
          }
        }
        .frame(maxWidth: theme.characters(Measure.Posting.needsBackendMeasure), alignment: .leading)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("needs-backend")
    }
  }
}
#endif
