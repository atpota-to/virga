// The post adviser in demo mode, over the demo server's AI routes (the
// post's read, the style's description, an image's description). No build
// of the archive: from the first build's page, Settings › Posting turns the
// adviser on (its recommended setup) and the default timer, showing the
// adviser's settings and the timer's rule editor; the style dialog reads
// Mira's posts; then the composer, with a post the adviser has things to
// say about: Check this post (the busy line, then its sheet), the check
// before sending (its sheet), and an image's alt text described. Each is
// kept as a screenshot, on the iPhone and the iPad; a screen the demo
// doesn't reach is skipped rather than failed.

import UIKit
import XCTest

final class AdviserUITests: XCTestCase {
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

  private func isDesk(_ app: XCUIApplication) -> Bool {
    isPad && app.windows.firstMatch.frame.width >= 900
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

  /// A page through the command palette.
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

  private func editor(_ app: XCUIApplication, _ index: Int) -> XCUIElement {
    app.textViews.matching(identifier: "post-editor-\(index)").firstMatch.exists
      ? app.textViews.matching(identifier: "post-editor-\(index)").firstMatch
      : app.textViews.element(boundBy: index)
  }

  /// A picture on the pasteboard, pasted into `field` from its edit menu.
  private func pastePicture(_ app: XCUIApplication, into field: XCUIElement) -> Bool {
    let size = CGSize(width: 640, height: 480)
    let picture = UIGraphicsImageRenderer(size: size).image { context in
      UIColor(hue: 0.33, saturation: 0.45, brightness: 0.85, alpha: 1).setFill()
      context.fill(CGRect(origin: .zero, size: size))
    }
    UIPasteboard.general.image = picture
    field.press(forDuration: 1.2)
    let paste = app.menuItems["Paste"]
    guard paste.waitForExistence(timeout: 4) else { return false }
    paste.tap()
    return true
  }

  /// The sheet's Keep editing (or its Close).
  private func keepEditing(_ app: XCUIApplication) {
    for id in ["adviser-sheet-keep-editing", "adviser-close", "dialog-close"] where element(app, id).exists {
      element(app, id).tap()
      return
    }
  }

  func testTheAdviserOnTheDemo() {
    let app = launch()
    XCTAssertTrue(element(app, "first-run-title").waitForExistence(timeout: 15), "no first build's page")

    // Settings › Posting: the adviser on (its recommended setup).
    go(app, "/settings/posting", typing: "Posting", title: "Posting")
    let enabled = element(app, "adviser-enabled")
    scrollTo(app, enabled)
    XCTAssertTrue(enabled.exists, "no Use the post adviser")
    enabled.tap()
    let learn = element(app, "adviser-learn-style")
    XCTAssertTrue(learn.waitForExistence(timeout: 5), "the adviser's settings didn't open out")
    snapshot("settings-posting-adviser")

    // The default timer on, and its rule's editor.
    let timerOn = element(app, "default-timer-on")
    scrollTo(app, timerOn)
    if timerOn.exists {
      timerOn.tap()
      let ruleEditor = element(app, "lifespan-editor")
      if ruleEditor.waitForExistence(timeout: 5) {
        scrollTo(app, element(app, "lifespan-sentence"))
        snapshot("settings-posting-timer-editor")
      }
    }

    // The style dialog: Mira's posts read and described.
    scrollTo(app, learn)
    learn.tap()
    let read = element(app, "style-read")
    if read.waitForExistence(timeout: 5) {
      read.tap()
      if element(app, "style-keep").waitForExistence(timeout: 30) {
        snapshot("adviser-style")
      } else {
        snapshot("adviser-style-unread")
      }
    }
    element(app, "dialog-close").tap()

    // The composer, with a post the adviser has things to say about.
    let newPost = element(app, isDesk(app) ? "sidebar-new-post" : "tab-new-post")
    XCTAssertTrue(newPost.waitForExistence(timeout: 15), "no New post button")
    newPost.tap()
    XCTAssertTrue(element(app, "composer-title").waitForExistence(timeout: 15), "the composer didn't open")
    let first = editor(app, 0)
    XCTAssertTrue(first.waitForExistence(timeout: 5))
    first.tap()
    first.typeText("Honestly this is the worst take I have read all week. You shoud read it agian before posting.")

    // Check this post: the busy line, then the sheet.
    let check = element(app, "option-adviser")
    scrollTo(app, check)
    if check.exists {
      check.tap()
      if element(app, "adviser-busy").waitForExistence(timeout: 5) { snapshot("adviser-busy") }
      if element(app, "adviser-sheet").waitForExistence(timeout: 30) {
        snapshot("adviser-check")
        keepEditing(app)
      }
    }

    // The check before sending.
    let publish = element(app, "publish")
    if publish.waitForExistence(timeout: 5) {
      publish.tap()
      if element(app, "adviser-busy").waitForExistence(timeout: 5) { snapshot("adviser-gate-busy") }
      if element(app, "adviser-sheet").waitForExistence(timeout: 30) {
        snapshot("adviser-gate")
        keepEditing(app)
      } else {
        snapshot("adviser-gate-passed")
      }
    }

    // An image's alt text, described.
    if pastePicture(app, into: editor(app, 0)) {
      let alt = element(app, "image-alt-0")
      if alt.waitForExistence(timeout: 10) {
        alt.tap()
        let describe = element(app, "alt-describe")
        if describe.waitForExistence(timeout: 5) {
          describe.tap()
          if element(app, "alt-revise").waitForExistence(timeout: 30) { snapshot("alt-text-described") }
        }
      }
    }
  }
}
