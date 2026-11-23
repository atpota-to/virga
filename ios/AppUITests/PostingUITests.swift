// Posting › Templates and Settings › Posting in demo mode. Neither waits
// for the archive, so no build: from the first build's page, the command
// palette goes to Templates (Mira's two, read from her repo), the editor
// opens on Event reminder, which asks two questions, its Use opens the
// composer on it (the questions in the library's dialog), and then
// Settings › Posting, from its top to the default timer and back up to its
// language field with a few letters typed, its suggestions clear of the
// keyboard, and the first one pressed (on the iPad then the keyboard's
// Escape, and ↓ and Return). Each is kept as a screenshot, on the iPhone
// and the iPad.

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
    // On a part's front page the phone's app bar is in the page and scrolls
    // away with it (as `.appbar` on the web): back to the top for Search,
    // until a swipe no longer moves it. Stopping as soon as it showed left
    // it 51 points short of the top in run 85, under the iPhone's status
    // bar, where both taps missed it.
    var swipes = 0
    var top = search.frame.minY
    repeat {
      app.swipeDown()
      swipes += 1
      let moved = search.frame.minY != top
      top = search.frame.minY
      if !moved, search.isHittable { break }
    } while swipes < 8
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
    // Straight after the editor's sheet closes, as in go(): wait until Use
    // can be pressed, and press once more if the composer isn't coming.
    let use = app.buttons["Use “Event reminder”"].firstMatch
    XCTAssertTrue(use.waitForExistence(timeout: 5), "no Use for Event reminder")
    let usable = expectation(for: NSPredicate(format: "isHittable == true"), evaluatedWith: use)
    wait(for: [usable], timeout: 10)
    use.tap()
    let composerTitle = element(app, "composer-title")
    if !composerTitle.waitForExistence(timeout: 3), use.isHittable { use.tap() }
    XCTAssertTrue(composerTitle.waitForExistence(timeout: 10), "Use didn't open the composer")
    XCTAssertTrue(element(app, "template-question-0").waitForExistence(timeout: 15), "Use didn't apply the template")
    snapshot("posting-template-use")
    // The library's dialog closes from its head's Close, the kit's dialog
    // head (Dialog.jsx's), as in ComposerUITests.
    element(app, "dialog-close").tap()
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

    // Back at the top, its language field with "fr" typed: the suggestions
    // float over the rows under it. On the iPhone the field is low in the
    // window, and the page brings the list into view over the keyboard by
    // itself. Reaching the field is guarded; once it has the keyboard, the
    // list must clear the keyboard and a press on its first suggestion,
    // outside the field's frame, must add that language.
    let languages = app.textFields["Languages"].firstMatch
    guard languages.waitForExistence(timeout: 5) else { return }
    var top = languages.frame.minY
    tries = 0
    repeat {
      app.swipeDown()
      tries += 1
      let moved = languages.frame.minY != top
      top = languages.frame.minY
      if !moved { break }
    } while tries < 8
    guard languages.isHittable else { return }
    let removes = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Remove '"))
    var chosen = labels(removes)
    languages.tap()
    let keyboard = app.keyboards.firstMatch
    guard keyboard.waitForExistence(timeout: 3) else { return }
    languages.typeText("fr")
    let suggestions = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'language-'"))
    XCTAssertTrue(suggestions.firstMatch.waitForExistence(timeout: 5), "no language suggestions for “fr”")
    // The list is brought up once the keyboard is: wait until its last row
    // is over the keyboard (or the keyboard has gone, as with a hardware one).
    let covered: () -> Bool = {
      let lowest = suggestions.allElementsBoundByIndex.map { $0.frame.maxY }.max()
      guard keyboard.exists, let lowest else { return false }
      return lowest > keyboard.frame.minY + 0.5
    }
    tries = 0
    while covered() && tries < 12 {
      Thread.sleep(forTimeInterval: 0.5)
      tries += 1
    }
    snapshot("settings-posting-languages")
    XCTAssertFalse(covered(), "the language suggestions stayed under the keyboard")
    // The first suggestion, by its place on screen.
    guard let first = suggestions.allElementsBoundByIndex.min(by: { $0.frame.minY < $1.frame.minY }) else { return }
    let firstLabel = first.label
    first.tap()
    XCTAssertTrue(
      newToken(removes, besides: chosen).map { firstLabel.hasPrefix($0) } ?? false,
      "a press on “\(firstLabel)” didn't add it")

    // On the iPad, a hardware keyboard's: with the list open again, Escape
    // puts it away, and ↓ then Return adds the second suggestion. (Mira
    // starts with English, so this is the third language, the most there
    // can be: Escape goes first.) The press on the field asks for the list
    // again (the box's press and KeyTextField's onPress, the web's
    // onClick), and the query changing opens it too, as typing does on the
    // web. The field is a KeyTextField, still app.textFields["Languages"]:
    // these keys reach the picker by the field's pressesBegan, its priority
    // key commands or, for Return, its delegate, whichever comes first.
    guard UIDevice.current.userInterfaceIdiom == .pad else { return }
    languages.tap()
    languages.typeText("e")
    guard suggestions.firstMatch.waitForExistence(timeout: 5) else {
      return XCTFail("no language suggestions for “e”")
    }
    app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
    XCTAssertTrue(suggestions.firstMatch.waitForNonExistence(timeout: 5), "Escape didn't put the language suggestions away")
    chosen = labels(removes)
    // The "e" taken out: the empty query's six suggestions, the list open again.
    app.typeKey(XCUIKeyboardKey.delete.rawValue, modifierFlags: [])
    guard suggestions.firstMatch.waitForExistence(timeout: 5) else {
      return XCTFail("the language suggestions didn't come back as the query emptied")
    }
    let rows = suggestions.allElementsBoundByIndex.sorted { $0.frame.minY < $1.frame.minY }
    guard rows.count >= 2 else {
      return XCTFail("fewer than two language suggestions for an empty query: \(rows.count)")
    }
    let secondLabel = rows[1].label
    app.typeKey(XCUIKeyboardKey.downArrow.rawValue, modifierFlags: [])
    app.typeKey(XCUIKeyboardKey.return.rawValue, modifierFlags: [])
    XCTAssertTrue(
      newToken(removes, besides: chosen).map { secondLabel.hasPrefix($0) } ?? false,
      "↓ and Return didn't add the second suggestion, “\(secondLabel)”")
  }

  private func labels(_ query: XCUIElementQuery) -> Set<String> {
    Set(query.allElementsBoundByIndex.map { $0.label })
  }

  /// The language a new token names, once one of `removes` (the tokens'
  /// "Remove <name>" buttons) has a label not in `besides`; nil if none
  /// comes within five seconds.
  private func newToken(_ removes: XCUIElementQuery, besides: Set<String>) -> String? {
    for _ in 0..<10 {
      if let label = labels(removes).first(where: { !besides.contains($0) }) {
        return String(label.dropFirst("Remove ".count))
      }
      Thread.sleep(forTimeInterval: 0.5)
    }
    return nil
  }
}
