// composer/{editing,highlight,threadEdits,media,languages}.js held to
// composer.editor: the editor's text edits and highlight runs, thread
// splitting and its undo, sorting files, and the language picker.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct ComposerEditorParity {
  static let f = "composer.editor"

  @Test func editing() throws {
    for c in try cases(Self.f, "editingConstants") {
      check(["NEAR_LIMIT_LEFT": .number(Double(ComposerEditing.nearLimitLeft))], c)
    }
    for c in try cases(Self.f, "replaceRange") {
      check(json(ComposerEditing.replaceRange(c.input["text"], c.input["start"], c.input["end"], c.input["insertion"])), c)
    }
    for c in try cases(Self.f, "insertMention") {
      check(json(ComposerEditing.insertMention(c.input["text"], c.input["range"], c.input["handle"])), c)
    }
    for c in try cases(Self.f, "pasteAsInlineLink") {
      check(
        json(ComposerEditing.pasteAsInlineLink(c.input["text"], c.input["start"], c.input["end"], c.input["pasted"])),
        c)
    }
    for c in try cases(Self.f, "misleadingLinkNotes") {
      check(json(ComposerEditing.misleadingLinkNotes(c.input["text"])), c)
    }
    for c in try cases(Self.f, "removeLinkFromText") {
      check(
        .string(
          ComposerEditing.removeLinkFromText(
            c.input["text"], charStart: c.input["charStart"], charEnd: c.input["charEnd"], expect: c.input["expect"])),
        c)
    }
    for c in try cases(Self.f, "limitAnnouncement") {
      let count = c.input["count"]?.doubleValue ?? 0
      let text =
        c.input["max"].map { ComposerEditing.limitAnnouncement(count, max: $0.doubleValue ?? 0) }
        ?? ComposerEditing.limitAnnouncement(count)
      check(.string(text), c)
    }
  }

  @Test func highlight() throws {
    for c in try cases(Self.f, "facetRanges") {
      check(json(Highlight.facetRanges(c.input["text"], c.input["facets"])), c)
    }
    for c in try cases(Self.f, "highlightSegments") {
      check(
        json(Highlight.highlightSegments(c.input["text"], c.input["facets"] ?? .array([]), c.input["links"] ?? .array([]))),
        c)
    }
  }

  static func numbering(_ c: ParityCase) -> ThreadNumbering {
    c.input["numbering"]?.stringValue.flatMap(ThreadNumbering.init(rawValue:)) ?? .off
  }

  @Test func threadEdits() throws {
    for c in try cases(Self.f, "splitTexts") {
      check(json(ThreadEdits.splitTexts(c.input["posts"], c.input["id"], numbering: Self.numbering(c))), c)
    }
    for c in try cases(Self.f, "planSplit") {
      checkCanon(json(ThreadEdits.planSplit(c.input["posts"], c.input["id"], numbering: Self.numbering(c))), c)
    }
    for c in try cases(Self.f, "planRenumber") {
      checkCanon(json(ThreadEdits.planRenumber(c.input["posts"])), c)
    }
    for c in try cases(Self.f, "undoStands") {
      check(.bool(ThreadEdits.undoStands(c.input["posts"], c.input["undo"])), c)
    }
    for c in try cases(Self.f, "undoAction") {
      check(json(ThreadEdits.undoAction(c.input["undo"])), c)
    }
    for c in try cases(Self.f, "undoLine") {
      check(.string(ThreadEdits.undoLine(c.input["undo"])), c)
    }
  }

  @Test func media() throws {
    for c in try cases(Self.f, "mediaConstants") {
      check(["IMAGE_INPUT_ACCEPT": .string(ComposerMedia.imageInputAccept)], c)
    }
    for c in try cases(Self.f, "sortIncomingFiles") {
      check(
        json(
          ComposerMedia.sortIncomingFiles(
            c.input["files"]?.arrayValue, imageCount: c.input["imageCount"]?.intValue ?? 0,
            hasVideo: c.input["hasVideo"]?.boolValue ?? false, allowVideo: c.input["allowVideo"]?.boolValue ?? true)),
        c)
    }
    // The clipboard's items as the pasteboard's (the web's DataTransfer), at
    // the generator's fixed time.
    let pasteNow = Date(timeIntervalSince1970: 1_794_477_600.25)
    for c in try cases(Self.f, "pastedImageFiles") {
      let items = c.input["items"]?.arrayValue.map { list in
        list.map { item in
          PastedItem(
            kind: item["kind"]?.stringValue ?? "", type: item["type"]?.stringValue ?? "",
            file: ComposerFile(json: item["file"]))
        }
      }
      let files = ComposerMedia.pastedImageFiles(
        c.id.hasSuffix("no-clipboard") ? nil : items ?? nil, text: c.input["text"]?.stringValue, now: { pasteNow })
      check(.array(files.map(\.json)), c)
    }
    for c in try cases(Self.f, "formatDuration") {
      check(.string(ComposerMedia.formatDuration(c.input["seconds"])), c)
    }
    for c in try cases(Self.f, "missingAltCount") {
      check(.number(Double(ComposerMedia.missingAltCount(c.input["post"]))), c)
    }
  }

  @Test func languages() throws {
    for c in try cases(Self.f, "languageConstants") {
      check(
        [
          "LANGUAGE_CODES": .array(ComposerLanguages.languageCodes.map(JSONValue.string)),
          "ADULT_LABEL_OPTIONS": json(ComposerLanguages.adultLabelOptions),
          "GRAPHIC_LABEL": json(ComposerLanguages.graphicLabel),
        ], c)
    }
    for c in try cases(Self.f, "languageName") {
      check(.string(ComposerLanguages.languageName(c.input["code"], locale: c.string("locale") ?? "en")), c)
    }
    for c in try cases(Self.f, "searchLanguages") {
      check(
        json(
          ComposerLanguages.searchLanguages(
            c.input["query"], chosen: c.strings("chosen"), preferred: c.strings("preferred"),
            limit: c.input["limit"]?.intValue ?? 8)), c)
    }
    for c in try cases(Self.f, "langsSummary") {
      check(.string(ComposerLanguages.langsSummary(c.input["langs"]?.arrayValue)), c)
    }
    for c in try cases(Self.f, "labelsSummary") {
      check(.string(ComposerLanguages.labelsSummary(c.input["labels"]?.arrayValue)), c)
    }
  }
}
