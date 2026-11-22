// Scheduling in demo mode (no archive build: the posting pages open before
// it): Posting › Scheduled posts over the demo server's seeded rows (a
// timer that couldn't be set, a thread that didn't go out, a queued post,
// a repeating post at a set time), the timer dialog from the timer note's
// Set a timer, the week ahead and a time picked from it; a post added to the queue from its Add to queue (the composer in
// queue mode, then the when panel) so the queue can be reordered; a post
// scheduled for a set time (the when panel, the WhenPicker with its quick
// picks and Repeat); a scheduled post opened to edit; the questions
// before skipping, posting now and removing. Then Posting › Weekly schedule
// (a time taken off, starting again from the default, copying a day) and
// Settings › Posting's weekly queue. Each is kept as a screenshot, on the
// iPhone and the iPad. A step the demo can't reach is skipped, not failed.

import UIKit
import XCTest

final class ScheduleUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += ["-VirgaDemo", "YES", "-VirgaDemoFlags", "latency=0"]
    app.launch()
    return app
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

  private func button(_ app: XCUIApplication, labelled label: String) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
  }

  private func waitForTitle(_ app: XCUIApplication, _ title: String, file: StaticString = #filePath, line: UInt = #line) {
    let heading = app.descendants(matching: .any)
      .matching(NSPredicate(format: "identifier == 'page-title' AND label == %@", title)).firstMatch
    XCTAssertTrue(heading.waitForExistence(timeout: 15), "no page titled \(title)", file: file, line: line)
  }

  /// A page through the command palette: Search, a few letters, its option.
  private func go(_ app: XCUIApplication, _ path: String, typing: String, title: String) {
    if element(app, "composer-title").exists, element(app, "composer-close").exists {
      element(app, "composer-close").tap()
    }
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

  /// Swipes up until `target` is on screen (a few times at most).
  private func scrollTo(_ app: XCUIApplication, _ target: XCUIElement, tries limit: Int = 6) {
    var tries = 0
    while !(target.exists && target.isHittable) && tries < limit {
      app.swipeUp()
      tries += 1
    }
  }

  private func scrollToTop(_ app: XCUIApplication) {
    for _ in 0..<4 { app.swipeDown() }
  }

  /// The post's text field, by its place in the thread.
  private func editor(_ app: XCUIApplication, _ index: Int) -> XCUIElement {
    app.textViews.matching(identifier: "post-editor-\(index)").firstMatch.exists
      ? app.textViews.matching(identifier: "post-editor-\(index)").firstMatch
      : app.textViews.element(boundBy: index)
  }

  /// A row's ⋯, then one of its items, by the item's words.
  private func menuItem(_ app: XCUIApplication, rowMenu: XCUIElement, _ label: String) -> Bool {
    guard rowMenu.waitForExistence(timeout: 5) else { return false }
    rowMenu.tap()
    let item = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
    guard item.waitForExistence(timeout: 5) else {
      // Shut the menu by a tap clear of it, at the window's top corner.
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.02)).tap()
      return false
    }
    item.tap()
    return true
  }

  /// A question's Keep it, and the question gone.
  private func keepIt(_ app: XCUIApplication) {
    let keep = element(app, "schedule-dialog-keep")
    if keep.waitForExistence(timeout: 5) {
      keep.tap()
      _ = element(app, "schedule-dialog").waitForNonExistence(timeout: 5)
    }
  }

  func testSchedulingOnTheDemo() {
    let app = launch()
    XCTAssertTrue(element(app, "first-run-title").waitForExistence(timeout: 30), "no first build's page")

    // Scheduled posts: the demo server's seeded rows.
    go(app, "/posting/scheduled", typing: "Scheduled", title: "Scheduled posts")
    XCTAssertTrue(element(app, "sched-queue").waitForExistence(timeout: 15), "no queue")
    XCTAssertTrue(element(app, "sched-failed").waitForExistence(timeout: 15), "the post that didn't go out isn't listed")
    sleep(1)
    snapshot("scheduled-posts")

    // A timer that couldn't be set: Set a timer opens the timer dialog over
    // the post that went out; once the timer is set the note is done with.
    let setTimer = element(app, "sched-note-set-timer")
    if setTimer.waitForExistence(timeout: 5) && setTimer.isHittable {
      setTimer.tap()
      if element(app, "timer-dialog").waitForExistence(timeout: 10) {
        _ = element(app, "lifespan-editor").waitForExistence(timeout: 10)
        snapshot("scheduled-timer-dialog")
        let set = element(app, "timer-dialog-set")
        if set.exists && set.isEnabled {
          set.tap()
          if element(app, "timer-dialog").waitForNonExistence(timeout: 10) {
            snapshot("scheduled-timer-set")
          } else {
            element(app, "dialog-close").tap()
          }
        } else {
          element(app, "dialog-close").tap()
        }
        _ = element(app, "timer-dialog").waitForNonExistence(timeout: 5)
      }
    }

    // The queue and the week ahead, and a taken time picked from it.
    let calendar = element(app, "queue-calendar")
    scrollTo(app, calendar)
    snapshot("scheduled-queue")
    let pick = element(app, "calendar-pick")
    if pick.exists && pick.isHittable {
      pick.tap()
      snapshot("scheduled-picked")
    }
    let timed = element(app, "sched-timed")
    scrollTo(app, timed)
    snapshot("scheduled-timed")

    // Add to queue: the composer in queue mode, then its when panel.
    let addToQueue = element(app, "sched-add-to-queue")
    scrollToTop(app)
    scrollTo(app, addToQueue)
    if addToQueue.waitForExistence(timeout: 5) {
      addToQueue.tap()
      XCTAssertTrue(element(app, "composer-title").waitForExistence(timeout: 15), "the composer didn't open")
      let first = editor(app, 0)
      XCTAssertTrue(first.waitForExistence(timeout: 5))
      first.tap()
      first.typeText("Plant swap on the green next week, bring a cutting and take one home.")
      let note = element(app, "when-queue-note")
      if note.waitForExistence(timeout: 5) {
        scrollTo(app, note)
        snapshot("composer-queue")
        let change = element(app, "when-change")
        if change.exists && change.isHittable {
          change.tap()
          _ = element(app, "when-queue-preview").waitForExistence(timeout: 10)
          snapshot("composer-when-queue")
        }
      }
      let publish = element(app, "publish")
      XCTAssertTrue(publish.waitForExistence(timeout: 5))
      publish.tap()
      if text(app, containing: "the queue, going out").waitForExistence(timeout: 30) {
        snapshot("composer-queued")
      }
      _ = element(app, "composer-title").waitForNonExistence(timeout: 10)
    }

    // Two in the queue: it can be reordered (arrows on a phone, a handle wider).
    let list = element(app, "sched-queue-list")
    if list.waitForExistence(timeout: 15) {
      scrollTo(app, list)
      sleep(1)
      snapshot("scheduled-reorder")
      let later = element(app, "sched-move-later")
      if later.exists && later.isHittable && later.isEnabled {
        later.tap()
        sleep(2)
        snapshot("scheduled-reordered")
      }
    }

    // Schedule a post: the when panel at the next hour, the WhenPicker.
    let scheduleOne = element(app, "sched-schedule-a-post")
    scrollTo(app, scheduleOne)
    if scheduleOne.waitForExistence(timeout: 5) && scheduleOne.isHittable {
      scheduleOne.tap()
      XCTAssertTrue(element(app, "composer-title").waitForExistence(timeout: 15), "the composer didn't open")
      let first = editor(app, 0)
      XCTAssertTrue(first.waitForExistence(timeout: 5))
      first.tap()
      first.typeText("Seed library open late on Thursday for the evening growers.")
      let panel = element(app, "when-panel")
      XCTAssertTrue(panel.waitForExistence(timeout: 5), "no when panel")
      let picker = element(app, "when-picker")
      scrollTo(app, picker)
      snapshot("composer-when")
      let tomorrow = element(app, "when-pick-morning")
      if tomorrow.exists && tomorrow.isHittable { tomorrow.tap() }
      let repeats = element(app, "when-repeat")
      scrollTo(app, repeats)
      snapshot("composer-when-picked")
      let publish = element(app, "publish")
      XCTAssertTrue(publish.waitForExistence(timeout: 5))
      publish.tap()
      if text(app, containing: "Scheduled for").waitForExistence(timeout: 30) {
        snapshot("composer-scheduled")
      }
      _ = element(app, "composer-title").waitForNonExistence(timeout: 10)
    }

    // A scheduled post opened to edit.
    let edit = element(app, "sched-edit")
    scrollToTop(app)
    scrollTo(app, edit)
    if edit.waitForExistence(timeout: 5) && edit.isHittable {
      edit.tap()
      let title = app.descendants(matching: .any)
        .matching(NSPredicate(format: "identifier == 'composer-title' AND label == 'Scheduled post'")).firstMatch
      if title.waitForExistence(timeout: 20) {
        sleep(1)
        snapshot("composer-scheduled-edit")
      }
      if element(app, "composer-close").exists { element(app, "composer-close").tap() }
      _ = element(app, "composer-title").waitForNonExistence(timeout: 10)
    }

    // The questions before an action, each kept and left.
    scrollToTop(app)
    let repeating = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'More for the post at'"))
    let timedMenu = repeating.element(boundBy: Swift.max(0, repeating.count - 1))
    scrollTo(app, timedMenu)
    if menuItem(app, rowMenu: timedMenu, "Skip this one") {
      if element(app, "schedule-dialog").waitForExistence(timeout: 5) { snapshot("scheduled-skip-dialog") }
      keepIt(app)
    }
    scrollToTop(app)
    let failedMenu = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'More for the post at'")).firstMatch
    if menuItem(app, rowMenu: failedMenu, "Post now") {
      if element(app, "schedule-dialog").waitForExistence(timeout: 5) { snapshot("scheduled-post-now-dialog") }
      keepIt(app)
    }
    if menuItem(app, rowMenu: failedMenu, "Dismiss") {
      if element(app, "schedule-dialog").waitForExistence(timeout: 5) { snapshot("scheduled-remove-dialog") }
      keepIt(app)
    }

    // The weekly schedule: its days, a time taken off, the default again.
    go(app, "/posting/schedule", typing: "Weekly", title: "Weekly schedule")
    XCTAssertTrue(element(app, "week-times").waitForExistence(timeout: 15), "no posting times")
    sleep(1)
    snapshot("weekly-schedule")
    let remove = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Remove ' AND label ENDSWITH ' on Mondays'")).firstMatch
    scrollTo(app, remove)
    if remove.exists && remove.isHittable {
      remove.tap()
      sleep(1)
      snapshot("weekly-schedule-changed")
    }
    let add = element(app, "week-add-tue")
    scrollTo(app, add)
    if add.exists && add.isHittable {
      add.tap()
      if element(app, "week-add-time").waitForExistence(timeout: 5) { snapshot("weekly-schedule-add") }
      let cancel = button(app, labelled: "Cancel")
      if cancel.exists { cancel.tap() }
    }
    let copyMenu = app.buttons.matching(NSPredicate(format: "label == 'More for Wednesdays'")).firstMatch
    scrollTo(app, copyMenu)
    if menuItem(app, rowMenu: copyMenu, "Copy to other days") {
      if element(app, "copy-days-confirm").waitForExistence(timeout: 5) { snapshot("weekly-schedule-copy") }
      if element(app, "dialog-close").exists { element(app, "dialog-close").tap() }
    }
    let reset = element(app, "week-reset")
    scrollTo(app, reset)
    if reset.exists && reset.isHittable {
      reset.tap()
      if element(app, "schedule-dialog").waitForExistence(timeout: 5) {
        snapshot("weekly-schedule-reset")
        element(app, "schedule-dialog-confirm").tap()
        _ = element(app, "schedule-dialog").waitForNonExistence(timeout: 5)
      }
    }
    let ahead = element(app, "week-ahead")
    scrollTo(app, ahead)
    snapshot("weekly-schedule-ahead")

    // Settings › Posting: the weekly queue on the same week.
    go(app, "/settings/posting", typing: "Posting", title: "Posting")
    let queue = element(app, "posting-queue")
    scrollTo(app, queue)
    XCTAssertTrue(queue.waitForExistence(timeout: 10), "no weekly queue in Settings › Posting")
    snapshot("settings-posting-queue")
  }
}
