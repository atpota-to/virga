// adviser/analysis.js and adviser/setup.js held to composer.adviser.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct AdviserParity {
  static let f = "composer.adviser"

  @Test func analysis() throws {
    for c in try cases(Self.f, "analysisConstants") {
      check(["ADVISER_CHECK_SCOPES": json(AdviserAnalysis.adviserCheckScopes)], c)
    }
    for c in try cases(Self.f, "normalizeAdviserScope") {
      check(.string(AdviserAnalysis.normalizeAdviserScope(c.input["scope"])), c)
    }
    for c in try cases(Self.f, "adviserScopeAllowsDraft") {
      check(
        .bool(
          AdviserAnalysis.adviserScopeAllowsDraft(
            c.input["scope"], repliesToOther: c.input["repliesToOther"]?.boolValue ?? false)), c)
    }
    for c in try cases(Self.f, "adviserScenarioFor") {
      check(
        .string(
          AdviserAnalysis.adviserScenarioFor(
            repliesToOther: c.input["repliesToOther"]?.boolValue ?? false,
            quotesOther: c.input["quotesOther"]?.boolValue ?? false,
            repliesToSelf: c.input["repliesToSelf"]?.boolValue ?? false,
            isThread: c.input["isThread"]?.boolValue ?? false)), c)
    }
    for c in try cases(Self.f, "enabledWritingChecks") {
      check(AdviserAnalysis.enabledWritingChecks(c.input["checks"]) ?? .null, c)
    }
    for c in try cases(Self.f, "fixableWritingIssues") {
      check(.array(AdviserAnalysis.fixableWritingIssues(c.input["issues"])), c)
    }
    for c in try cases(Self.f, "applyWritingFixes") {
      check(json(AdviserAnalysis.applyWritingFixes(c.input["text"], c.input["issues"])), c)
    }
    for c in try cases(Self.f, "applyWritingFixesToThread") {
      check(json(AdviserAnalysis.applyWritingFixesToThread(c.input["posts"], c.input["issues"])), c)
    }
  }

  @Test func setup() throws {
    for c in try cases(Self.f, "setupConstants") {
      check(
        [
          "REVIEW_MODES": json(AdviserSetup.reviewModes),
          "STYLE_SAMPLE_SIZES": json(AdviserSetup.styleSampleSizes),
          "DEFAULT_STYLE_SAMPLE_SIZE": .number(Double(AdviserSetup.defaultStyleSampleSize)),
          "ADVISER_TEXT_LIMITS": json(AdviserSetup.adviserTextLimits),
          "DEFAULT_ADVISER_SETTINGS": AdviserSetup.defaultAdviserSettings.json,
        ], c)
    }
    for c in try cases(Self.f, "normalizeStyleSampleSize") {
      check(.number(Double(AdviserSetup.normalizeStyleSampleSize(c.input["value"]))), c)
    }
    for c in try cases(Self.f, "normalizeAdviserSettings") {
      check(AdviserSetup.normalizeAdviserSettings(c.input["raw"]).json, c)
    }
    for c in try cases(Self.f, "isPostingAdviserPristine") {
      check(.bool(AdviserSetup.isPostingAdviserPristine(c.input["adviser"])), c)
    }
    for c in try cases(Self.f, "nextPostingAdviserState") {
      check(AdviserSetup.nextPostingAdviserState(c.input["adviser"]), c)
    }
  }
}
