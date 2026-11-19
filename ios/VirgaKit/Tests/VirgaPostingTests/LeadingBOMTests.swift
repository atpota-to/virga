// A leading U+FEFF, step by step from a fixture to a regex match, so that a
// failure on iOS names the step that loses it. CI's first iOS run found
// findHashtags("\u{FEFF}#bom") one code unit short there, where Linux and
// the web agree; JSRegexSubject now builds the regex's NSString from the
// text's own code units. Every expectation here holds on Linux.

import Foundation
import Testing
import VirgaCore
@testable import VirgaPosting

@Suite struct LeadingBOMSurvives {
  let text = "\u{FEFF}#bom"

  @Test func aSwiftStringKeepsIt() {
    #expect(text.utf16.count == 5)
    #expect(text.utf16.first == 0xFEFF)
  }

  @Test func decodingJSONKeepsIt() throws {
    let raw = try JSONValue.parse(Data("[\"\u{FEFF}#bom\", \"\\ufeff#bom\"]".utf8))
    #expect(raw[0]?.stringValue?.utf16.count == 5, "raw U+FEFF inside a JSON string")
    #expect(raw[1]?.stringValue?.utf16.count == 5, "\\ufeff escape inside a JSON string")
  }

  @Test func foundationsStringsKeepIt() {
    #expect(NSString(string: text).length == 5, "NSString(string:)")
    let (subject, length) = JSRegexSubject.make(text)
    #expect(length == 5)
    #expect(subject.utf16.count == 5, "the regex subject")
  }

  @Test func theRegexSeesIt() throws {
    let regex = try NSRegularExpression(pattern: "^\\x{FEFF}#")
    let (subject, length) = JSRegexSubject.make(text)
    #expect(regex.firstMatch(in: subject, range: NSRange(location: 0, length: length)) != nil, "through JSRegexSubject")
  }

  @Test func findHashtagsCountsIt() {
    #expect(Hashtags.findHashtags(text) == [HashtagMatch(start: 1, end: 5, tag: "bom")])
  }
}
