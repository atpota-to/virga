// The composer, in demo mode (it needs no built archive): opened from New
// post, empty; with words in it (a mention and a tag highlighted); a
// thread of three; two pictures (pasted, as the simulator's photo library
// may be empty); the "/" templates; a link card read from the demo's card
// service; the language picker; the post-as picker; pressing Post, which
// says publishing isn't in the iOS app yet; the library from the composer;
// a template with blanks answered through its questions into the post;
// Continue a thread; and the Library page. On a phone, the bar at the top
// with the keyboard up. Each is kept as a
// screenshot (an XCTAttachment kept always), on the iPhone and the iPad,
// all in one launch.

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
    if !isDesk(app) && !isPad {
      // A phone: Close, the title and the send button in the bar at the
      // top, the keyboard up below.
      XCTAssertTrue(element(app, "composer-bar").exists, "no bar at the top of the phone's composer")
      XCTAssertTrue(element(app, "publish").isHittable, "the send button is under the keyboard")
      snapshot("composer-bar-keyboard")
    }

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
    // The "/" shortcuts: the account's templates, or why there are none.
    second.typeText("/")
    if element(app, "slash-templates").waitForExistence(timeout: 10) {
      sleep(1)
      snapshot("composer-slash")
    }
    second.typeText(XCUIKeyboardKey.delete.rawValue)
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

    // The library, from the post's tools.
    let openLibrary = element(app, "open-library")
    scrollTo(app, openLibrary)
    openLibrary.tap()
    XCTAssertTrue(element(app, "library-panel").waitForExistence(timeout: 10), "the library didn't open")
    _ = element(app, "library-row").waitForExistence(timeout: 15)
    snapshot("composer-library")
    element(app, "library-close").tap()
    XCTAssertTrue(element(app, "library-panel").waitForNonExistence(timeout: 5))

    // A template with blanks: "/remind" opens the library on it, its
    // questions are answered, and its words go into the post.
    scrollTo(app, addPost)
    addPost.tap()
    let fourth = editor(app, 3)
    XCTAssertTrue(fourth.waitForExistence(timeout: 5))
    fourth.tap()
    fourth.typeText("/remind")
    let remind = element(app, "slash-template-remind")
    if remind.waitForExistence(timeout: 15) {
      remind.tap()
      let what = element(app, "template-question-0")
      XCTAssertTrue(what.waitForExistence(timeout: 15), "the library didn't ask the template's questions")
      what.tap()
      what.typeText("Seed swap")
      let saturday = app.buttons["Saturday"].firstMatch
      if saturday.waitForExistence(timeout: 3) { saturday.tap() }
      snapshot("composer-template-questions")
      element(app, "template-questions-use").tap()
      XCTAssertTrue(element(app, "library-panel").waitForNonExistence(timeout: 10))
      let filled = XCTNSPredicateExpectation(
        predicate: NSPredicate(format: "value CONTAINS %@", "Reminder: Seed swap is on Saturday."), object: fourth)
      XCTAssertEqual(XCTWaiter.wait(for: [filled], timeout: 10), .completed, "the template's words didn't go into the post")
      snapshot("composer-template-answered")
    }

    // Continue a thread: one of the account's own recent posts.
    if isDesk(app) || isPad {
      let more = app.buttons["More for this post"]
      scrollTo(app, more)
      more.tap()
      let item = app.buttons["Continue a thread"]
      XCTAssertTrue(item.waitForExistence(timeout: 5))
      item.tap()
    } else {
      let more = element(app, "option-more")
      scrollTo(app, more)
      more.tap()
      let item = element(app, "option-continue")
      scrollTo(app, item)
      item.tap()
    }
    XCTAssertTrue(text(app, containing: "Your post will reply to the one you pick").waitForExistence(timeout: 5))
    let pick = element(app, "continue-item")
    _ = pick.waitForExistence(timeout: 15)
    snapshot("composer-continue")
    if pick.exists {
      pick.tap()
      XCTAssertTrue(text(app, containing: "Continuing your thread").waitForExistence(timeout: 15))
      snapshot("composer-continue-reply")
    }

    // The Library page, through the command palette.
    element(app, "composer-close").tap()
    XCTAssertTrue(element(app, "composer-title").waitForNonExistence(timeout: 5))
    let search = element(app, "palette-open")
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    search.tap()
    let field = element(app, "palette-field")
    XCTAssertTrue(field.waitForExistence(timeout: 5), "the palette didn't open")
    field.typeText("Library")
    let option = element(app, "palette-go:/posting/library")
    XCTAssertTrue(option.waitForExistence(timeout: 5), "no Library in the palette")
    option.tap()
    XCTAssertTrue(element(app, "library-panel").waitForExistence(timeout: 15), "the Library page didn't open")
    _ = element(app, "library-row").waitForExistence(timeout: 15)
    snapshot("library-page")
  }
}
