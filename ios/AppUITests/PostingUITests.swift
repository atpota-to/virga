// Posting › Templates and Settings › Posting in demo mode. Neither waits
// for the archive, so no build: from the first build's page, the command
// palette goes to Templates (Mira's two, read from her repo), the editor
// opens on Event reminder, which asks two questions, its Use opens the
// composer on it (the questions in the library's dialog), and then
// Settings › Posting, from its top to the default timer. Each is kept as a
// screenshot, on the iPhone and the iPad.

import UIKit
import XCTest

final class PostingUITests: XCTestCase {
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

  /// A page through the command palette: Search, a few letters, its option.
  private func go(_ app: XCUIApplication, _ path: String, typing: String, title: String) {
    // A button, not the navigation bar's group of toolbar items, which on iOS 26
    // takes the first item's identifier and whose middle is the account button.
    let search = app.buttons.matching(identifier: "palette-open").firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 10), "no Search")
    // Straight after a sheet closes (the template editor), Search is in the
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

  func testTemplatesAndPostingSettings() {
    let app = launch()
    XCTAssertTrue(element(app, "first-run-title").waitForExistence(timeout: 15), "no first build's page")

    // Templates: Mira's, read from her repo.
    go(app, "/posting/templates", typing: "Templates", title: "Templates")
    XCTAssertTrue(element(app, "templates-list").waitForExistence(timeout: 15), "no templates listed")
    snapshot("posting-templates")

    // The editor, on the template that asks two questions.
    let name = app.descendants(matching: .any)
      .matching(NSPredicate(format: "identifier BEGINSWITH 'template-name-' AND label == %@", "Event reminder")).firstMatch
    XCTAssertTrue(name.waitForExistence(timeout: 5), "no Event reminder")
    name.tap()
    XCTAssertTrue(element(app, "template-editor").waitForExistence(timeout: 5), "the editor didn't open")
    snapshot("template-editor")
    let questions = element(app, "template-questions-editor")
    XCTAssertTrue(questions.waitForExistence(timeout: 5), "the editor shows no questions")
    var tries = 0
    while !questions.isHittable && tries < 4 {
      app.swipeUp()
      tries += 1
    }
    snapshot("template-editor-questions")
    element(app, "dialog-close").tap()
    XCTAssertTrue(element(app, "template-editor").waitForNonExistence(timeout: 5), "the editor stayed open")

    // Use: the composer opens with the template applied; this one asks its
    // two questions, in the library's dialog on it.
    let use = app.buttons["Use “Event reminder”"].firstMatch
    XCTAssertTrue(use.waitForExistence(timeout: 5), "no Use for Event reminder")
    use.tap()
    XCTAssertTrue(element(app, "composer-title").waitForExistence(timeout: 10), "Use didn't open the composer")
    XCTAssertTrue(element(app, "template-question-0").waitForExistence(timeout: 15), "Use didn't apply the template")
    snapshot("posting-template-use")
    element(app, "library-close").tap()
    XCTAssertTrue(element(app, "library-panel").waitForNonExistence(timeout: 5), "the library stayed open")
    element(app, "composer-close").tap()
    XCTAssertTrue(element(app, "composer-title").waitForNonExistence(timeout: 5), "the composer stayed open")

    // Settings › Posting, from the top to the default timer.
    go(app, "/settings/posting", typing: "Posting", title: "Posting")
    XCTAssertTrue(element(app, "posting-new-posts").waitForExistence(timeout: 10), "no New posts")
    snapshot("settings-posting")
    let timer = element(app, "posting-default-timer")
    tries = 0
    while !(timer.exists && timer.isHittable) && tries < 6 {
      app.swipeUp()
      tries += 1
    }
    snapshot("settings-posting-timer")
  }
}
