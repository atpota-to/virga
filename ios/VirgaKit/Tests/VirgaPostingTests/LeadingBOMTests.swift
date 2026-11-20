// A leading U+FEFF, step by step from a fixture to a regex match. CI's iOS
// run found findHashtags("\u{FEFF}#bom") one code unit short, where Linux
// and the web agree, and these steps named the cause: Apple's
// NSString(string:) drops a leading U+FEFF. JSRegexSubject builds the
// regex's NSString from the text's own code units instead.

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
    // What CI's iOS run found: Apple's NSString(string:) drops a leading
    // U+FEFF, taking it for a byte order mark; Linux's Foundation keeps it.
    // That's why regexes run over JSRegexSubject and lengths come from
    // utf16. If Apple's behaviour changes, this says so.
    #if canImport(Darwin)
    #expect(NSString(string: text).length == 4, "Apple's NSString(string:) drops a leading U+FEFF")
    #else
    #expect(NSString(string: text).length == 5)
    #endif
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
