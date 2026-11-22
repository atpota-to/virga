// The composer, in demo mode (it needs no built archive): opened from New
// post, empty; with words in it (a mention and a tag highlighted); a
// thread of three; two pictures (pasted, as the simulator's photo library
// may be empty); a link card read from the demo's card service; the
// language picker; the post-as picker; and pressing Post, which says
// publishing isn't in the iOS app yet. Each is kept as a screenshot (an
// XCTAttachment kept always), on the iPhone and the iPad.

import UIKit
import XCTest

final class ComposerUITests: XCTestCase {
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

  /// The post's text field, by its place in the thread.
  private func editor(_ app: XCUIApplication, _ index: Int) -> XCUIElement {
    app.textViews.matching(identifier: "post-editor-\(index)").firstMatch.exists
      ? app.textViews.matching(identifier: "post-editor-\(index)").firstMatch
      : app.textViews.element(boundBy: index)
  }

  /// Swipes the composer up until `target` is on screen (a few times at most).
  private func scrollTo(_ app: XCUIApplication, _ target: XCUIElement) {
    var tries = 0
    while !(target.exists && target.isHittable) && tries < 6 {
      app.swipeUp()
      tries += 1
    }
  }

  private func openComposer(_ app: XCUIApplication) {
    let newPost = element(app, isDesk(app) ? "sidebar-new-post" : "tab-new-post")
    XCTAssertTrue(newPost.waitForExistence(timeout: 30), "no New post button")
    newPost.tap()
    XCTAssertTrue(element(app, "composer-title").waitForExistence(timeout: 15), "the composer didn't open")
  }

  /// A picture on the pasteboard, pasted into `field` from its edit menu
  /// (a paste the writer asked for, so the system doesn't ask first).
  private func pastePicture(_ app: XCUIApplication, into field: XCUIElement, hue: CGFloat) -> Bool {
    let size = CGSize(width: 640, height: 480)
    let picture = UIGraphicsImageRenderer(size: size).image { context in
      UIColor(hue: hue, saturation: 0.45, brightness: 0.85, alpha: 1).setFill()
      context.fill(CGRect(origin: .zero, size: size))
      UIColor.white.withAlphaComponent(0.6).setFill()
      context.fill(CGRect(x: 80, y: 300, width: 480, height: 120))
    }
    UIPasteboard.general.image = picture
    field.press(forDuration: 1.2)
    let paste = app.menuItems["Paste"]
    guard paste.waitForExistence(timeout: 4) else { return false }
    paste.tap()
    return true
  }

  func testTheComposer() {
    let app = launch()
    openComposer(app)
    snapshot("composer-empty")

    // Words, with a mention and a tag highlighted (and the typeahead).
    let first = editor(app, 0)
    XCTAssertTrue(first.waitForExistence(timeout: 5))
    first.tap()
    first.typeText("Seed swap at the community garden this Saturday with @lab.example.org #gardening ")
    XCTAssertTrue(text(app, containing: "of 300").waitForExistence(timeout: 5))
    sleep(1)
    snapshot("composer-text")

    // Two pictures, pasted into the first post.
    if pastePicture(app, into: first, hue: 0.3) {
      _ = text(app, containing: "of 4 images").waitForExistence(timeout: 15)
      if pastePicture(app, into: first, hue: 0.58) {
        _ = text(app, containing: "2 of 4 images").waitForExistence(timeout: 15)
      }
      snapshot("composer-images")
    }

    // A thread of three, the last with a link that becomes a card.
    let addPost = element(app, "add-post")
    scrollTo(app, addPost)
    addPost.tap()
    let second = editor(app, 1)
    XCTAssertTrue(second.waitForExistence(timeout: 5))
    second.tap()
    second.typeText("Bring seeds in labelled envelopes; we'll have spares.")
    scrollTo(app, addPost)
    addPost.tap()
    let third = editor(app, 2)
    XCTAssertTrue(third.waitForExistence(timeout: 5))
    third.tap()
    third.typeText("Directions: https://example.com/garden-notes ")
    XCTAssertTrue(text(app, containing: "3 of 3").waitForExistence(timeout: 5))
    snapshot("composer-thread")
    let card = element(app, "link-card")
    if card.waitForExistence(timeout: 15) {
      scrollTo(app, card)
      snapshot("composer-link-card")
    }

    // The language picker.
    let language = element(app, "option-language")
    scrollTo(app, language)
    language.tap()
    XCTAssertTrue(text(app, containing: "Language and content labels").waitForExistence(timeout: 5))
    let search = app.textFields["Written in"]
    if search.waitForExistence(timeout: 3) {
      search.tap()
      search.typeText("Span")
    }
    sleep(1)
    snapshot("composer-language")
    app.buttons["Cancel"].firstMatch.tap()

    // Who it goes out as.
    let postAs = element(app, "post-as")
    XCTAssertTrue(postAs.waitForExistence(timeout: 5))
    var tries = 0
    while !postAs.isHittable && tries < 6 {
      app.swipeDown()
      tries += 1
    }
    postAs.tap()
    XCTAssertTrue(element(app, "post-as-list").waitForExistence(timeout: 5))
    snapshot("composer-post-as")
    postAs.tap()

    // Post: the web's busy line, then the sentence that it isn't here yet.
    let publish = element(app, "publish")
    XCTAssertTrue(publish.waitForExistence(timeout: 5))
    publish.tap()
    XCTAssertTrue(text(app, containing: "Publishing isn’t in the iOS app yet.").waitForExistence(timeout: 10))
    snapshot("composer-publish")
  }
}
