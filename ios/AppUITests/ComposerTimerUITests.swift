// The composer's timer, in demo mode (no archive build: the composer and
// the posting pages open before it): a new post's Timer opens the timer
// dialog (LifespanDialog over the timer's editor), the timer is turned on
// and given a length, Done puts it on the post, and the post is sent. The
// timer is armed on it through the demo server's timer routes, so Posting ›
// Timers lists the post among the live timers. Each step is kept as a
// screenshot, on the iPhone and the iPad; a step the demo can't reach is
// skipped, not failed.

import UIKit
import XCTest

final class ComposerTimerUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

  /// The post's words, and the few of them the Timers page is searched for.
  private let words = "Tomato seedlings are free at the allotment gate until noon on Sunday, bring a pot."
  private let found = "allotment gate"

  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += ["-VirgaDemo", "YES", "-VirgaDemoFlags", "latency=0"]
    app.launch()
    return app
  }

  private func isDesk(_ app: XCUIApplication) -> Bool {
    isPad && app.windows.firstMatch.frame.width >= 900
  }

  private func snapshot(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = "\(name)\(isPad ? "-ipad" : "")"
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func text(_ app: XCUIApplication, containing words: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", words)).firstMatch
  }

  private func waitForTitle(_ app: XCUIApplication, _ title: String, file: StaticString = #filePath, line: UInt = #line) {
    let heading = app.descendants(matching: .any)
      .matching(NSPredicate(format: "identifier == 'page-title' AND label == %@", title)).firstMatch
    XCTAssertTrue(heading.waitForExistence(timeout: 15), "no page titled \(title)", file: file, line: line)
  }

  /// Swipes up until `target` is on screen (a few times at most).
  private func scrollTo(_ app: XCUIApplication, _ target: XCUIElement, tries limit: Int = 6) {
    var tries = 0
    while !(target.exists && target.isHittable) && tries < limit {
      app.swipeUp()
      tries += 1
    }
  }

  /// The post's text field, by its place in the thread.
  private func editor(_ app: XCUIApplication, _ index: Int) -> XCUIElement {
    app.textViews.matching(identifier: "post-editor-\(index)").firstMatch.exists
      ? app.textViews.matching(identifier: "post-editor-\(index)").firstMatch
      : app.textViews.element(boundBy: index)
  }

  /// A page through the command palette: Search, a few letters, its option.
  private func go(_ app: XCUIApplication, _ path: String, typing: String, title: String) {
    if element(app, "composer-title").exists, element(app, "composer-close").exists {
      element(app, "composer-close").tap()
    }
    // A button, not the navigation bar's group of toolbar items, which on iOS 26
    // takes the first item's identifier and whose middle is the account button.
    let search = app.buttons.matching(identifier: "palette-open").firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 10), "no Search")
    // On a part's front page the phone's app bar is in the page and scrolls
    // away with it (as `.appbar` on the web): back to the top for Search.
    var swipes = 0
    while search.frame.minY < 0 && swipes < 6 {
      app.swipeDown()
      swipes += 1
    }
    // Straight after a sheet closes (the composer, a dialog), Search is in the
    // hierarchy before it can be pressed, and a tap in the closing animation
    // is dropped: wait until it can be, and press once more if the palette
    // still isn't there.
    let pressable = expectation(for: NSPredicate(format: "isHittable == true"), evaluatedWith: search)
    wait(for: [pressable], timeout: 10)
    search.tap()
    let field = element(app, "palette-field")
    if !field.waitForExistence(timeout: 3), search.isHittable { search.tap() }
    XCTAssertTrue(field.waitForExistence(timeout: 5), "the palette didn't open")
    field.typeText(typing)
    let option = element(app, "palette-go:\(path)")
    XCTAssertTrue(option.waitForExistence(timeout: 5), "no \(title) in the palette")
    option.tap()
    waitForTitle(app, title)
  }

  private func openComposer(_ app: XCUIApplication) {
    let newPost = element(app, isDesk(app) ? "sidebar-new-post" : "tab-new-post")
    XCTAssertTrue(newPost.waitForExistence(timeout: 30), "no New post button")
    newPost.tap()
    XCTAssertTrue(element(app, "composer-title").waitForExistence(timeout: 15), "the composer didn't open")
  }

  /// The editor's own switch, "Put a timer on this post" (read as the
  /// system's switch, its label its name).
  private func timerSwitch(_ app: XCUIApplication) -> XCUIElement {
    app.switches.matching(NSPredicate(format: "label == %@", "Put a timer on this post")).firstMatch
  }

  func testATimerOnAPostFromTheComposer() {
    let app = launch()
    XCTAssertTrue(element(app, "first-run-title").waitForExistence(timeout: 30), "no first build's page")

    // A new post, with words in it.
    openComposer(app)
    let first = editor(app, 0)
    XCTAssertTrue(first.waitForExistence(timeout: 5))
    first.tap()
    first.typeText(words)

    // Timer: the dialog, over the post's rule (none yet).
    let option = element(app, "option-timer")
    scrollTo(app, option)
    XCTAssertTrue(option.waitForExistence(timeout: 5), "no Timer among the post's settings")
    snapshot("composer-timer-none")
    option.tap()
    let dialog = element(app, "lifespan-dialog")
    XCTAssertTrue(dialog.waitForExistence(timeout: 10), "the timer dialog didn't open")
    XCTAssertTrue(element(app, "lifespan-editor").waitForExistence(timeout: 5), "no timer editor in the dialog")
    snapshot("composer-timer-dialog")

    // On, and six hours long; the rule in a sentence under it.
    let on = timerSwitch(app)
    XCTAssertTrue(on.waitForExistence(timeout: 5), "no Put a timer on this post")
    on.tap()
    let sentence = element(app, "lifespan-sentence")
    XCTAssertTrue(sentence.waitForExistence(timeout: 5), "the timer's rule didn't open out")
    let sixHours = app.buttons.matching(NSPredicate(format: "label == %@", "6 hours")).firstMatch
    if sixHours.waitForExistence(timeout: 3) && sixHours.isHittable { sixHours.tap() }
    snapshot("composer-timer-editor")

    // Done: the post carries it, and its setting says so.
    let done = element(app, "lifespan-dialog-done")
    XCTAssertTrue(done.waitForExistence(timeout: 5), "no Done")
    done.tap()
    XCTAssertTrue(dialog.waitForNonExistence(timeout: 10), "the timer dialog stayed open")
    scrollTo(app, option)
    XCTAssertTrue(option.waitForExistence(timeout: 5))
    XCTAssertNotEqual(option.label, "Timer: none", "the post has no timer after Done")
    snapshot("composer-timer-set")

    // Sent: posted, then the timer armed on it (not waited for).
    let publish = element(app, "publish")
    XCTAssertTrue(publish.waitForExistence(timeout: 5))
    publish.tap()
    let asked = element(app, "ask-without")
    let noFreeTimer = asked.waitForExistence(timeout: 3)
    if noFreeTimer {
      // No free timer in the demo's limits: the question, then without it.
      snapshot("composer-timer-no-free-timer")
      asked.tap()
    }
    XCTAssertTrue(text(app, containing: "Posted as").waitForExistence(timeout: 60), "the post didn't go out")
    snapshot("composer-timer-posted")
    _ = element(app, "composer-title").waitForNonExistence(timeout: 10)
    if text(app, containing: "without its timer").waitForExistence(timeout: 5) {
      snapshot("composer-timer-not-armed")
    }

    // Posting › Timers: the post among the live timers.
    go(app, "/posting/timers", typing: "Timers", title: "Post timers")
    XCTAssertTrue(element(app, "timers-page").waitForExistence(timeout: 10), "no Timers page")
    let row = text(app, containing: found)
    if row.waitForExistence(timeout: 30) {
      scrollTo(app, row)
      sleep(1)
      snapshot("composer-timer-on-timers")
    } else {
      // Only a post that went without its timer (the question above) may be missing.
      snapshot("composer-timer-timers-without-it")
      XCTAssertTrue(noFreeTimer, "the timer set in the composer isn't on Posting › Timers")
    }
  }
}
