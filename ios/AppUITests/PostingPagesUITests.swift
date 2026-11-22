// The posting pages that read Virga's server and Bluesky, in demo mode,
// over the demo server's seeded rows (a queued post, one that didn't go
// out, a timer counting down) and Mira's drafts and posts. No build of the
// archive: from the first build's page, the command palette goes to the
// overview, Drafts (a row's menu and Schedule this draft), Posted (a
// post's menu and the timer dialog, which sets a timer), and Timers (the
// lists and the settled ones). Each is kept as a screenshot, on the iPhone
// and the iPad; a screen the demo doesn't reach is skipped, not failed.

import UIKit
import XCTest

final class PostingPagesUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += ["-VirgaDemo", "YES", "-VirgaDemoFlags", "latency=0"]
    app.launch()
    return app
  }

  private func snapshot(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func waitForTitle(_ app: XCUIApplication, _ title: String, file: StaticString = #filePath, line: UInt = #line) {
    let heading = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'page-title' AND label == %@", title)).firstMatch
    XCTAssertTrue(heading.waitForExistence(timeout: 15), "no page titled \(title)", file: file, line: line)
  }

  private func scrollTo(_ app: XCUIApplication, _ target: XCUIElement) {
    var tries = 0
    while !(target.exists && target.isHittable) && tries < 8 {
      app.swipeUp()
      tries += 1
    }
  }

  /// A page through the command palette: Search, a few letters, its option.
  private func go(_ app: XCUIApplication, _ path: String, typing: String, title: String) {
    let search = element(app, "palette-open")
    XCTAssertTrue(search.waitForExistence(timeout: 10), "no Search")
    search.tap()
    let field = element(app, "palette-field")
    XCTAssertTrue(field.waitForExistence(timeout: 5), "the palette didn't open")
    field.typeText(typing)
    let option = element(app, "palette-go:\(path)")
    XCTAssertTrue(option.waitForExistence(timeout: 5), "no \(title) in the palette")
    option.tap()
    waitForTitle(app, title)
  }

  /// Opens the first row's ⋯ in `list`; false when the list has none.
  private func openFirstMenu(_ app: XCUIApplication, in list: String) -> Bool {
    let container = element(app, list)
    guard container.waitForExistence(timeout: 15) else { return false }
    let menu = container.descendants(matching: .any).matching(identifier: "row-menu").firstMatch
    guard menu.waitForExistence(timeout: 5) else { return false }
    scrollTo(app, menu)
    menu.tap()
    return true
  }

  func testThePostingPagesOnTheDemo() {
    let app = launch()
    XCTAssertTrue(element(app, "first-run-title").waitForExistence(timeout: 15), "no first build's page")

    // The overview: what goes out next (the demo server's queued post and
    // the one that didn't go out), the latest drafts, the latest posts.
    go(app, "/posting", typing: "Overview", title: "Posting")
    XCTAssertTrue(element(app, "posting-hub").waitForExistence(timeout: 10), "no overview")
    XCTAssertTrue(element(app, "hub-next").waitForExistence(timeout: 10), "no Going out next")
    _ = element(app, "hub-retry").waitForExistence(timeout: 10)
    snapshot("posting-hub")
    let posted = element(app, "hub-posted")
    scrollTo(app, posted)
    snapshot("posting-hub-posted")

    // Drafts: Mira's, a row's menu, and Schedule this draft.
    go(app, "/posting/drafts", typing: "Drafts", title: "Drafts")
    XCTAssertTrue(element(app, "drafts-page").waitForExistence(timeout: 10), "no Drafts page")
    let listed = element(app, "drafts-list").waitForExistence(timeout: 15)
    snapshot(listed ? "posting-drafts" : "posting-drafts-empty")
    if listed && openFirstMenu(app, in: "drafts-list") {
      snapshot("posting-drafts-menu")
      let schedule = app.buttons["Schedule…"]
      if schedule.waitForExistence(timeout: 5) {
        schedule.tap()
        if element(app, "schedule-draft-dialog").waitForExistence(timeout: 10) {
          _ = element(app, "schedule-draft-queue").waitForExistence(timeout: 5)
          snapshot("posting-drafts-schedule")
          element(app, "dialog-close").tap()
          XCTAssertTrue(element(app, "schedule-draft-dialog").waitForNonExistence(timeout: 5), "the dialog stayed open")
        }
      } else {
        app.tap()
      }
    }

    // Posted: the latest posts (the archive isn't built), a post's menu,
    // and the timer dialog, which sets a timer.
    go(app, "/posting/posted", typing: "Posted", title: "Posted")
    XCTAssertTrue(element(app, "posted-page").waitForExistence(timeout: 10), "no Posted page")
    let posts = element(app, "posted-list").waitForExistence(timeout: 15)
    snapshot("posting-posted")
    if posts && openFirstMenu(app, in: "posted-list") {
      snapshot("posting-posted-menu")
      let timer = app.buttons["Put on a timer"]
      if timer.waitForExistence(timeout: 5) {
        timer.tap()
        if element(app, "timer-dialog").waitForExistence(timeout: 10) {
          let set = element(app, "timer-dialog-set")
          _ = element(app, "lifespan-editor").waitForExistence(timeout: 10)
          snapshot("posting-timer-dialog")
          if set.exists && set.isEnabled {
            set.tap()
            if element(app, "timer-dialog").waitForNonExistence(timeout: 10) {
              snapshot("posting-timer-set")
            } else {
              snapshot("posting-timer-dialog-refused")
              element(app, "dialog-close").tap()
            }
          } else {
            element(app, "dialog-close").tap()
          }
        }
      } else {
        app.tap()
      }
    }

    // Timers: what's counting down, and the settled ones.
    go(app, "/posting/timers", typing: "Timers", title: "Post timers")
    XCTAssertTrue(element(app, "timers-page").waitForExistence(timeout: 10), "no Timers page")
    let live = element(app, "timers-live").waitForExistence(timeout: 15)
    snapshot(live ? "posting-timers" : "posting-timers-empty")
    let settled = element(app, "timers-settled")
    scrollTo(app, settled)
    if settled.exists {
      let open = settled.buttons["Show settled timers"]
      if open.exists { open.tap() } else { settled.tap() }
      sleep(1)
      scrollTo(app, settled)
      snapshot("posting-timers-settled")
    }
  }
}
