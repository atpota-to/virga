// The composer, in demo mode (it needs no built archive): opened from New
// post, empty; with words in it (a mention and a tag highlighted); a
// thread of three; two pictures (pasted, as the simulator's photo library
// may be empty); the "/" templates; a link card read from the demo's card
// service; the language picker; the post-as picker;
// the library from the composer; a template with blanks answered through
// its questions into the post; the thread saved as a draft and opened
// again; the thread posted (its progress and its toast); Continue a thread
// listing it, and a reply to it sent; and the Library page. On a phone,
// the bar at the top with the keyboard up. Each is kept as a screenshot
// (an XCTAttachment kept always), on the iPhone and the iPad, all in one
// launch; the demo's server takes the writes (records, blobs, drafts).

import UIKit
import XCTest

final class ComposerUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

  /// The app in demo mode, with the typing probe on (TypingProbe: a hidden
  /// record of what reached each text field, read when a field doesn't hold
  /// what was typed).
  private func launch(_ extra: [String] = []) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += ["-VirgaDemo", "YES", "-VirgaDemoFlags", "latency=0", "-VirgaTypingProbe", "YES"] + extra
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
  /// (a paste the writer asked for, so the system doesn't ask first). The
  /// press is at the end of the words, at the right of their last line's
  /// foot, so the caret lands after them and not in the mention, and it is
  /// made again (three presses at most) when no Paste comes up, as none did
  /// on run 82's iPhone.
  private func pastePicture(_ app: XCUIApplication, into field: XCUIElement, hue: CGFloat) -> Bool {
    let size = CGSize(width: 640, height: 480)
    let picture = UIGraphicsImageRenderer(size: size).image { context in
      UIColor(hue: hue, saturation: 0.45, brightness: 0.85, alpha: 1).setFill()
      context.fill(CGRect(origin: .zero, size: size))
      UIColor.white.withAlphaComponent(0.6).setFill()
      context.fill(CGRect(x: 80, y: 300, width: 480, height: 120))
    }
    UIPasteboard.general.image = picture
    let paste = app.menuItems["Paste"]
    for _ in 0..<3 {
      field.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 1)).withOffset(CGVector(dx: 0, dy: -4)).press(forDuration: 1.2)
      if paste.waitForExistence(timeout: 4) {
        paste.tap()
        return true
      }
    }
    return false
  }

  /// `words` typed into a post's field, and the field read back. Now and
  /// then a keystroke is lost on the way in ("@lab.example.or" in runs 82
  /// and 84), which the editor's own fix is for, so it isn't typed again
  /// here: a field that doesn't hold what was typed is written to the log
  /// and kept as an activity in the results, and the test carries on. The
  /// field's curly apostrophe for a straight one is its own, not a lost key.
  /// `start` is what the field holds, when the caller knows (one read
  /// fewer). The probe's record of the field is written after a mismatch
  /// (VIRGA-TYPED-TRACE). True when the field holds what was typed.
  @discardableResult
  private func enter(_ words: String, into field: XCUIElement, start: String? = nil) -> Bool {
    let before = start ?? (field.value as? String ?? "")
    field.typeText(words)
    let expected = before + words
    let got = field.value as? String ?? ""
    let straight = { (text: String) in text.replacingOccurrences(of: "\u{2019}", with: "'") }
    guard straight(got) != straight(expected) else { return true }
    let line = "VIRGA-TYPED-MISMATCH expected=\(expected.debugDescription) got=\(got.debugDescription)"
    print(line)
    XCTContext.runActivity(named: line) { _ in }
    let name = field.identifier
    print("VIRGA-TYPED-TRACE field=\(name) \(jsonLine(probeRecord(of: name)))")
    return false
  }

  /// The typing probe's record of one field (TypingProbe.report), or nil.
  private func probeRecord(of identifier: String, in app: XCUIApplication = XCUIApplication()) -> [String: Any]? {
    let probe = element(app, "typing-probe")
    guard probe.exists, let json = probe.value as? String, let data = json.data(using: .utf8),
      let all = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return nil }
    return all[identifier] as? [String: Any]
  }

  private func jsonLine(_ object: Any?) -> String {
    guard let object, JSONSerialization.isValidJSONObject(object),
      let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
    else { return "unavailable" }
    return String(decoding: data, as: UTF8.self)
  }

  func testTheComposer() {
    let app = launch()
    openComposer(app)
    snapshot("composer-empty")

    // Words, with a mention and a tag highlighted (and the typeahead).
    let first = editor(app, 0)
    XCTAssertTrue(first.waitForExistence(timeout: 5))
    first.tap()
    enter("Seed swap at the community garden this Saturday with @lab.example.org #gardening ", into: first)
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
    enter("/", into: second)
    if element(app, "slash-templates").waitForExistence(timeout: 10) {
      sleep(1)
      snapshot("composer-slash")
    }
    second.typeText(XCUIKeyboardKey.delete.rawValue)
    enter("Bring seeds in labelled envelopes; we'll have spares.", into: second)
    scrollTo(app, addPost)
    addPost.tap()
    let third = editor(app, 2)
    XCTAssertTrue(third.waitForExistence(timeout: 5))
    third.tap()
    enter("Directions: https://example.com/garden-notes ", into: third)
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
    // The list is a popover, closed by a press outside it: just under the
    // list, placed by its frame. Not low down on "PopoverDismissRegion": the
    // keyboard, still up for the last post, covers the region's foot and
    // takes the press there (run 74, iPhone), and on an iPad the composer's
    // own sheet brings two dimming views by that name too (run 74, iPad).
    let list = element(app, "post-as-list")
    list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 1)).withOffset(CGVector(dx: 0, dy: 40)).tap()
    XCTAssertTrue(list.waitForNonExistence(timeout: 5), "the accounts' list stayed open")

    // The library, from the post's tools.
    let openLibrary = element(app, "open-library")
    scrollTo(app, openLibrary)
    openLibrary.tap()
    XCTAssertTrue(element(app, "library-panel").waitForExistence(timeout: 10), "the library didn't open")
    _ = element(app, "library-row").waitForExistence(timeout: 15)
    snapshot("composer-library")
    element(app, "dialog-close").tap()
    XCTAssertTrue(element(app, "library-panel").waitForNonExistence(timeout: 5))

    // A template with blanks: "/remind" opens the library on it, its
    // questions are answered, and its words go into the post.
    scrollTo(app, addPost)
    addPost.tap()
    let fourth = editor(app, 3)
    XCTAssertTrue(fourth.waitForExistence(timeout: 5))
    fourth.tap()
    enter("/remind", into: fourth)
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

    // Save as draft: the thread goes to the account's Bluesky drafts; closed
    // and opened again, the composer has it back as the draft.
    let saveDraft = element(app, "save-draft")
    XCTAssertTrue(saveDraft.waitForExistence(timeout: 5), "no Save as draft")
    saveDraft.tap()
    // Its toast is the window's, as on the web: on an iPad it sits at the
    // window's corner beside the composer's sheet, which can keep it from
    // the test; the composer's title says Draft as the toast comes up.
    let saved = app.descendants(matching: .any).matching(
      NSPredicate(format: "label CONTAINS %@ OR (identifier == 'composer-title' AND label == 'Draft')", "Draft saved to")
    ).firstMatch
    XCTAssertTrue(saved.waitForExistence(timeout: 20), "the draft wasn't saved")
    snapshot("composer-draft-saved")
    element(app, "composer-close").tap()
    XCTAssertTrue(element(app, "composer-title").waitForNonExistence(timeout: 5))
    openComposer(app)
    let draftTitle = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'composer-title' AND label == 'Draft'")).firstMatch
    XCTAssertTrue(draftTitle.waitForExistence(timeout: 10), "the draft didn't come back")
    snapshot("composer-draft-reopened")

    // Post the thread: the toast, and the composer closes. The toast lasts
    // 4.2 seconds and the demo posts at once, so it is looked for straight
    // after the press: in run 100's iPad a wait for the composer's progress
    // (which never showed) and one slow query took ten seconds, the toast
    // came and went in them, and the test missed a thread that had gone out
    // (its shot shows the toast). The composer closes only once the thread
    // has gone out, so a closed composer is the proof when the toast was
    // missed; one that stays open fails the test either way.
    let publish = element(app, "publish")
    XCTAssertTrue(publish.waitForExistence(timeout: 5))
    publish.tap()
    let posted = text(app, containing: "Posted as")
    let sawToast = posted.waitForExistence(timeout: 30)
    snapshot("composer-thread-posted")
    XCTAssertTrue(element(app, "composer-title").waitForNonExistence(timeout: 30), "the thread didn't go out: the composer stayed open")
    if !sawToast { print("VIRGA-NOTE the \"Posted as\" toast was gone before the test looked; the composer closed") }
    openComposer(app)

    // Continue a thread: one of the account's own recent posts, the new
    // thread among them.
    if isDesk(app) || isPad {
      let more = app.buttons["More for this post"]
      scrollTo(app, more)
      more.tap()
      // The menu's item, by its identifier or its title (a native menu item
      // may read its hint after the title).
      let item = app.buttons.matching(
        NSPredicate(format: "identifier == 'more-continue' OR label BEGINSWITH %@", "Continue a thread")
      ).firstMatch
      XCTAssertTrue(item.waitForExistence(timeout: 5), "no Continue a thread in More")
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
      // A single post (the reply) sent.
      let reply = editor(app, 0)
      reply.tap()
      enter("Spares went fast. Thanks, all!", into: reply)
      element(app, "publish").tap()
      XCTAssertTrue(text(app, containing: "Posted as").waitForExistence(timeout: 30), "the reply didn't go out")
      snapshot("composer-post-posted")
      XCTAssertTrue(element(app, "composer-title").waitForNonExistence(timeout: 10))
    }

    // The Library page, through the command palette.
    if element(app, "composer-title").exists {
      element(app, "composer-close").tap()
      XCTAssertTrue(element(app, "composer-title").waitForNonExistence(timeout: 5))
    }
    // A button, not the navigation bar's group of toolbar items, which on iOS 26
    // takes the first item's identifier and whose middle is the account button.
    let paletteButton = app.buttons.matching(identifier: "palette-open").firstMatch
    XCTAssertTrue(paletteButton.waitForExistence(timeout: 5))
    paletteButton.tap()
    let field = element(app, "palette-field")
    XCTAssertTrue(field.waitForExistence(timeout: 5), "the palette didn't open")
    field.typeText("Library")
    let option = element(app, "palette-go:/posting/library")
    XCTAssertTrue(option.waitForExistence(timeout: 5), "no Library in the palette")
    option.tap()
    XCTAssertTrue(element(app, "library-panel").waitForExistence(timeout: 15), "the Library page didn't open")
    _ = element(app, "library-row").waitForExistence(timeout: 15)
    snapshot("library-page")

    // Your posts: the thread's first post shows the first picture pasted
    // into it, which the demo gives back as a data: address. The thumbnail
    // is hidden from VoiceOver, so only the shot shows it.
    let yourPosts = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Your posts")).firstMatch
    if yourPosts.waitForExistence(timeout: 5) {
      yourPosts.tap()
      if element(app, "library-row").waitForExistence(timeout: 15) {
        sleep(1)
        snapshot("library-your-posts")
      }
    }
  }

}
