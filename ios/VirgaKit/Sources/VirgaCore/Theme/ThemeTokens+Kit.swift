// Ports src/styles/theme.css
// Ports src/styles/base.css
// Ports src/styles/controls.css
// Ports src/styles/app.css
//
// Written by ios/scripts/generate-theme-tokens.mjs from the stylesheets;
// don't edit it by hand. ui.themeKit holds it to the
// stylesheets, one declaration each (ios/parity/cases/_themeKit.js lists
// them).

import Foundation

/// The kit's own measures, beside the tokens: the sizes, weights, durations
/// and the few colours the stylesheets give the controls, each one
/// declaration of one rule (its doc comment says which). Values that say
/// var() are filled in by the theme in force: `theme.points(of:)`,
/// `theme.color(of:)`, `theme.resolve(_:)`. ios/DESIGN.md says what each
/// control is for.
public enum ThemeKit {
  /// base.css `body` { font-size: var(--text-base) }
  public static let bodyFontSize: ThemeValue = .variable(.textBase)
  /// base.css `body` { line-height: 1.45 }
  public static let bodyLineHeight: Double = 1.45
  /// base.css `body` { font-family: var(--sans) }
  public static let bodyFont: ThemeValue = .variable(.sans)
  /// base.css `body` { font-variant-numeric: tabular-nums }
  public static let bodyNumerals: String = "tabular-nums"
  /// base.css `body` { background-image: linear-gradient(180deg, var(--sky-top) 0, var(--sky-mid) var(--sky-mid-at), var(--bg) var(--sky-end)) }
  public static let skyWash: ThemeGradient = ThemeGradient(angle: 180, stops: [ThemeGradientStop(color: .variable(.skyTop), position: .px(0)), ThemeGradientStop(color: .variable(.skyMid), position: .variable(.skyMidAt)), ThemeGradientStop(color: .variable(.bg), position: .variable(.skyEnd))])
  /// base.css `h1` { font-weight: 600 }
  public static let headingWeight: Double = 600
  /// base.css `h1` { letter-spacing: -0.012em }
  public static let headingTracking: ThemeLength = .em(-0.012)
  /// base.css `h1` { line-height: 1.25 }
  public static let headingLineHeight: Double = 1.25
  /// base.css `strong` { font-weight: 600 }
  public static let strongWeight: Double = 600
  /// base.css `a` { text-underline-offset: 0.2em }
  public static let linkUnderlineOffset: ThemeLength = .em(0.2)
  /// base.css `a` { text-decoration-thickness: 1px }
  public static let linkUnderlineThickness: ThemeLength = .px(1)
  /// base.css @media (hover: hover) `a:hover` { text-decoration-thickness: 2px }
  public static let linkHoverUnderlineThickness: ThemeLength = .px(2)
  /// base.css `code` { font-family: var(--code) }
  public static let codeFont: ThemeValue = .variable(.code)
  /// base.css `code` { font-size: 0.92em }
  public static let codeFontSize: ThemeLength = .em(0.92)
  /// base.css `:focus-visible` { outline: 2px solid var(--focus-ring) }
  public static let focusOutline: ThemeBorder = ThemeBorder(width: .px(2), style: "solid", color: .variable(.focusRing))
  /// base.css `:focus-visible` { outline-offset: 2px }
  public static let focusOutlineOffset: ThemeLength = .px(2)
  /// base.css `::selection` { background: var(--accent-line) }
  public static let selectionFill: ThemeValue = .variable(.accentLine)
  /// base.css `::selection` { color: var(--ink) }
  public static let selectionInk: ThemeValue = .variable(.ink)
  /// base.css @media (prefers-reduced-motion: reduce) `*` { transition-duration: 0.01ms !important }
  public static let reducedMotionDuration: Double = 0.00001
  /// controls.css `.btn` { min-height: var(--control-h) }
  public static let buttonHeight: ThemeLength = .variable(.controlH)
  /// controls.css `.btn` { padding: 0 16px }
  public static let buttonPadding: ThemeBox = ThemeBox(top: .px(0), right: .px(16), bottom: .px(0), left: .px(16))
  /// controls.css `.btn` { gap: 8px }
  public static let buttonGap: ThemeLength = .px(8)
  /// controls.css `.btn` { border: 1px solid var(--line-2) }
  public static let buttonBorder: ThemeBorder = ThemeBorder(width: .px(1), style: "solid", color: .variable(.line2))
  /// controls.css `.btn` { border-radius: var(--pill) }
  public static let buttonRadius: ThemeLength = .variable(.pill)
  /// controls.css `.btn` { font-size: 0.875rem }
  public static let buttonFontSize: ThemeLength = .rem(0.875)
  /// controls.css `.btn` { font-weight: 500 }
  public static let buttonWeight: Double = 500
  /// controls.css `.btn` { color: var(--ink) }
  public static let buttonInk: ThemeValue = .variable(.ink)
  /// controls.css `.btn` { transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease }
  public static let buttonTransition: [ThemeTransition] = [ThemeTransition(property: "background-color", duration: 0.12, easing: .keyword("ease"), delay: 0), ThemeTransition(property: "border-color", duration: 0.12, easing: .keyword("ease"), delay: 0), ThemeTransition(property: "color", duration: 0.12, easing: .keyword("ease"), delay: 0)]
  /// controls.css @media (hover: hover) `.btn:hover:not(:disabled)` { border-color: var(--ink) }
  public static let buttonHoverEdge: ThemeValue = .variable(.ink)
  /// controls.css `.btn--primary` { background: var(--btn) }
  public static let primaryButtonFill: ThemeValue = .variable(.btn)
  /// controls.css `.btn--primary` { color: var(--on-btn) }
  public static let primaryButtonInk: ThemeValue = .variable(.onBtn)
  /// controls.css `.btn--primary` { font-weight: 600 }
  public static let primaryButtonWeight: Double = 600
  /// controls.css @media (hover: hover) `.btn--primary:hover:not(:disabled)` { background: var(--btn-hover) }
  public static let primaryButtonHoverFill: ThemeValue = .variable(.btnHover)
  /// controls.css `.btn--danger` { background: var(--danger) }
  public static let dangerButtonFill: ThemeValue = .variable(.danger)
  /// controls.css `.btn--danger` { color: #ffffff }
  public static let dangerButtonInk: ThemeValue = .color(.hex(0xffffff))
  /// controls.css @media (hover: hover) `.btn--danger:hover:not(:disabled)` { background: var(--danger-hover) }
  public static let dangerButtonHoverFill: ThemeValue = .variable(.dangerHover)
  /// controls.css `:root[data-theme='dark'] .btn--danger` { background: #b42318 }
  public static let dangerButtonFillAtNight: ThemeValue = .color(.hex(0xb42318))
  /// controls.css @media (hover: hover) `:root[data-theme='dark'] .btn--danger:hover:not(:disabled)` { background: #912018 }
  public static let dangerButtonHoverFillAtNight: ThemeValue = .color(.hex(0x912018))
  /// controls.css `.btn--ghost` { color: var(--ink-2) }
  public static let ghostButtonInk: ThemeValue = .variable(.ink2)
  /// controls.css @media (hover: hover) `.btn--ghost:hover:not(:disabled)` { background: var(--hover) }
  public static let ghostButtonHoverFill: ThemeValue = .variable(.hover)
  /// controls.css `.btn--sm` { min-height: 30px }
  public static let smallButtonHeight: ThemeLength = .px(30)
  /// controls.css `.btn--sm` { padding: 0 12px }
  public static let smallButtonPadding: ThemeBox = ThemeBox(top: .px(0), right: .px(12), bottom: .px(0), left: .px(12))
  /// controls.css `.btn--sm` { gap: 6px }
  public static let smallButtonGap: ThemeLength = .px(6)
  /// controls.css `.btn--sm` { font-size: var(--text-sm) }
  public static let smallButtonFontSize: ThemeValue = .variable(.textSm)
  /// controls.css `.btn--lg` { min-height: 46px }
  public static let largeButtonHeight: ThemeLength = .px(46)
  /// controls.css `.btn--lg` { padding: 0 22px }
  public static let largeButtonPadding: ThemeBox = ThemeBox(top: .px(0), right: .px(22), bottom: .px(0), left: .px(22))
  /// controls.css `.btn--lg` { font-size: var(--text-md) }
  public static let largeButtonFontSize: ThemeValue = .variable(.textMd)
  /// controls.css `.btn--icon` { width: var(--control-h) }
  public static let iconButtonWidth: ThemeLength = .variable(.controlH)
  /// controls.css `.btn--icon.btn--sm` { width: 30px }
  public static let smallIconButtonWidth: ThemeLength = .px(30)
  /// controls.css `.btn--icon.btn--lg` { width: 46px }
  public static let largeIconButtonWidth: ThemeLength = .px(46)
  /// controls.css `.btn.is-on` { color: var(--muted) }
  public static let stateButtonInk: ThemeValue = .variable(.muted)
  /// controls.css `.btn:disabled` { opacity: 0.45 }
  public static let disabledOpacity: Double = 0.45
  /// controls.css `.btn.is-danger` { color: var(--danger) }
  public static let destructiveButtonInk: ThemeValue = .variable(.danger)
  /// controls.css `.link-action` { font-size: var(--text-sm) }
  public static let linkActionFontSize: ThemeValue = .variable(.textSm)
  /// controls.css `.link-action` { font-weight: 500 }
  public static let linkActionWeight: Double = 500
  /// controls.css `.link-action` { gap: 6px }
  public static let linkActionGap: ThemeLength = .px(6)
  /// controls.css `.link-action` { text-underline-offset: 3px }
  public static let linkActionUnderlineOffset: ThemeLength = .px(3)
  /// controls.css `.link-action svg` { width: 14px }
  public static let linkActionIconSize: ThemeLength = .px(14)
  /// controls.css `.link-action[aria-expanded='true']` { font-weight: 600 }
  public static let linkActionOpenWeight: Double = 600
  /// controls.css `.more-link` { font-size: var(--text-sm) }
  public static let moreLinkFontSize: ThemeValue = .variable(.textSm)
  /// controls.css `.more-link` { color: var(--muted) }
  public static let moreLinkInk: ThemeValue = .variable(.muted)
  /// controls.css `.more-link` { font-weight: 400 }
  public static let moreLinkWeight: Double = 400
  /// controls.css `.segmented` { gap: 18px }
  public static let segmentedGap: ThemeLength = .px(18)
  /// controls.css `.segmented-key` { min-height: var(--control-h) }
  public static let segmentedKeyHeight: ThemeLength = .variable(.controlH)
  /// controls.css `.segmented-key` { font-size: var(--text-base) }
  public static let segmentedKeyFontSize: ThemeValue = .variable(.textBase)
  /// controls.css `.segmented-key` { font-weight: 400 }
  public static let segmentedKeyWeight: Double = 400
  /// controls.css `.segmented-key` { color: var(--muted) }
  public static let segmentedKeyInk: ThemeValue = .variable(.muted)
  /// controls.css `.segmented-key` { transition: color 0.12s ease }
  public static let segmentedKeyTransition: [ThemeTransition] = [ThemeTransition(property: "color", duration: 0.12, easing: .keyword("ease"), delay: 0)]
  /// controls.css `.segmented-key.is-on` { color: var(--ink) }
  public static let segmentedOnInk: ThemeValue = .variable(.ink)
  /// controls.css `.segmented-key.is-on` { font-weight: 600 }
  public static let segmentedOnWeight: Double = 600
  /// controls.css `.segmented-key.is-on` { box-shadow: inset 0 -2px 0 var(--ink) }
  public static let segmentedOnUnderline: [ThemeShadowLayer] = [ThemeShadowLayer(inset: true, x: .px(0), y: .px(-2), blur: .px(0), color: .variable(.ink))]
  /// controls.css `.segmented-icon` { width: 15px }
  public static let segmentedIconSize: ThemeLength = .px(15)
  /// controls.css `.segmented--sm` { gap: 16px }
  public static let smallSegmentedGap: ThemeLength = .px(16)
  /// controls.css `.segmented--sm .segmented-key` { min-height: 28px }
  public static let smallSegmentedKeyHeight: ThemeLength = .px(28)
  /// controls.css `.segmented--sm .segmented-key` { font-size: var(--text-sm) }
  public static let smallSegmentedKeyFontSize: ThemeValue = .variable(.textSm)
  /// controls.css `.scroll-row[data-overflow='both']` { mask-image: linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent) }
  public static let scrollFadeWidth: ThemeGradient = ThemeGradient(angle: 90, stops: [ThemeGradientStop(color: .color(.rgb(0, 0, 0, 0)), position: nil), ThemeGradientStop(color: .color(.hex(0x000000)), position: .px(24)), ThemeGradientStop(color: .color(.hex(0x000000)), position: .function(.calc, [.operation(.subtract, .value(100, .percent), .px(24))])), ThemeGradientStop(color: .color(.rgb(0, 0, 0, 0)), position: nil)])
  /// controls.css `.card-head` { gap: var(--space-2) var(--space-4) }
  public static let cardHeadGap: ThemeGap = ThemeGap(row: .variable(.space2), column: .variable(.space4))
  /// controls.css `.card-head` { margin-bottom: var(--space-4) }
  public static let cardHeadSpaceBelow: ThemeLength = .variable(.space4)
  /// controls.css `.card-title` { font-size: var(--text-md) }
  public static let cardTitleFontSize: ThemeValue = .variable(.textMd)
  /// controls.css `.card-title` { font-weight: 600 }
  public static let cardTitleWeight: Double = 600
  /// controls.css `.card-title` { letter-spacing: -0.005em }
  public static let cardTitleTracking: ThemeLength = .em(-0.005)
  /// controls.css `.card-sub` { font-size: var(--text-sm) }
  public static let cardSubFontSize: ThemeValue = .variable(.textSm)
  /// controls.css `.card-sub` { color: var(--muted) }
  public static let cardSubInk: ThemeValue = .variable(.muted)
  /// controls.css `.card-sub` { margin-top: 2px }
  public static let cardSubSpaceAbove: ThemeLength = .px(2)
  /// controls.css `.card-sub` { max-width: var(--measure) }
  public static let cardSubMaxWidth: ThemeLength = .variable(.measure)
  /// controls.css `.card-caption` { margin-top: var(--space-3) }
  public static let cardCaptionSpaceAbove: ThemeLength = .variable(.space3)
  /// controls.css `.card--flush > .card-head` { padding-bottom: var(--space-3) }
  public static let flushHeadSpaceBelow: ThemeLength = .variable(.space3)
  /// controls.css `.card--flush > .card-head` { border-bottom: 1px solid var(--rule) }
  public static let flushHeadRule: ThemeBorder = ThemeBorder(width: .px(1), style: "solid", color: .variable(.rule))
  /// controls.css `.card-foot` { margin-top: var(--space-3) }
  public static let cardFootSpaceAbove: ThemeLength = .variable(.space3)
  /// controls.css `.head-actions` { gap: 8px 24px }
  public static let headActionsGap: ThemeGap = ThemeGap(row: .px(8), column: .px(24))
  /// controls.css `.head-tools` { gap: 4px }
  public static let headToolsGap: ThemeLength = .px(4)
  /// controls.css `.list-toolbar` { gap: 12px 32px }
  public static let listToolbarGap: ThemeGap = ThemeGap(row: .px(12), column: .px(32))
  /// controls.css `.list-toolbar` { margin-bottom: var(--space-4) }
  public static let listToolbarSpaceBelow: ThemeLength = .variable(.space4)
  /// controls.css @media (max-width: 560px) `.list-toolbar` { gap: 12px 16px }
  public static let phoneListToolbarGap: ThemeGap = ThemeGap(row: .px(12), column: .px(16))
  /// controls.css `.row-actions` { gap: 8px }
  public static let rowActionsGap: ThemeLength = .px(8)
  /// controls.css `.chart-foot` { gap: 8px 24px }
  public static let chartFootGap: ThemeGap = ThemeGap(row: .px(8), column: .px(24))
  /// controls.css `.chart-foot` { margin-top: var(--space-3) }
  public static let chartFootSpaceAbove: ThemeLength = .variable(.space3)
  /// controls.css `.figures` { gap: 20px var(--space-6) }
  public static let figuresGap: ThemeGap = ThemeGap(row: .px(20), column: .variable(.space6))
  /// controls.css `.figures-cell` { gap: 8px }
  public static let figureCellGap: ThemeLength = .px(8)
  /// controls.css `.figures-cell` { padding: 16px 0 0 }
  public static let figureCellPadding: ThemeBox = ThemeBox(top: .px(16), right: .px(0), bottom: .px(0), left: .px(0))
  /// controls.css `.figures-cell` { border-top: 2px solid var(--line) }
  public static let figureCellRule: ThemeBorder = ThemeBorder(width: .px(2), style: "solid", color: .variable(.line))
  /// controls.css `.figures-label` { font-size: var(--text-sm) }
  public static let figureLabelFontSize: ThemeValue = .variable(.textSm)
  /// controls.css `.figures-label` { font-weight: 500 }
  public static let figureLabelWeight: Double = 500
  /// controls.css `.figures-label` { color: var(--ink-2) }
  public static let figureLabelInk: ThemeValue = .variable(.ink2)
  /// controls.css `.figures-value` { font-size: var(--figure-size) }
  public static let figureValueFontSize: ThemeValue = .variable(.figureSize)
  /// controls.css `.figures-value` { font-weight: 500 }
  public static let figureValueWeight: Double = 500
  /// controls.css `.figures-value` { letter-spacing: -0.04em }
  public static let figureValueTracking: ThemeLength = .em(-0.04)
  /// controls.css `.figures-value` { line-height: 1 }
  public static let figureValueLineHeight: Double = 1
  /// controls.css `.figures-note` { font-size: var(--text-sm) }
  public static let figureNoteFontSize: ThemeValue = .variable(.textSm)
  /// controls.css `.figures-note` { line-height: 1.35 }
  public static let figureNoteLineHeight: Double = 1.35
  /// controls.css @media (max-width: 560px) `.figures` { column-gap: 20px }
  public static let phoneFiguresColumnGap: ThemeLength = .px(20)
  /// controls.css @media (max-width: 560px) `.figures-cell` { padding: 12px 0 0 }
  public static let phoneFigureCellPadding: ThemeBox = ThemeBox(top: .px(12), right: .px(0), bottom: .px(0), left: .px(0))
  /// controls.css `.delta` { font-size: var(--text-sm) }
  public static let deltaFontSize: ThemeValue = .variable(.textSm)
  /// controls.css `.delta` { font-weight: 600 }
  public static let deltaWeight: Double = 600
  /// controls.css `.menu-list` { min-width: 13rem }
  public static let menuListMinWidth: ThemeLength = .rem(13)
  /// controls.css `.menu-list` { padding: 6px }
  public static let menuListPadding: ThemeBox = ThemeBox(top: .px(6), right: .px(6), bottom: .px(6), left: .px(6))
  /// controls.css `.menu-list` { border-radius: var(--radius-lg) }
  public static let menuListRadius: ThemeLength = .variable(.radiusLg)
  /// controls.css `.menu-list` { border: 1px solid var(--line) }
  public static let menuListEdge: ThemeBorder = ThemeBorder(width: .px(1), style: "solid", color: .variable(.line))
  /// controls.css `.menu-list` { background: var(--surface) }
  public static let menuListFill: ThemeValue = .variable(.surface)
  /// controls.css `.menu-list` { box-shadow: var(--shadow-lg) }
  public static let menuListShadow: ThemeValue = .variable(.shadowLg)
  /// controls.css `.menu-item` { padding: 8px 10px }
  public static let menuItemPadding: ThemeBox = ThemeBox(top: .px(8), right: .px(10), bottom: .px(8), left: .px(10))
  /// controls.css `.menu-item` { gap: 10px }
  public static let menuItemGap: ThemeLength = .px(10)
  /// controls.css `.menu-item` { border-radius: var(--radius) }
  public static let menuItemRadius: ThemeLength = .variable(.radius)
  /// controls.css @media (hover: hover) `.menu-item:hover` { background: var(--hover) }
  public static let menuItemHoverFill: ThemeValue = .variable(.hover)
  /// controls.css `.menu-item[data-tone='danger']` { color: var(--danger) }
  public static let menuItemDangerInk: ThemeValue = .variable(.danger)
  /// controls.css `.menu-item-icon` { width: 16px }
  public static let menuItemIconSize: ThemeLength = .px(16)
  /// controls.css `.menu-item-label` { font-weight: 500 }
  public static let menuItemLabelWeight: Double = 500
  /// controls.css `.menu-item-hint` { line-height: 1.35 }
  public static let menuItemHintLineHeight: Double = 1.35
  /// controls.css `.menu-list.menu-list--sheet` { border-radius: 16px 16px 0 0 }
  public static let menuSheetRadius: ThemeBox = ThemeBox(top: .px(16), right: .px(16), bottom: .px(0), left: .px(0))
  /// controls.css `.menu-scrim` { background: var(--scrim) }
  public static let menuScrimFill: ThemeValue = .variable(.scrim)
  /// controls.css @media (prefers-reduced-motion: no-preference) `.menu-scrim` { animation: menu-scrim-in 0.16s var(--ease) }
  public static let menuScrimAnimation: ThemeAnimation = ThemeAnimation(name: "menu-scrim-in", duration: 0.16, easing: .variable(.ease), delay: 0, iterations: 1, infinite: false, fill: "none")
  /// controls.css @media (prefers-reduced-motion: no-preference) `.menu-list--sheet` { animation: menu-sheet-in 0.2s var(--ease) }
  public static let menuSheetAnimation: ThemeAnimation = ThemeAnimation(name: "menu-sheet-in", duration: 0.2, easing: .variable(.ease), delay: 0, iterations: 1, infinite: false, fill: "none")
  /// controls.css `.field` { gap: 6px }
  public static let fieldGap: ThemeLength = .px(6)
  /// controls.css `.field-label` { font-size: var(--text-sm) }
  public static let fieldLabelFontSize: ThemeValue = .variable(.textSm)
  /// controls.css `.field-label` { font-weight: 600 }
  public static let fieldLabelWeight: Double = 600
  /// controls.css `.input` { min-height: var(--control-h) }
  public static let inputHeight: ThemeLength = .variable(.controlH)
  /// controls.css `.input` { padding: 0 12px }
  public static let inputPadding: ThemeBox = ThemeBox(top: .px(0), right: .px(12), bottom: .px(0), left: .px(12))
  /// controls.css `.input` { border: 1px solid var(--line-2) }
  public static let inputBorder: ThemeBorder = ThemeBorder(width: .px(1), style: "solid", color: .variable(.line2))
  /// controls.css `.input` { border-radius: var(--radius) }
  public static let inputRadius: ThemeLength = .variable(.radius)
  /// controls.css `.input` { background: color-mix(in srgb, var(--surface) 72%, transparent) }
  public static let inputFill: ThemeValue = .colorMix(ThemeColorMix(first: .variable(.surface), firstPercent: 72, second: .color(.rgb(0, 0, 0, 0)), secondPercent: nil))
  /// controls.css `.input` { transition: border-color 0.12s ease, box-shadow 0.12s ease }
  public static let inputTransition: [ThemeTransition] = [ThemeTransition(property: "border-color", duration: 0.12, easing: .keyword("ease"), delay: 0), ThemeTransition(property: "box-shadow", duration: 0.12, easing: .keyword("ease"), delay: 0)]
  /// controls.css `.input::placeholder` { color: var(--muted) }
  public static let inputPlaceholderInk: ThemeValue = .variable(.muted)
  /// controls.css `.input[aria-invalid='true']` { --focus-ring: var(--danger) }
  public static let invalidFocusRing: ThemeValue = .variable(.danger)
  /// controls.css `.input[aria-invalid='true']` { --focus: 0 0 0 1px var(--focus-ring), 0 0 0 4px color-mix(in srgb, var(--focus-ring) 32%, transparent) }
  public static let invalidFocus: ThemeValue = .shadow([ThemeShadowLayer(x: .px(0), y: .px(0), blur: .px(0), spread: .px(1), color: .variable(.focusRing)), ThemeShadowLayer(x: .px(0), y: .px(0), blur: .px(0), spread: .px(4), color: .colorMix(ThemeColorMix(first: .variable(.focusRing), firstPercent: 32, second: .color(.rgb(0, 0, 0, 0)), secondPercent: nil)))])
  /// controls.css `.input[aria-invalid='true']` { border-color: var(--danger) }
  public static let invalidEdge: ThemeValue = .variable(.danger)
  /// controls.css `:root[data-contrast='high'] .input[aria-invalid='true']` { --focus: 0 0 0 2px var(--surface), 0 0 0 5px var(--focus-ring) }
  public static let highContrastInvalidFocus: ThemeValue = .shadow([ThemeShadowLayer(x: .px(0), y: .px(0), blur: .px(0), spread: .px(2), color: .variable(.surface)), ThemeShadowLayer(x: .px(0), y: .px(0), blur: .px(0), spread: .px(5), color: .variable(.focusRing))])
  /// controls.css `.input--lg` { min-height: 46px }
  public static let largeInputHeight: ThemeLength = .px(46)
  /// controls.css `.input--lg` { padding: 0 16px }
  public static let largeInputPadding: ThemeBox = ThemeBox(top: .px(0), right: .px(16), bottom: .px(0), left: .px(16))
  /// controls.css `textarea.input` { min-height: calc(var(--control-h) * 2.5) }
  public static let textAreaMinHeight: ThemeLength = .function(.calc, [.operation(.multiply, .variable(.controlH), .number(2.5))])
  /// controls.css `textarea.input` { padding: 9px 12px }
  public static let textAreaPadding: ThemeBox = ThemeBox(top: .px(9), right: .px(12), bottom: .px(9), left: .px(12))
  /// controls.css `textarea.input` { line-height: 1.5 }
  public static let textAreaLineHeight: Double = 1.5
  /// controls.css `.input:disabled` { background: var(--surface-2) }
  public static let disabledInputFill: ThemeValue = .variable(.surface2)
  /// controls.css `.field-hint.is-over` { color: var(--danger) }
  public static let overLimitInk: ThemeValue = .variable(.danger)
  /// controls.css `.check` { gap: 8px }
  public static let checkGap: ThemeLength = .px(8)
  /// controls.css `input[type='checkbox']` { width: 16px }
  public static let checkboxSize: ThemeLength = .px(16)
  /// controls.css `.search > svg` { left: 12px }
  public static let searchIconInset: ThemeLength = .px(12)
  /// controls.css `.search > .input` { padding-left: 36px }
  public static let searchInputLeading: ThemeLength = .px(36)
  /// controls.css `.switch` { width: 40px }
  public static let switchWidth: ThemeLength = .px(40)
  /// controls.css `.switch` { height: 24px }
  public static let switchHeight: ThemeLength = .px(24)
  /// controls.css `.switch` { padding: 2px }
  public static let switchPadding: ThemeBox = ThemeBox(top: .px(2), right: .px(2), bottom: .px(2), left: .px(2))
  /// controls.css `.switch` { background: var(--line-2) }
  public static let switchOffFill: ThemeValue = .variable(.line2)
  /// controls.css `.switch` { transition: background-color 0.15s ease }
  public static let switchTransition: [ThemeTransition] = [ThemeTransition(property: "background-color", duration: 0.15, easing: .keyword("ease"), delay: 0)]
  /// controls.css `.switch::after` { width: 20px }
  public static let switchKnobSize: ThemeLength = .px(20)
  /// controls.css `.switch::after` { background: #ffffff }
  public static let switchKnobFill: ThemeValue = .color(.hex(0xffffff))
  /// controls.css `.switch::after` { box-shadow: 0 1px 2px rgb(15 27 51 / 0.3) }
  public static let switchKnobShadow: [ThemeShadowLayer] = [ThemeShadowLayer(x: .px(0), y: .px(1), blur: .px(2), color: .color(.rgb(15, 27, 51, 0.3)))]
  /// controls.css `.switch::after` { transition: transform 0.15s var(--ease), background-color 0.15s ease }
  public static let switchKnobTransition: [ThemeTransition] = [ThemeTransition(property: "transform", duration: 0.15, easing: .variable(.ease), delay: 0), ThemeTransition(property: "background-color", duration: 0.15, easing: .keyword("ease"), delay: 0)]
  /// controls.css `.switch[aria-checked='true']` { background: var(--accent) }
  public static let switchOnFill: ThemeValue = .variable(.accent)
  /// controls.css `.switch[aria-checked='true']::after` { background: var(--on-accent) }
  public static let switchOnKnobFill: ThemeValue = .variable(.onAccent)
  /// controls.css `.switch:disabled` { opacity: 0.5 }
  public static let switchDisabledOpacity: Double = 0.5
  /// controls.css `.badge` { font-size: var(--text-xs) }
  public static let badgeFontSize: ThemeValue = .variable(.textXs)
  /// controls.css `.badge` { line-height: 20px }
  public static let badgeLineHeight: ThemeLength = .px(20)
  /// controls.css `.badge` { padding: 0 7px }
  public static let badgePadding: ThemeBox = ThemeBox(top: .px(0), right: .px(7), bottom: .px(0), left: .px(7))
  /// controls.css `.badge` { font-weight: 500 }
  public static let badgeWeight: Double = 500
  /// controls.css `.badge` { gap: 5px }
  public static let badgeGap: ThemeLength = .px(5)
  /// controls.css `.badge svg` { width: 12px }
  public static let badgeIconSize: ThemeLength = .px(12)
  /// controls.css `.badge--warn` { background: var(--warn-wash) }
  public static let warnBadgeFill: ThemeValue = .variable(.warnWash)
  /// controls.css `.badge--warn` { color: var(--warn) }
  public static let warnBadgeInk: ThemeValue = .variable(.warn)
  /// controls.css `.badge--danger` { background: var(--danger-wash) }
  public static let dangerBadgeFill: ThemeValue = .variable(.dangerWash)
  /// controls.css `.badge--danger` { color: var(--danger) }
  public static let dangerBadgeInk: ThemeValue = .variable(.danger)
  /// controls.css `.meta` { font-size: var(--text-sm) }
  public static let metaFontSize: ThemeValue = .variable(.textSm)
  /// controls.css `.meta` { color: var(--muted) }
  public static let metaInk: ThemeValue = .variable(.muted)
  /// controls.css `.meta` { line-height: 1.45 }
  public static let metaLineHeight: Double = 1.45
  /// controls.css `.meta > *` { gap: 5px }
  public static let metaItemGap: ThemeLength = .px(5)
  /// controls.css `.meta > :not(:last-child)::after` { margin: 0 6px 0 1px }
  public static let metaDotMargin: ThemeBox = ThemeBox(top: .px(0), right: .px(6), bottom: .px(0), left: .px(1))
  /// controls.css `.meta svg` { width: 13px }
  public static let metaIconSize: ThemeLength = .px(13)
  /// controls.css `.meta > .meta-group` { gap: 12px }
  public static let metaGroupGap: ThemeLength = .px(12)
  /// controls.css `.meta .is-key` { color: var(--ink-2) }
  public static let metaKeyInk: ThemeValue = .variable(.ink2)
  /// controls.css `.meta .is-key` { font-weight: 500 }
  public static let metaKeyWeight: Double = 500
  /// controls.css `.chip` { min-height: 30px }
  public static let chipHeight: ThemeLength = .px(30)
  /// controls.css `.chip` { padding: 0 13px }
  public static let chipPadding: ThemeBox = ThemeBox(top: .px(0), right: .px(13), bottom: .px(0), left: .px(13))
  /// controls.css `.chip` { font-size: var(--text-sm) }
  public static let chipFontSize: ThemeValue = .variable(.textSm)
  /// controls.css `.chip` { font-weight: 500 }
  public static let chipWeight: Double = 500
  /// controls.css `.chip` { border: 1px solid var(--line-2) }
  public static let chipBorder: ThemeBorder = ThemeBorder(width: .px(1), style: "solid", color: .variable(.line2))
  /// controls.css `.chip` { color: var(--ink-2) }
  public static let chipInk: ThemeValue = .variable(.ink2)
  /// controls.css `.chip[aria-pressed='true']` { background: var(--btn) }
  public static let chipOnFill: ThemeValue = .variable(.btn)
  /// controls.css `.chip[aria-pressed='true']` { color: var(--on-btn) }
  public static let chipOnInk: ThemeValue = .variable(.onBtn)
  /// controls.css `.chip[aria-pressed='true']` { font-weight: 600 }
  public static let chipOnWeight: Double = 600
  /// controls.css `.token` { min-height: 30px }
  public static let tokenHeight: ThemeLength = .px(30)
  /// controls.css `.token` { padding: 0 4px 0 12px }
  public static let tokenPadding: ThemeBox = ThemeBox(top: .px(0), right: .px(4), bottom: .px(0), left: .px(12))
  /// controls.css `.token` { gap: 4px }
  public static let tokenGap: ThemeLength = .px(4)
  /// controls.css `.token-remove` { width: 24px }
  public static let tokenRemoveSize: ThemeLength = .px(24)
  /// controls.css `.token-remove svg` { width: 14px }
  public static let tokenRemoveIconSize: ThemeLength = .px(14)
  /// controls.css `.tokens` { gap: 8px }
  public static let tokensGap: ThemeLength = .px(8)
  /// controls.css `.avatar` { width: 34px }
  public static let avatarSize: ThemeLength = .px(34)
  /// controls.css `.avatar` { font-size: var(--text-sm) }
  public static let avatarFontSize: ThemeValue = .variable(.textSm)
  /// controls.css `.avatar` { font-weight: 600 }
  public static let avatarWeight: Double = 600
  /// controls.css `.avatar--sm` { width: 24px }
  public static let smallAvatarSize: ThemeLength = .px(24)
  /// controls.css `.avatar--sm` { font-size: 11px }
  public static let smallAvatarFontSize: ThemeLength = .px(11)
  /// controls.css `.avatar--lg` { width: 44px }
  public static let largeAvatarSize: ThemeLength = .px(44)
  /// controls.css `.avatar--lg` { font-size: var(--text-md) }
  public static let largeAvatarFontSize: ThemeValue = .variable(.textMd)
  /// controls.css `.dot` { width: 7px }
  public static let dotSize: ThemeLength = .px(7)
  /// controls.css `.dot` { background: var(--ok) }
  public static let dotFill: ThemeValue = .variable(.ok)
  /// controls.css `.dot--warn` { background: var(--warn) }
  public static let warnDotFill: ThemeValue = .variable(.warn)
  /// controls.css `.dot--danger` { background: var(--danger) }
  public static let dangerDotFill: ThemeValue = .variable(.danger)
  /// controls.css `.dot--idle` { background: var(--faint) }
  public static let idleDotFill: ThemeValue = .variable(.faint)
  /// controls.css `.dot--current` { background: var(--accent) }
  public static let currentDotFill: ThemeValue = .variable(.accent)
  /// controls.css `.table td` { padding: var(--row-pad) 12px }
  public static let tableCellPadding: ThemeBox = ThemeBox(top: .variable(.rowPad), right: .px(12), bottom: .variable(.rowPad), left: .px(12))
  /// controls.css `.table td` { border-bottom: 1px solid var(--line) }
  public static let tableRowRule: ThemeBorder = ThemeBorder(width: .px(1), style: "solid", color: .variable(.line))
  /// controls.css `.table thead th` { padding-bottom: 10px }
  public static let tableHeadSpaceBelow: ThemeLength = .px(10)
  /// controls.css `.table thead th` { border-bottom: 1px solid var(--rule) }
  public static let tableHeadRule: ThemeBorder = ThemeBorder(width: .px(1), style: "solid", color: .variable(.rule))
  /// controls.css `.table thead th` { font-size: var(--text-sm) }
  public static let tableHeadFontSize: ThemeValue = .variable(.textSm)
  /// controls.css `.table thead th` { font-weight: 500 }
  public static let tableHeadWeight: Double = 500
  /// controls.css `.table tr.is-selected` { background: var(--accent-tint) }
  public static let selectedRowFill: ThemeValue = .variable(.accentTint)
  /// controls.css `.empty` { padding: var(--space-5) 0 }
  public static let emptyPadding: ThemeBox = ThemeBox(top: .variable(.space5), right: .px(0), bottom: .variable(.space5), left: .px(0))
  /// controls.css `.empty-block` { gap: 12px }
  public static let emptyBlockGap: ThemeLength = .px(12)
  /// controls.css `.note` { font-size: var(--text-sm) }
  public static let noteFontSize: ThemeValue = .variable(.textSm)
  /// controls.css `.note` { max-width: var(--measure) }
  public static let noteMaxWidth: ThemeLength = .variable(.measure)
  /// controls.css `.callout` { padding: 2px 0 2px 14px }
  public static let calloutPadding: ThemeBox = ThemeBox(top: .px(2), right: .px(0), bottom: .px(2), left: .px(14))
  /// controls.css `.callout` { border-left: 2px solid var(--line-2) }
  public static let calloutEdge: ThemeBorder = ThemeBorder(width: .px(2), style: "solid", color: .variable(.line2))
  /// controls.css `.callout` { gap: 10px }
  public static let calloutGap: ThemeLength = .px(10)
  /// controls.css `.callout` { color: var(--ink-2) }
  public static let calloutInk: ThemeValue = .variable(.ink2)
  /// controls.css `.callout--warn` { padding: 12px 14px }
  public static let warnCalloutPadding: ThemeBox = ThemeBox(top: .px(12), right: .px(14), bottom: .px(12), left: .px(14))
  /// controls.css `.callout--warn` { background: var(--warn-wash) }
  public static let warnCalloutFill: ThemeValue = .variable(.warnWash)
  /// controls.css `.callout--warn` { border-left-color: var(--warn) }
  public static let warnCalloutEdge: ThemeValue = .variable(.warn)
  /// controls.css `.callout--danger` { background: var(--danger-wash) }
  public static let dangerCalloutFill: ThemeValue = .variable(.dangerWash)
  /// controls.css `.callout--danger` { border-left-color: var(--danger) }
  public static let dangerCalloutEdge: ThemeValue = .variable(.danger)
  /// controls.css `.disclosure > summary::before` { transition: transform 0.15s ease }
  public static let disclosureTransition: [ThemeTransition] = [ThemeTransition(property: "transform", duration: 0.15, easing: .keyword("ease"), delay: 0)]
  /// controls.css `.progress` { height: 3px }
  public static let progressHeight: ThemeLength = .px(3)
  /// controls.css `.progress` { background: var(--line) }
  public static let progressTrack: ThemeValue = .variable(.line)
  /// controls.css `.progress-fill` { background: var(--accent) }
  public static let progressFill: ThemeValue = .variable(.accent)
  /// controls.css `.progress-fill` { transition: width 0.3s ease }
  public static let progressTransition: [ThemeTransition] = [ThemeTransition(property: "width", duration: 0.3, easing: .keyword("ease"), delay: 0)]
  /// controls.css `.progress-fill[data-indeterminate]` { width: 35% }
  public static let progressIndeterminateWidth: ThemeLength = .value(35, .percent)
  /// controls.css `.progress-fill[data-indeterminate]` { animation: progress-slide 1.2s ease-in-out infinite }
  public static let progressIndeterminateAnimation: ThemeAnimation = ThemeAnimation(name: "progress-slide", duration: 1.2, easing: .keyword("ease-in-out"), delay: 0, iterations: 1, infinite: true, fill: "none")
  /// controls.css `.info-tip-button` { width: 20px }
  public static let infoTipButtonSize: ThemeLength = .px(20)
  /// controls.css `.info-tip-pop` { width: min(280px, calc(100vw - 32px)) }
  public static let infoTipWidth: ThemeLength = .function(.min, [.px(280), .function(.calc, [.operation(.subtract, .value(100, .vw), .px(32))])])
  /// controls.css `.info-tip-pop` { padding: 9px 12px }
  public static let infoTipPadding: ThemeBox = ThemeBox(top: .px(9), right: .px(12), bottom: .px(9), left: .px(12))
  /// controls.css `.info-tip-pop` { border-radius: var(--radius) }
  public static let infoTipRadius: ThemeLength = .variable(.radius)
  /// controls.css `.info-tip-pop` { background: var(--btn) }
  public static let infoTipFill: ThemeValue = .variable(.btn)
  /// controls.css `.info-tip-pop` { color: var(--on-btn) }
  public static let infoTipInk: ThemeValue = .variable(.onBtn)
  /// controls.css @media (pointer: coarse) `.btn` { min-height: 40px }
  public static let touchButtonHeight: ThemeLength = .px(40)
  /// controls.css @media (pointer: coarse) `.btn--lg` { min-height: 46px }
  public static let touchLargeButtonHeight: ThemeLength = .px(46)
  /// controls.css @media (pointer: coarse) `.btn--icon` { width: 40px }
  public static let touchIconButtonWidth: ThemeLength = .px(40)
  /// controls.css @media (pointer: coarse) `.btn--sm` { min-height: 32px }
  public static let touchSmallButtonHeight: ThemeLength = .px(32)
  /// controls.css @media (pointer: coarse) `.btn--icon.btn--sm` { width: 32px }
  public static let touchSmallIconButtonWidth: ThemeLength = .px(32)
  /// controls.css @media (pointer: coarse) `.btn--ghost.btn--icon` { width: 44px }
  public static let touchGhostIconButtonSize: ThemeLength = .px(44)
  /// controls.css @media (pointer: coarse) `.chip` { min-height: 40px }
  public static let touchChipHeight: ThemeLength = .px(40)
  /// controls.css @media (pointer: coarse) `.input` { min-height: 40px }
  public static let touchInputHeight: ThemeLength = .px(40)
  /// controls.css @media (pointer: coarse) `.input` { font-size: 16px }
  public static let touchInputFontSize: ThemeLength = .px(16)
  /// controls.css @media (pointer: coarse) `.token` { min-height: 32px }
  public static let touchTokenHeight: ThemeLength = .px(32)
  /// controls.css @media (pointer: coarse) `.tokens` { row-gap: 12px }
  public static let touchTokensRowGap: ThemeLength = .px(12)
  /// controls.css @media (pointer: coarse) `.segmented` { gap: 22px }
  public static let touchSegmentedGap: ThemeLength = .px(22)
  /// controls.css @media (pointer: coarse) `.segmented-key` { min-height: 44px }
  public static let touchSegmentedKeyHeight: ThemeLength = .px(44)
  /// controls.css @media (pointer: coarse) `.menu-item` { min-height: 44px }
  public static let touchMenuItemHeight: ThemeLength = .px(44)
  /// controls.css @media (pointer: coarse) `.chart-foot .link-action` { min-height: 44px }
  public static let touchChartFootActionHeight: ThemeLength = .px(44)
  /// controls.css @media (pointer: coarse) `.info-tip-button` { width: 32px }
  public static let touchInfoTipButtonSize: ThemeLength = .px(32)
  /// theme.css `:root[data-contrast='high'] :focus-visible` { outline-width: 3px }
  public static let highContrastFocusOutlineWidth: ThemeLength = .px(3)
  /// theme.css `:root[data-contrast='high'] .segmented .segmented-key.is-on` { box-shadow: inset 0 -3px 0 var(--ink) }
  public static let highContrastSegmentedOnUnderline: [ThemeShadowLayer] = [ThemeShadowLayer(inset: true, x: .px(0), y: .px(-3), blur: .px(0), color: .variable(.ink))]
  /// theme.css `:root[data-contrast='high'] .switch` { box-shadow: inset 0 0 0 2px var(--muted) }
  public static let highContrastSwitchEdge: [ThemeShadowLayer] = [ThemeShadowLayer(inset: true, x: .px(0), y: .px(0), blur: .px(0), spread: .px(2), color: .variable(.muted))]
  /// theme.css `:root[data-contrast='high'] .switch` { background: transparent }
  public static let highContrastSwitchFill: ThemeValue = .color(.rgb(0, 0, 0, 0))
  /// theme.css `:root[data-contrast='high'] .switch::after` { background: var(--muted) }
  public static let highContrastSwitchKnobFill: ThemeValue = .variable(.muted)
  /// theme.css `:root[data-contrast='high'] .heatmap-cell:not(.is-best):not([data-empty])` { box-shadow: inset 0 0 0 1px var(--line-soft) }
  public static let highContrastHeatCellEdge: [ThemeShadowLayer] = [ThemeShadowLayer(inset: true, x: .px(0), y: .px(0), blur: .px(0), spread: .px(1), color: .variable(.lineSoft))]
  /// theme.css `:root[data-contrast='high'] .barlist-track` { box-shadow: inset 0 0 0 1px var(--line-soft) }
  public static let highContrastBarTrackEdge: [ThemeShadowLayer] = [ThemeShadowLayer(inset: true, x: .px(0), y: .px(0), blur: .px(0), spread: .px(1), color: .variable(.lineSoft))]
  /// theme.css `:root[data-contrast='high'] .nav-link[aria-current='page']` { text-decoration-thickness: 2px }
  public static let highContrastCurrentUnderlineThickness: ThemeLength = .px(2)
  /// theme.css `:root[data-contrast='high'] .nav-link[aria-current='page']` { text-underline-offset: 4px }
  public static let highContrastCurrentUnderlineOffset: ThemeLength = .px(4)
  /// theme.css @media (max-width: 374px) `:root[data-contrast='high'] .tabbar-item[aria-current='page']` { box-shadow: inset 0 0 0 2px var(--ink) }
  public static let highContrastCurrentTabRing: [ThemeShadowLayer] = [ThemeShadowLayer(inset: true, x: .px(0), y: .px(0), blur: .px(0), spread: .px(2), color: .variable(.ink))]
  /// theme.css `:root[data-theme='dark'] .image-tool` { color: #ffffff }
  public static let imageLabelInkAtNight: ThemeValue = .color(.hex(0xffffff))
  /// app.css `.landing` { --landing-max: 1160px }
  public static let landingMaxWidth: ThemeValue = .length(.px(1160))
  /// app.css `.landing-bar` { min-height: 44px }
  public static let landingBarHeight: ThemeLength = .px(44)
  /// app.css `.landing-bar` { padding-top: 28px }
  public static let landingBarSpaceAbove: ThemeLength = .px(28)
  /// app.css @media (max-width: 899px) `.landing-bar` { padding-top: 12px }
  public static let phoneLandingBarSpaceAbove: ThemeLength = .px(12)
  /// app.css `.landing-main` { padding-top: clamp(32px, 7svh, 72px) }
  public static let landingMainSpaceAbove: ThemeLength = .function(.clamp, [.px(32), .value(7, .svh), .px(72)])
  /// app.css `.landing-eyebrow` { font-size: var(--text-sm) }
  public static let landingEyebrowFontSize: ThemeValue = .variable(.textSm)
  /// app.css `.landing-eyebrow` { font-weight: 500 }
  public static let landingEyebrowWeight: Double = 500
  /// app.css `.landing-title` { font-size: clamp(2.5rem, 1.35rem + 4vw, 4.5rem) }
  public static let landingTitleFontSize: ThemeLength = .function(.clamp, [.rem(2.5), .operation(.add, .rem(1.35), .value(4, .vw)), .rem(4.5)])
  /// app.css `.landing-title` { font-weight: 600 }
  public static let landingTitleWeight: Double = 600
  /// app.css `.landing-title` { letter-spacing: -0.04em }
  public static let landingTitleTracking: ThemeLength = .em(-0.04)
  /// app.css `.landing-title` { line-height: 1.02 }
  public static let landingTitleLineHeight: Double = 1.02
  /// app.css `.landing-lede` { font-size: var(--text-lg) }
  public static let landingLedeFontSize: ThemeValue = .variable(.textLg)
  /// app.css `.landing-lede` { line-height: 1.5 }
  public static let landingLedeLineHeight: Double = 1.5
  /// app.css `.landing-lede` { max-width: 52ch }
  public static let landingLedeMaxWidth: ThemeLength = .value(52, .ch)
  /// app.css `.landing-points > div` { border-top: 1px solid var(--rule) }
  public static let landingPointRule: ThemeBorder = ThemeBorder(width: .px(1), style: "solid", color: .variable(.rule))
  /// app.css `.landing-points > div` { padding-top: 18px }
  public static let landingPointSpaceAbove: ThemeLength = .px(18)
  /// app.css `.return-title` { font-size: var(--text-title) }
  public static let returnTitleFontSize: ThemeValue = .variable(.textTitle)
  /// app.css `.return-title` { letter-spacing: -0.025em }
  public static let returnTitleTracking: ThemeLength = .em(-0.025)
  /// app.css `.return-title` { line-height: 1.1 }
  public static let returnTitleLineHeight: Double = 1.1
  /// app.css `.app-status` { font-size: var(--text-lg) }
  public static let appStatusFontSize: ThemeValue = .variable(.textLg)
  /// app.css `.app-status` { animation: app-status-in 0.4s ease 0.5s both }
  public static let appStatusAnimation: ThemeAnimation = ThemeAnimation(name: "app-status-in", duration: 0.4, easing: .keyword("ease"), delay: 0.5, iterations: 1, infinite: false, fill: "both")
  /// app.css `.sketch-figure` { border-top: 2px solid var(--line) }
  public static let sketchFigureRule: ThemeBorder = ThemeBorder(width: .px(2), style: "solid", color: .variable(.line))

  /// Every measure above, with the declaration it comes from.
  public static let entries: [ThemeKitEntry] = [
    ThemeKitEntry("bodyFontSize", file: "src/styles/base.css", selector: "body", property: "font-size", kind: "value", css: "var(--text-base)", value: .value(bodyFontSize)),
    ThemeKitEntry("bodyLineHeight", file: "src/styles/base.css", selector: "body", property: "line-height", kind: "number", css: "1.45", value: .number(bodyLineHeight)),
    ThemeKitEntry("bodyFont", file: "src/styles/base.css", selector: "body", property: "font-family", kind: "value", css: "var(--sans)", value: .value(bodyFont)),
    ThemeKitEntry("bodyNumerals", file: "src/styles/base.css", selector: "body", property: "font-variant-numeric", kind: "keyword", css: "tabular-nums", value: .keyword(bodyNumerals)),
    ThemeKitEntry("skyWash", file: "src/styles/base.css", selector: "body", property: "background-image", kind: "gradient", css: "linear-gradient(180deg, var(--sky-top) 0, var(--sky-mid) var(--sky-mid-at), var(--bg) var(--sky-end))", value: .gradient(skyWash)),
    ThemeKitEntry("headingWeight", file: "src/styles/base.css", selector: "h1", property: "font-weight", kind: "number", css: "600", value: .number(headingWeight)),
    ThemeKitEntry("headingTracking", file: "src/styles/base.css", selector: "h1", property: "letter-spacing", kind: "length", css: "-0.012em", value: .length(headingTracking)),
    ThemeKitEntry("headingLineHeight", file: "src/styles/base.css", selector: "h1", property: "line-height", kind: "number", css: "1.25", value: .number(headingLineHeight)),
    ThemeKitEntry("strongWeight", file: "src/styles/base.css", selector: "strong", property: "font-weight", kind: "number", css: "600", value: .number(strongWeight)),
    ThemeKitEntry("linkUnderlineOffset", file: "src/styles/base.css", selector: "a", property: "text-underline-offset", kind: "length", css: "0.2em", value: .length(linkUnderlineOffset)),
    ThemeKitEntry("linkUnderlineThickness", file: "src/styles/base.css", selector: "a", property: "text-decoration-thickness", kind: "length", css: "1px", value: .length(linkUnderlineThickness)),
    ThemeKitEntry("linkHoverUnderlineThickness", file: "src/styles/base.css", selector: "a:hover", media: "(hover: hover)", property: "text-decoration-thickness", kind: "length", css: "2px", value: .length(linkHoverUnderlineThickness)),
    ThemeKitEntry("codeFont", file: "src/styles/base.css", selector: "code", property: "font-family", kind: "value", css: "var(--code)", value: .value(codeFont)),
    ThemeKitEntry("codeFontSize", file: "src/styles/base.css", selector: "code", property: "font-size", kind: "length", css: "0.92em", value: .length(codeFontSize)),
    ThemeKitEntry("focusOutline", file: "src/styles/base.css", selector: ":focus-visible", property: "outline", kind: "border", css: "2px solid var(--focus-ring)", value: .border(focusOutline)),
    ThemeKitEntry("focusOutlineOffset", file: "src/styles/base.css", selector: ":focus-visible", property: "outline-offset", kind: "length", css: "2px", value: .length(focusOutlineOffset)),
    ThemeKitEntry("selectionFill", file: "src/styles/base.css", selector: "::selection", property: "background", kind: "color", css: "var(--accent-line)", value: .value(selectionFill)),
    ThemeKitEntry("selectionInk", file: "src/styles/base.css", selector: "::selection", property: "color", kind: "color", css: "var(--ink)", value: .value(selectionInk)),
    ThemeKitEntry("reducedMotionDuration", file: "src/styles/base.css", selector: "*", media: "(prefers-reduced-motion: reduce)", property: "transition-duration", kind: "time", css: "0.01ms", important: true, value: .time(reducedMotionDuration)),
    ThemeKitEntry("buttonHeight", file: "src/styles/controls.css", selector: ".btn", property: "min-height", kind: "length", css: "var(--control-h)", value: .length(buttonHeight)),
    ThemeKitEntry("buttonPadding", file: "src/styles/controls.css", selector: ".btn", property: "padding", kind: "box", css: "0 16px", value: .box(buttonPadding)),
    ThemeKitEntry("buttonGap", file: "src/styles/controls.css", selector: ".btn", property: "gap", kind: "length", css: "8px", value: .length(buttonGap)),
    ThemeKitEntry("buttonBorder", file: "src/styles/controls.css", selector: ".btn", property: "border", kind: "border", css: "1px solid var(--line-2)", value: .border(buttonBorder)),
    ThemeKitEntry("buttonRadius", file: "src/styles/controls.css", selector: ".btn", property: "border-radius", kind: "length", css: "var(--pill)", value: .length(buttonRadius)),
    ThemeKitEntry("buttonFontSize", file: "src/styles/controls.css", selector: ".btn", property: "font-size", kind: "length", css: "0.875rem", value: .length(buttonFontSize)),
    ThemeKitEntry("buttonWeight", file: "src/styles/controls.css", selector: ".btn", property: "font-weight", kind: "number", css: "500", value: .number(buttonWeight)),
    ThemeKitEntry("buttonInk", file: "src/styles/controls.css", selector: ".btn", property: "color", kind: "color", css: "var(--ink)", value: .value(buttonInk)),
    ThemeKitEntry("buttonTransition", file: "src/styles/controls.css", selector: ".btn", property: "transition", kind: "transitions", css: "background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease", value: .transitions(buttonTransition)),
    ThemeKitEntry("buttonHoverEdge", file: "src/styles/controls.css", selector: ".btn:hover:not(:disabled)", media: "(hover: hover)", property: "border-color", kind: "color", css: "var(--ink)", value: .value(buttonHoverEdge)),
    ThemeKitEntry("primaryButtonFill", file: "src/styles/controls.css", selector: ".btn--primary", property: "background", kind: "color", css: "var(--btn)", value: .value(primaryButtonFill)),
    ThemeKitEntry("primaryButtonInk", file: "src/styles/controls.css", selector: ".btn--primary", property: "color", kind: "color", css: "var(--on-btn)", value: .value(primaryButtonInk)),
    ThemeKitEntry("primaryButtonWeight", file: "src/styles/controls.css", selector: ".btn--primary", property: "font-weight", kind: "number", css: "600", value: .number(primaryButtonWeight)),
    ThemeKitEntry("primaryButtonHoverFill", file: "src/styles/controls.css", selector: ".btn--primary:hover:not(:disabled)", media: "(hover: hover)", property: "background", kind: "color", css: "var(--btn-hover)", value: .value(primaryButtonHoverFill)),
    ThemeKitEntry("dangerButtonFill", file: "src/styles/controls.css", selector: ".btn--danger", property: "background", kind: "color", css: "var(--danger)", value: .value(dangerButtonFill)),
    ThemeKitEntry("dangerButtonInk", file: "src/styles/controls.css", selector: ".btn--danger", property: "color", kind: "color", css: "#ffffff", value: .value(dangerButtonInk)),
    ThemeKitEntry("dangerButtonHoverFill", file: "src/styles/controls.css", selector: ".btn--danger:hover:not(:disabled)", media: "(hover: hover)", property: "background", kind: "color", css: "var(--danger-hover)", value: .value(dangerButtonHoverFill)),
    ThemeKitEntry("dangerButtonFillAtNight", file: "src/styles/controls.css", selector: ":root[data-theme='dark'] .btn--danger", property: "background", kind: "color", css: "#b42318", value: .value(dangerButtonFillAtNight)),
    ThemeKitEntry("dangerButtonHoverFillAtNight", file: "src/styles/controls.css", selector: ":root[data-theme='dark'] .btn--danger:hover:not(:disabled)", media: "(hover: hover)", property: "background", kind: "color", css: "#912018", value: .value(dangerButtonHoverFillAtNight)),
    ThemeKitEntry("ghostButtonInk", file: "src/styles/controls.css", selector: ".btn--ghost", property: "color", kind: "color", css: "var(--ink-2)", value: .value(ghostButtonInk)),
    ThemeKitEntry("ghostButtonHoverFill", file: "src/styles/controls.css", selector: ".btn--ghost:hover:not(:disabled)", media: "(hover: hover)", property: "background", kind: "color", css: "var(--hover)", value: .value(ghostButtonHoverFill)),
    ThemeKitEntry("smallButtonHeight", file: "src/styles/controls.css", selector: ".btn--sm", property: "min-height", kind: "length", css: "30px", value: .length(smallButtonHeight)),
    ThemeKitEntry("smallButtonPadding", file: "src/styles/controls.css", selector: ".btn--sm", property: "padding", kind: "box", css: "0 12px", value: .box(smallButtonPadding)),
    ThemeKitEntry("smallButtonGap", file: "src/styles/controls.css", selector: ".btn--sm", property: "gap", kind: "length", css: "6px", value: .length(smallButtonGap)),
    ThemeKitEntry("smallButtonFontSize", file: "src/styles/controls.css", selector: ".btn--sm", property: "font-size", kind: "value", css: "var(--text-sm)", value: .value(smallButtonFontSize)),
    ThemeKitEntry("largeButtonHeight", file: "src/styles/controls.css", selector: ".btn--lg", property: "min-height", kind: "length", css: "46px", value: .length(largeButtonHeight)),
    ThemeKitEntry("largeButtonPadding", file: "src/styles/controls.css", selector: ".btn--lg", property: "padding", kind: "box", css: "0 22px", value: .box(largeButtonPadding)),
    ThemeKitEntry("largeButtonFontSize", file: "src/styles/controls.css", selector: ".btn--lg", property: "font-size", kind: "value", css: "var(--text-md)", value: .value(largeButtonFontSize)),
    ThemeKitEntry("iconButtonWidth", file: "src/styles/controls.css", selector: ".btn--icon", property: "width", kind: "length", css: "var(--control-h)", value: .length(iconButtonWidth)),
    ThemeKitEntry("smallIconButtonWidth", file: "src/styles/controls.css", selector: ".btn--icon.btn--sm", property: "width", kind: "length", css: "30px", value: .length(smallIconButtonWidth)),
    ThemeKitEntry("largeIconButtonWidth", file: "src/styles/controls.css", selector: ".btn--icon.btn--lg", property: "width", kind: "length", css: "46px", value: .length(largeIconButtonWidth)),
    ThemeKitEntry("stateButtonInk", file: "src/styles/controls.css", selector: ".btn.is-on", property: "color", kind: "color", css: "var(--muted)", value: .value(stateButtonInk)),
    ThemeKitEntry("disabledOpacity", file: "src/styles/controls.css", selector: ".btn:disabled", property: "opacity", kind: "number", css: "0.45", value: .number(disabledOpacity)),
    ThemeKitEntry("destructiveButtonInk", file: "src/styles/controls.css", selector: ".btn.is-danger", property: "color", kind: "color", css: "var(--danger)", value: .value(destructiveButtonInk)),
    ThemeKitEntry("linkActionFontSize", file: "src/styles/controls.css", selector: ".link-action", property: "font-size", kind: "value", css: "var(--text-sm)", value: .value(linkActionFontSize)),
    ThemeKitEntry("linkActionWeight", file: "src/styles/controls.css", selector: ".link-action", property: "font-weight", kind: "number", css: "500", value: .number(linkActionWeight)),
    ThemeKitEntry("linkActionGap", file: "src/styles/controls.css", selector: ".link-action", property: "gap", kind: "length", css: "6px", value: .length(linkActionGap)),
    ThemeKitEntry("linkActionUnderlineOffset", file: "src/styles/controls.css", selector: ".link-action", property: "text-underline-offset", kind: "length", css: "3px", value: .length(linkActionUnderlineOffset)),
    ThemeKitEntry("linkActionIconSize", file: "src/styles/controls.css", selector: ".link-action svg", property: "width", kind: "length", css: "14px", value: .length(linkActionIconSize)),
    ThemeKitEntry("linkActionOpenWeight", file: "src/styles/controls.css", selector: ".link-action[aria-expanded='true']", property: "font-weight", kind: "number", css: "600", value: .number(linkActionOpenWeight)),
    ThemeKitEntry("moreLinkFontSize", file: "src/styles/controls.css", selector: ".more-link", property: "font-size", kind: "value", css: "var(--text-sm)", value: .value(moreLinkFontSize)),
    ThemeKitEntry("moreLinkInk", file: "src/styles/controls.css", selector: ".more-link", property: "color", kind: "color", css: "var(--muted)", value: .value(moreLinkInk)),
    ThemeKitEntry("moreLinkWeight", file: "src/styles/controls.css", selector: ".more-link", property: "font-weight", kind: "number", css: "400", value: .number(moreLinkWeight)),
    ThemeKitEntry("segmentedGap", file: "src/styles/controls.css", selector: ".segmented", property: "gap", kind: "length", css: "18px", value: .length(segmentedGap)),
    ThemeKitEntry("segmentedKeyHeight", file: "src/styles/controls.css", selector: ".segmented-key", property: "min-height", kind: "length", css: "var(--control-h)", value: .length(segmentedKeyHeight)),
    ThemeKitEntry("segmentedKeyFontSize", file: "src/styles/controls.css", selector: ".segmented-key", property: "font-size", kind: "value", css: "var(--text-base)", value: .value(segmentedKeyFontSize)),
    ThemeKitEntry("segmentedKeyWeight", file: "src/styles/controls.css", selector: ".segmented-key", property: "font-weight", kind: "number", css: "400", value: .number(segmentedKeyWeight)),
    ThemeKitEntry("segmentedKeyInk", file: "src/styles/controls.css", selector: ".segmented-key", property: "color", kind: "color", css: "var(--muted)", value: .value(segmentedKeyInk)),
    ThemeKitEntry("segmentedKeyTransition", file: "src/styles/controls.css", selector: ".segmented-key", property: "transition", kind: "transitions", css: "color 0.12s ease", value: .transitions(segmentedKeyTransition)),
    ThemeKitEntry("segmentedOnInk", file: "src/styles/controls.css", selector: ".segmented-key.is-on", property: "color", kind: "color", css: "var(--ink)", value: .value(segmentedOnInk)),
    ThemeKitEntry("segmentedOnWeight", file: "src/styles/controls.css", selector: ".segmented-key.is-on", property: "font-weight", kind: "number", css: "600", value: .number(segmentedOnWeight)),
    ThemeKitEntry("segmentedOnUnderline", file: "src/styles/controls.css", selector: ".segmented-key.is-on", property: "box-shadow", kind: "shadow", css: "inset 0 -2px 0 var(--ink)", value: .shadow(segmentedOnUnderline)),
    ThemeKitEntry("segmentedIconSize", file: "src/styles/controls.css", selector: ".segmented-icon", property: "width", kind: "length", css: "15px", value: .length(segmentedIconSize)),
    ThemeKitEntry("smallSegmentedGap", file: "src/styles/controls.css", selector: ".segmented--sm", property: "gap", kind: "length", css: "16px", value: .length(smallSegmentedGap)),
    ThemeKitEntry("smallSegmentedKeyHeight", file: "src/styles/controls.css", selector: ".segmented--sm .segmented-key", property: "min-height", kind: "length", css: "28px", value: .length(smallSegmentedKeyHeight)),
    ThemeKitEntry("smallSegmentedKeyFontSize", file: "src/styles/controls.css", selector: ".segmented--sm .segmented-key", property: "font-size", kind: "value", css: "var(--text-sm)", value: .value(smallSegmentedKeyFontSize)),
    ThemeKitEntry("scrollFadeWidth", file: "src/styles/controls.css", selector: ".scroll-row[data-overflow='both']", property: "mask-image", kind: "gradient", css: "linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent)", value: .gradient(scrollFadeWidth)),
    ThemeKitEntry("cardHeadGap", file: "src/styles/controls.css", selector: ".card-head", property: "gap", kind: "gap", css: "var(--space-2) var(--space-4)", value: .gap(cardHeadGap)),
    ThemeKitEntry("cardHeadSpaceBelow", file: "src/styles/controls.css", selector: ".card-head", property: "margin-bottom", kind: "length", css: "var(--space-4)", value: .length(cardHeadSpaceBelow)),
    ThemeKitEntry("cardTitleFontSize", file: "src/styles/controls.css", selector: ".card-title", property: "font-size", kind: "value", css: "var(--text-md)", value: .value(cardTitleFontSize)),
    ThemeKitEntry("cardTitleWeight", file: "src/styles/controls.css", selector: ".card-title", property: "font-weight", kind: "number", css: "600", value: .number(cardTitleWeight)),
    ThemeKitEntry("cardTitleTracking", file: "src/styles/controls.css", selector: ".card-title", property: "letter-spacing", kind: "length", css: "-0.005em", value: .length(cardTitleTracking)),
    ThemeKitEntry("cardSubFontSize", file: "src/styles/controls.css", selector: ".card-sub", property: "font-size", kind: "value", css: "var(--text-sm)", value: .value(cardSubFontSize)),
    ThemeKitEntry("cardSubInk", file: "src/styles/controls.css", selector: ".card-sub", property: "color", kind: "color", css: "var(--muted)", value: .value(cardSubInk)),
    ThemeKitEntry("cardSubSpaceAbove", file: "src/styles/controls.css", selector: ".card-sub", property: "margin-top", kind: "length", css: "2px", value: .length(cardSubSpaceAbove)),
    ThemeKitEntry("cardSubMaxWidth", file: "src/styles/controls.css", selector: ".card-sub", property: "max-width", kind: "length", css: "var(--measure)", value: .length(cardSubMaxWidth)),
    ThemeKitEntry("cardCaptionSpaceAbove", file: "src/styles/controls.css", selector: ".card-caption", property: "margin-top", kind: "length", css: "var(--space-3)", value: .length(cardCaptionSpaceAbove)),
    ThemeKitEntry("flushHeadSpaceBelow", file: "src/styles/controls.css", selector: ".card--flush > .card-head", property: "padding-bottom", kind: "length", css: "var(--space-3)", value: .length(flushHeadSpaceBelow)),
    ThemeKitEntry("flushHeadRule", file: "src/styles/controls.css", selector: ".card--flush > .card-head", property: "border-bottom", kind: "border", css: "1px solid var(--rule)", value: .border(flushHeadRule)),
    ThemeKitEntry("cardFootSpaceAbove", file: "src/styles/controls.css", selector: ".card-foot", property: "margin-top", kind: "length", css: "var(--space-3)", value: .length(cardFootSpaceAbove)),
    ThemeKitEntry("headActionsGap", file: "src/styles/controls.css", selector: ".head-actions", property: "gap", kind: "gap", css: "8px 24px", value: .gap(headActionsGap)),
    ThemeKitEntry("headToolsGap", file: "src/styles/controls.css", selector: ".head-tools", property: "gap", kind: "length", css: "4px", value: .length(headToolsGap)),
    ThemeKitEntry("listToolbarGap", file: "src/styles/controls.css", selector: ".list-toolbar", property: "gap", kind: "gap", css: "12px 32px", value: .gap(listToolbarGap)),
    ThemeKitEntry("listToolbarSpaceBelow", file: "src/styles/controls.css", selector: ".list-toolbar", property: "margin-bottom", kind: "length", css: "var(--space-4)", value: .length(listToolbarSpaceBelow)),
    ThemeKitEntry("phoneListToolbarGap", file: "src/styles/controls.css", selector: ".list-toolbar", media: "(max-width: 560px)", property: "gap", kind: "gap", css: "12px 16px", value: .gap(phoneListToolbarGap)),
    ThemeKitEntry("rowActionsGap", file: "src/styles/controls.css", selector: ".row-actions", property: "gap", kind: "length", css: "8px", value: .length(rowActionsGap)),
    ThemeKitEntry("chartFootGap", file: "src/styles/controls.css", selector: ".chart-foot", property: "gap", kind: "gap", css: "8px 24px", value: .gap(chartFootGap)),
    ThemeKitEntry("chartFootSpaceAbove", file: "src/styles/controls.css", selector: ".chart-foot", property: "margin-top", kind: "length", css: "var(--space-3)", value: .length(chartFootSpaceAbove)),
    ThemeKitEntry("figuresGap", file: "src/styles/controls.css", selector: ".figures", property: "gap", kind: "gap", css: "20px var(--space-6)", value: .gap(figuresGap)),
    ThemeKitEntry("figureCellGap", file: "src/styles/controls.css", selector: ".figures-cell", property: "gap", kind: "length", css: "8px", value: .length(figureCellGap)),
    ThemeKitEntry("figureCellPadding", file: "src/styles/controls.css", selector: ".figures-cell", property: "padding", kind: "box", css: "16px 0 0", value: .box(figureCellPadding)),
    ThemeKitEntry("figureCellRule", file: "src/styles/controls.css", selector: ".figures-cell", property: "border-top", kind: "border", css: "2px solid var(--line)", value: .border(figureCellRule)),
    ThemeKitEntry("figureLabelFontSize", file: "src/styles/controls.css", selector: ".figures-label", property: "font-size", kind: "value", css: "var(--text-sm)", value: .value(figureLabelFontSize)),
    ThemeKitEntry("figureLabelWeight", file: "src/styles/controls.css", selector: ".figures-label", property: "font-weight", kind: "number", css: "500", value: .number(figureLabelWeight)),
    ThemeKitEntry("figureLabelInk", file: "src/styles/controls.css", selector: ".figures-label", property: "color", kind: "color", css: "var(--ink-2)", value: .value(figureLabelInk)),
    ThemeKitEntry("figureValueFontSize", file: "src/styles/controls.css", selector: ".figures-value", property: "font-size", kind: "value", css: "var(--figure-size)", value: .value(figureValueFontSize)),
    ThemeKitEntry("figureValueWeight", file: "src/styles/controls.css", selector: ".figures-value", property: "font-weight", kind: "number", css: "500", value: .number(figureValueWeight)),
    ThemeKitEntry("figureValueTracking", file: "src/styles/controls.css", selector: ".figures-value", property: "letter-spacing", kind: "length", css: "-0.04em", value: .length(figureValueTracking)),
    ThemeKitEntry("figureValueLineHeight", file: "src/styles/controls.css", selector: ".figures-value", property: "line-height", kind: "number", css: "1", value: .number(figureValueLineHeight)),
    ThemeKitEntry("figureNoteFontSize", file: "src/styles/controls.css", selector: ".figures-note", property: "font-size", kind: "value", css: "var(--text-sm)", value: .value(figureNoteFontSize)),
    ThemeKitEntry("figureNoteLineHeight", file: "src/styles/controls.css", selector: ".figures-note", property: "line-height", kind: "number", css: "1.35", value: .number(figureNoteLineHeight)),
    ThemeKitEntry("phoneFiguresColumnGap", file: "src/styles/controls.css", selector: ".figures", media: "(max-width: 560px)", property: "column-gap", kind: "length", css: "20px", value: .length(phoneFiguresColumnGap)),
    ThemeKitEntry("phoneFigureCellPadding", file: "src/styles/controls.css", selector: ".figures-cell", media: "(max-width: 560px)", property: "padding", kind: "box", css: "12px 0 0", value: .box(phoneFigureCellPadding)),
    ThemeKitEntry("deltaFontSize", file: "src/styles/controls.css", selector: ".delta", property: "font-size", kind: "value", css: "var(--text-sm)", value: .value(deltaFontSize)),
    ThemeKitEntry("deltaWeight", file: "src/styles/controls.css", selector: ".delta", property: "font-weight", kind: "number", css: "600", value: .number(deltaWeight)),
    ThemeKitEntry("menuListMinWidth", file: "src/styles/controls.css", selector: ".menu-list", property: "min-width", kind: "length", css: "13rem", value: .length(menuListMinWidth)),
    ThemeKitEntry("menuListPadding", file: "src/styles/controls.css", selector: ".menu-list", property: "padding", kind: "box", css: "6px", value: .box(menuListPadding)),
    ThemeKitEntry("menuListRadius", file: "src/styles/controls.css", selector: ".menu-list", property: "border-radius", kind: "length", css: "var(--radius-lg)", value: .length(menuListRadius)),
    ThemeKitEntry("menuListEdge", file: "src/styles/controls.css", selector: ".menu-list", property: "border", kind: "border", css: "1px solid var(--line)", value: .border(menuListEdge)),
    ThemeKitEntry("menuListFill", file: "src/styles/controls.css", selector: ".menu-list", property: "background", kind: "color", css: "var(--surface)", value: .value(menuListFill)),
    ThemeKitEntry("menuListShadow", file: "src/styles/controls.css", selector: ".menu-list", property: "box-shadow", kind: "value", css: "var(--shadow-lg)", value: .value(menuListShadow)),
    ThemeKitEntry("menuItemPadding", file: "src/styles/controls.css", selector: ".menu-item", property: "padding", kind: "box", css: "8px 10px", value: .box(menuItemPadding)),
    ThemeKitEntry("menuItemGap", file: "src/styles/controls.css", selector: ".menu-item", property: "gap", kind: "length", css: "10px", value: .length(menuItemGap)),
    ThemeKitEntry("menuItemRadius", file: "src/styles/controls.css", selector: ".menu-item", property: "border-radius", kind: "length", css: "var(--radius)", value: .length(menuItemRadius)),
    ThemeKitEntry("menuItemHoverFill", file: "src/styles/controls.css", selector: ".menu-item:hover", media: "(hover: hover)", property: "background", kind: "color", css: "var(--hover)", value: .value(menuItemHoverFill)),
    ThemeKitEntry("menuItemDangerInk", file: "src/styles/controls.css", selector: ".menu-item[data-tone='danger']", property: "color", kind: "color", css: "var(--danger)", value: .value(menuItemDangerInk)),
    ThemeKitEntry("menuItemIconSize", file: "src/styles/controls.css", selector: ".menu-item-icon", property: "width", kind: "length", css: "16px", value: .length(menuItemIconSize)),
    ThemeKitEntry("menuItemLabelWeight", file: "src/styles/controls.css", selector: ".menu-item-label", property: "font-weight", kind: "number", css: "500", value: .number(menuItemLabelWeight)),
    ThemeKitEntry("menuItemHintLineHeight", file: "src/styles/controls.css", selector: ".menu-item-hint", property: "line-height", kind: "number", css: "1.35", value: .number(menuItemHintLineHeight)),
    ThemeKitEntry("menuSheetRadius", file: "src/styles/controls.css", selector: ".menu-list.menu-list--sheet", property: "border-radius", kind: "box", css: "16px 16px 0 0", value: .box(menuSheetRadius)),
    ThemeKitEntry("menuScrimFill", file: "src/styles/controls.css", selector: ".menu-scrim", property: "background", kind: "color", css: "var(--scrim)", value: .value(menuScrimFill)),
    ThemeKitEntry("menuScrimAnimation", file: "src/styles/controls.css", selector: ".menu-scrim", media: "(prefers-reduced-motion: no-preference)", property: "animation", kind: "animation", css: "menu-scrim-in 0.16s var(--ease)", value: .animation(menuScrimAnimation)),
    ThemeKitEntry("menuSheetAnimation", file: "src/styles/controls.css", selector: ".menu-list--sheet", media: "(prefers-reduced-motion: no-preference)", property: "animation", kind: "animation", css: "menu-sheet-in 0.2s var(--ease)", value: .animation(menuSheetAnimation)),
    ThemeKitEntry("fieldGap", file: "src/styles/controls.css", selector: ".field", property: "gap", kind: "length", css: "6px", value: .length(fieldGap)),
    ThemeKitEntry("fieldLabelFontSize", file: "src/styles/controls.css", selector: ".field-label", property: "font-size", kind: "value", css: "var(--text-sm)", value: .value(fieldLabelFontSize)),
    ThemeKitEntry("fieldLabelWeight", file: "src/styles/controls.css", selector: ".field-label", property: "font-weight", kind: "number", css: "600", value: .number(fieldLabelWeight)),
    ThemeKitEntry("inputHeight", file: "src/styles/controls.css", selector: ".input", property: "min-height", kind: "length", css: "var(--control-h)", value: .length(inputHeight)),
    ThemeKitEntry("inputPadding", file: "src/styles/controls.css", selector: ".input", property: "padding", kind: "box", css: "0 12px", value: .box(inputPadding)),
    ThemeKitEntry("inputBorder", file: "src/styles/controls.css", selector: ".input", property: "border", kind: "border", css: "1px solid var(--line-2)", value: .border(inputBorder)),
    ThemeKitEntry("inputRadius", file: "src/styles/controls.css", selector: ".input", property: "border-radius", kind: "length", css: "var(--radius)", value: .length(inputRadius)),
    ThemeKitEntry("inputFill", file: "src/styles/controls.css", selector: ".input", property: "background", kind: "color", css: "color-mix(in srgb, var(--surface) 72%, transparent)", value: .value(inputFill)),
    ThemeKitEntry("inputTransition", file: "src/styles/controls.css", selector: ".input", property: "transition", kind: "transitions", css: "border-color 0.12s ease, box-shadow 0.12s ease", value: .transitions(inputTransition)),
    ThemeKitEntry("inputPlaceholderInk", file: "src/styles/controls.css", selector: ".input::placeholder", property: "color", kind: "color", css: "var(--muted)", value: .value(inputPlaceholderInk)),
    ThemeKitEntry("invalidFocusRing", file: "src/styles/controls.css", selector: ".input[aria-invalid='true']", property: "--focus-ring", kind: "value", css: "var(--danger)", value: .value(invalidFocusRing)),
    ThemeKitEntry("invalidFocus", file: "src/styles/controls.css", selector: ".input[aria-invalid='true']", property: "--focus", kind: "value", css: "0 0 0 1px var(--focus-ring), 0 0 0 4px color-mix(in srgb, var(--focus-ring) 32%, transparent)", value: .value(invalidFocus)),
    ThemeKitEntry("invalidEdge", file: "src/styles/controls.css", selector: ".input[aria-invalid='true']", property: "border-color", kind: "color", css: "var(--danger)", value: .value(invalidEdge)),
    ThemeKitEntry("highContrastInvalidFocus", file: "src/styles/controls.css", selector: ":root[data-contrast='high'] .input[aria-invalid='true']", property: "--focus", kind: "value", css: "0 0 0 2px var(--surface), 0 0 0 5px var(--focus-ring)", value: .value(highContrastInvalidFocus)),
    ThemeKitEntry("largeInputHeight", file: "src/styles/controls.css", selector: ".input--lg", property: "min-height", kind: "length", css: "46px", value: .length(largeInputHeight)),
    ThemeKitEntry("largeInputPadding", file: "src/styles/controls.css", selector: ".input--lg", property: "padding", kind: "box", css: "0 16px", value: .box(largeInputPadding)),
    ThemeKitEntry("textAreaMinHeight", file: "src/styles/controls.css", selector: "textarea.input", property: "min-height", kind: "length", css: "calc(var(--control-h) * 2.5)", value: .length(textAreaMinHeight)),
    ThemeKitEntry("textAreaPadding", file: "src/styles/controls.css", selector: "textarea.input", property: "padding", kind: "box", css: "9px 12px", value: .box(textAreaPadding)),
    ThemeKitEntry("textAreaLineHeight", file: "src/styles/controls.css", selector: "textarea.input", property: "line-height", kind: "number", css: "1.5", value: .number(textAreaLineHeight)),
    ThemeKitEntry("disabledInputFill", file: "src/styles/controls.css", selector: ".input:disabled", property: "background", kind: "color", css: "var(--surface-2)", value: .value(disabledInputFill)),
    ThemeKitEntry("overLimitInk", file: "src/styles/controls.css", selector: ".field-hint.is-over", property: "color", kind: "color", css: "var(--danger)", value: .value(overLimitInk)),
    ThemeKitEntry("checkGap", file: "src/styles/controls.css", selector: ".check", property: "gap", kind: "length", css: "8px", value: .length(checkGap)),
    ThemeKitEntry("checkboxSize", file: "src/styles/controls.css", selector: "input[type='checkbox']", property: "width", kind: "length", css: "16px", value: .length(checkboxSize)),
    ThemeKitEntry("searchIconInset", file: "src/styles/controls.css", selector: ".search > svg", property: "left", kind: "length", css: "12px", value: .length(searchIconInset)),
    ThemeKitEntry("searchInputLeading", file: "src/styles/controls.css", selector: ".search > .input", property: "padding-left", kind: "length", css: "36px", value: .length(searchInputLeading)),
    ThemeKitEntry("switchWidth", file: "src/styles/controls.css", selector: ".switch", property: "width", kind: "length", css: "40px", value: .length(switchWidth)),
    ThemeKitEntry("switchHeight", file: "src/styles/controls.css", selector: ".switch", property: "height", kind: "length", css: "24px", value: .length(switchHeight)),
    ThemeKitEntry("switchPadding", file: "src/styles/controls.css", selector: ".switch", property: "padding", kind: "box", css: "2px", value: .box(switchPadding)),
    ThemeKitEntry("switchOffFill", file: "src/styles/controls.css", selector: ".switch", property: "background", kind: "color", css: "var(--line-2)", value: .value(switchOffFill)),
    ThemeKitEntry("switchTransition", file: "src/styles/controls.css", selector: ".switch", property: "transition", kind: "transitions", css: "background-color 0.15s ease", value: .transitions(switchTransition)),
    ThemeKitEntry("switchKnobSize", file: "src/styles/controls.css", selector: ".switch::after", property: "width", kind: "length", css: "20px", value: .length(switchKnobSize)),
    ThemeKitEntry("switchKnobFill", file: "src/styles/controls.css", selector: ".switch::after", property: "background", kind: "color", css: "#ffffff", value: .value(switchKnobFill)),
    ThemeKitEntry("switchKnobShadow", file: "src/styles/controls.css", selector: ".switch::after", property: "box-shadow", kind: "shadow", css: "0 1px 2px rgb(15 27 51 / 0.3)", value: .shadow(switchKnobShadow)),
    ThemeKitEntry("switchKnobTransition", file: "src/styles/controls.css", selector: ".switch::after", property: "transition", kind: "transitions", css: "transform 0.15s var(--ease), background-color 0.15s ease", value: .transitions(switchKnobTransition)),
    ThemeKitEntry("switchOnFill", file: "src/styles/controls.css", selector: ".switch[aria-checked='true']", property: "background", kind: "color", css: "var(--accent)", value: .value(switchOnFill)),
    ThemeKitEntry("switchOnKnobFill", file: "src/styles/controls.css", selector: ".switch[aria-checked='true']::after", property: "background", kind: "color", css: "var(--on-accent)", value: .value(switchOnKnobFill)),
    ThemeKitEntry("switchDisabledOpacity", file: "src/styles/controls.css", selector: ".switch:disabled", property: "opacity", kind: "number", css: "0.5", value: .number(switchDisabledOpacity)),
    ThemeKitEntry("badgeFontSize", file: "src/styles/controls.css", selector: ".badge", property: "font-size", kind: "value", css: "var(--text-xs)", value: .value(badgeFontSize)),
    ThemeKitEntry("badgeLineHeight", file: "src/styles/controls.css", selector: ".badge", property: "line-height", kind: "length", css: "20px", value: .length(badgeLineHeight)),
    ThemeKitEntry("badgePadding", file: "src/styles/controls.css", selector: ".badge", property: "padding", kind: "box", css: "0 7px", value: .box(badgePadding)),
    ThemeKitEntry("badgeWeight", file: "src/styles/controls.css", selector: ".badge", property: "font-weight", kind: "number", css: "500", value: .number(badgeWeight)),
    ThemeKitEntry("badgeGap", file: "src/styles/controls.css", selector: ".badge", property: "gap", kind: "length", css: "5px", value: .length(badgeGap)),
    ThemeKitEntry("badgeIconSize", file: "src/styles/controls.css", selector: ".badge svg", property: "width", kind: "length", css: "12px", value: .length(badgeIconSize)),
    ThemeKitEntry("warnBadgeFill", file: "src/styles/controls.css", selector: ".badge--warn", property: "background", kind: "color", css: "var(--warn-wash)", value: .value(warnBadgeFill)),
    ThemeKitEntry("warnBadgeInk", file: "src/styles/controls.css", selector: ".badge--warn", property: "color", kind: "color", css: "var(--warn)", value: .value(warnBadgeInk)),
    ThemeKitEntry("dangerBadgeFill", file: "src/styles/controls.css", selector: ".badge--danger", property: "background", kind: "color", css: "var(--danger-wash)", value: .value(dangerBadgeFill)),
    ThemeKitEntry("dangerBadgeInk", file: "src/styles/controls.css", selector: ".badge--danger", property: "color", kind: "color", css: "var(--danger)", value: .value(dangerBadgeInk)),
    ThemeKitEntry("metaFontSize", file: "src/styles/controls.css", selector: ".meta", property: "font-size", kind: "value", css: "var(--text-sm)", value: .value(metaFontSize)),
    ThemeKitEntry("metaInk", file: "src/styles/controls.css", selector: ".meta", property: "color", kind: "color", css: "var(--muted)", value: .value(metaInk)),
    ThemeKitEntry("metaLineHeight", file: "src/styles/controls.css", selector: ".meta", property: "line-height", kind: "number", css: "1.45", value: .number(metaLineHeight)),
    ThemeKitEntry("metaItemGap", file: "src/styles/controls.css", selector: ".meta > *", property: "gap", kind: "length", css: "5px", value: .length(metaItemGap)),
    ThemeKitEntry("metaDotMargin", file: "src/styles/controls.css", selector: ".meta > :not(:last-child)::after", property: "margin", kind: "box", css: "0 6px 0 1px", value: .box(metaDotMargin)),
    ThemeKitEntry("metaIconSize", file: "src/styles/controls.css", selector: ".meta svg", property: "width", kind: "length", css: "13px", value: .length(metaIconSize)),
    ThemeKitEntry("metaGroupGap", file: "src/styles/controls.css", selector: ".meta > .meta-group", property: "gap", kind: "length", css: "12px", value: .length(metaGroupGap)),
    ThemeKitEntry("metaKeyInk", file: "src/styles/controls.css", selector: ".meta .is-key", property: "color", kind: "color", css: "var(--ink-2)", value: .value(metaKeyInk)),
    ThemeKitEntry("metaKeyWeight", file: "src/styles/controls.css", selector: ".meta .is-key", property: "font-weight", kind: "number", css: "500", value: .number(metaKeyWeight)),
    ThemeKitEntry("chipHeight", file: "src/styles/controls.css", selector: ".chip", property: "min-height", kind: "length", css: "30px", value: .length(chipHeight)),
    ThemeKitEntry("chipPadding", file: "src/styles/controls.css", selector: ".chip", property: "padding", kind: "box", css: "0 13px", value: .box(chipPadding)),
    ThemeKitEntry("chipFontSize", file: "src/styles/controls.css", selector: ".chip", property: "font-size", kind: "value", css: "var(--text-sm)", value: .value(chipFontSize)),
    ThemeKitEntry("chipWeight", file: "src/styles/controls.css", selector: ".chip", property: "font-weight", kind: "number", css: "500", value: .number(chipWeight)),
    ThemeKitEntry("chipBorder", file: "src/styles/controls.css", selector: ".chip", property: "border", kind: "border", css: "1px solid var(--line-2)", value: .border(chipBorder)),
    ThemeKitEntry("chipInk", file: "src/styles/controls.css", selector: ".chip", property: "color", kind: "color", css: "var(--ink-2)", value: .value(chipInk)),
    ThemeKitEntry("chipOnFill", file: "src/styles/controls.css", selector: ".chip[aria-pressed='true']", property: "background", kind: "color", css: "var(--btn)", value: .value(chipOnFill)),
    ThemeKitEntry("chipOnInk", file: "src/styles/controls.css", selector: ".chip[aria-pressed='true']", property: "color", kind: "color", css: "var(--on-btn)", value: .value(chipOnInk)),
    ThemeKitEntry("chipOnWeight", file: "src/styles/controls.css", selector: ".chip[aria-pressed='true']", property: "font-weight", kind: "number", css: "600", value: .number(chipOnWeight)),
    ThemeKitEntry("tokenHeight", file: "src/styles/controls.css", selector: ".token", property: "min-height", kind: "length", css: "30px", value: .length(tokenHeight)),
    ThemeKitEntry("tokenPadding", file: "src/styles/controls.css", selector: ".token", property: "padding", kind: "box", css: "0 4px 0 12px", value: .box(tokenPadding)),
    ThemeKitEntry("tokenGap", file: "src/styles/controls.css", selector: ".token", property: "gap", kind: "length", css: "4px", value: .length(tokenGap)),
    ThemeKitEntry("tokenRemoveSize", file: "src/styles/controls.css", selector: ".token-remove", property: "width", kind: "length", css: "24px", value: .length(tokenRemoveSize)),
    ThemeKitEntry("tokenRemoveIconSize", file: "src/styles/controls.css", selector: ".token-remove svg", property: "width", kind: "length", css: "14px", value: .length(tokenRemoveIconSize)),
    ThemeKitEntry("tokensGap", file: "src/styles/controls.css", selector: ".tokens", property: "gap", kind: "length", css: "8px", value: .length(tokensGap)),
    ThemeKitEntry("avatarSize", file: "src/styles/controls.css", selector: ".avatar", property: "width", kind: "length", css: "34px", value: .length(avatarSize)),
    ThemeKitEntry("avatarFontSize", file: "src/styles/controls.css", selector: ".avatar", property: "font-size", kind: "value", css: "var(--text-sm)", value: .value(avatarFontSize)),
    ThemeKitEntry("avatarWeight", file: "src/styles/controls.css", selector: ".avatar", property: "font-weight", kind: "number", css: "600", value: .number(avatarWeight)),
    ThemeKitEntry("smallAvatarSize", file: "src/styles/controls.css", selector: ".avatar--sm", property: "width", kind: "length", css: "24px", value: .length(smallAvatarSize)),
    ThemeKitEntry("smallAvatarFontSize", file: "src/styles/controls.css", selector: ".avatar--sm", property: "font-size", kind: "length", css: "11px", value: .length(smallAvatarFontSize)),
    ThemeKitEntry("largeAvatarSize", file: "src/styles/controls.css", selector: ".avatar--lg", property: "width", kind: "length", css: "44px", value: .length(largeAvatarSize)),
    ThemeKitEntry("largeAvatarFontSize", file: "src/styles/controls.css", selector: ".avatar--lg", property: "font-size", kind: "value", css: "var(--text-md)", value: .value(largeAvatarFontSize)),
    ThemeKitEntry("dotSize", file: "src/styles/controls.css", selector: ".dot", property: "width", kind: "length", css: "7px", value: .length(dotSize)),
    ThemeKitEntry("dotFill", file: "src/styles/controls.css", selector: ".dot", property: "background", kind: "color", css: "var(--ok)", value: .value(dotFill)),
    ThemeKitEntry("warnDotFill", file: "src/styles/controls.css", selector: ".dot--warn", property: "background", kind: "color", css: "var(--warn)", value: .value(warnDotFill)),
    ThemeKitEntry("dangerDotFill", file: "src/styles/controls.css", selector: ".dot--danger", property: "background", kind: "color", css: "var(--danger)", value: .value(dangerDotFill)),
    ThemeKitEntry("idleDotFill", file: "src/styles/controls.css", selector: ".dot--idle", property: "background", kind: "color", css: "var(--faint)", value: .value(idleDotFill)),
    ThemeKitEntry("currentDotFill", file: "src/styles/controls.css", selector: ".dot--current", property: "background", kind: "color", css: "var(--accent)", value: .value(currentDotFill)),
    ThemeKitEntry("tableCellPadding", file: "src/styles/controls.css", selector: ".table td", property: "padding", kind: "box", css: "var(--row-pad) 12px", value: .box(tableCellPadding)),
    ThemeKitEntry("tableRowRule", file: "src/styles/controls.css", selector: ".table td", property: "border-bottom", kind: "border", css: "1px solid var(--line)", value: .border(tableRowRule)),
    ThemeKitEntry("tableHeadSpaceBelow", file: "src/styles/controls.css", selector: ".table thead th", property: "padding-bottom", kind: "length", css: "10px", value: .length(tableHeadSpaceBelow)),
    ThemeKitEntry("tableHeadRule", file: "src/styles/controls.css", selector: ".table thead th", property: "border-bottom", kind: "border", css: "1px solid var(--rule)", value: .border(tableHeadRule)),
    ThemeKitEntry("tableHeadFontSize", file: "src/styles/controls.css", selector: ".table thead th", property: "font-size", kind: "value", css: "var(--text-sm)", value: .value(tableHeadFontSize)),
    ThemeKitEntry("tableHeadWeight", file: "src/styles/controls.css", selector: ".table thead th", property: "font-weight", kind: "number", css: "500", value: .number(tableHeadWeight)),
    ThemeKitEntry("selectedRowFill", file: "src/styles/controls.css", selector: ".table tr.is-selected", property: "background", kind: "color", css: "var(--accent-tint)", value: .value(selectedRowFill)),
    ThemeKitEntry("emptyPadding", file: "src/styles/controls.css", selector: ".empty", property: "padding", kind: "box", css: "var(--space-5) 0", value: .box(emptyPadding)),
    ThemeKitEntry("emptyBlockGap", file: "src/styles/controls.css", selector: ".empty-block", property: "gap", kind: "length", css: "12px", value: .length(emptyBlockGap)),
    ThemeKitEntry("noteFontSize", file: "src/styles/controls.css", selector: ".note", property: "font-size", kind: "value", css: "var(--text-sm)", value: .value(noteFontSize)),
    ThemeKitEntry("noteMaxWidth", file: "src/styles/controls.css", selector: ".note", property: "max-width", kind: "length", css: "var(--measure)", value: .length(noteMaxWidth)),
    ThemeKitEntry("calloutPadding", file: "src/styles/controls.css", selector: ".callout", property: "padding", kind: "box", css: "2px 0 2px 14px", value: .box(calloutPadding)),
    ThemeKitEntry("calloutEdge", file: "src/styles/controls.css", selector: ".callout", property: "border-left", kind: "border", css: "2px solid var(--line-2)", value: .border(calloutEdge)),
    ThemeKitEntry("calloutGap", file: "src/styles/controls.css", selector: ".callout", property: "gap", kind: "length", css: "10px", value: .length(calloutGap)),
    ThemeKitEntry("calloutInk", file: "src/styles/controls.css", selector: ".callout", property: "color", kind: "color", css: "var(--ink-2)", value: .value(calloutInk)),
    ThemeKitEntry("warnCalloutPadding", file: "src/styles/controls.css", selector: ".callout--warn", property: "padding", kind: "box", css: "12px 14px", value: .box(warnCalloutPadding)),
    ThemeKitEntry("warnCalloutFill", file: "src/styles/controls.css", selector: ".callout--warn", property: "background", kind: "color", css: "var(--warn-wash)", value: .value(warnCalloutFill)),
    ThemeKitEntry("warnCalloutEdge", file: "src/styles/controls.css", selector: ".callout--warn", property: "border-left-color", kind: "color", css: "var(--warn)", value: .value(warnCalloutEdge)),
    ThemeKitEntry("dangerCalloutFill", file: "src/styles/controls.css", selector: ".callout--danger", property: "background", kind: "color", css: "var(--danger-wash)", value: .value(dangerCalloutFill)),
    ThemeKitEntry("dangerCalloutEdge", file: "src/styles/controls.css", selector: ".callout--danger", property: "border-left-color", kind: "color", css: "var(--danger)", value: .value(dangerCalloutEdge)),
    ThemeKitEntry("disclosureTransition", file: "src/styles/controls.css", selector: ".disclosure > summary::before", property: "transition", kind: "transitions", css: "transform 0.15s ease", value: .transitions(disclosureTransition)),
    ThemeKitEntry("progressHeight", file: "src/styles/controls.css", selector: ".progress", property: "height", kind: "length", css: "3px", value: .length(progressHeight)),
    ThemeKitEntry("progressTrack", file: "src/styles/controls.css", selector: ".progress", property: "background", kind: "color", css: "var(--line)", value: .value(progressTrack)),
    ThemeKitEntry("progressFill", file: "src/styles/controls.css", selector: ".progress-fill", property: "background", kind: "color", css: "var(--accent)", value: .value(progressFill)),
    ThemeKitEntry("progressTransition", file: "src/styles/controls.css", selector: ".progress-fill", property: "transition", kind: "transitions", css: "width 0.3s ease", value: .transitions(progressTransition)),
    ThemeKitEntry("progressIndeterminateWidth", file: "src/styles/controls.css", selector: ".progress-fill[data-indeterminate]", property: "width", kind: "length", css: "35%", value: .length(progressIndeterminateWidth)),
    ThemeKitEntry("progressIndeterminateAnimation", file: "src/styles/controls.css", selector: ".progress-fill[data-indeterminate]", property: "animation", kind: "animation", css: "progress-slide 1.2s ease-in-out infinite", value: .animation(progressIndeterminateAnimation)),
    ThemeKitEntry("infoTipButtonSize", file: "src/styles/controls.css", selector: ".info-tip-button", property: "width", kind: "length", css: "20px", value: .length(infoTipButtonSize)),
    ThemeKitEntry("infoTipWidth", file: "src/styles/controls.css", selector: ".info-tip-pop", property: "width", kind: "length", css: "min(280px, calc(100vw - 32px))", value: .length(infoTipWidth)),
    ThemeKitEntry("infoTipPadding", file: "src/styles/controls.css", selector: ".info-tip-pop", property: "padding", kind: "box", css: "9px 12px", value: .box(infoTipPadding)),
    ThemeKitEntry("infoTipRadius", file: "src/styles/controls.css", selector: ".info-tip-pop", property: "border-radius", kind: "length", css: "var(--radius)", value: .length(infoTipRadius)),
    ThemeKitEntry("infoTipFill", file: "src/styles/controls.css", selector: ".info-tip-pop", property: "background", kind: "color", css: "var(--btn)", value: .value(infoTipFill)),
    ThemeKitEntry("infoTipInk", file: "src/styles/controls.css", selector: ".info-tip-pop", property: "color", kind: "color", css: "var(--on-btn)", value: .value(infoTipInk)),
    ThemeKitEntry("touchButtonHeight", file: "src/styles/controls.css", selector: ".btn", media: "(pointer: coarse)", property: "min-height", kind: "length", css: "40px", value: .length(touchButtonHeight)),
    ThemeKitEntry("touchLargeButtonHeight", file: "src/styles/controls.css", selector: ".btn--lg", media: "(pointer: coarse)", property: "min-height", kind: "length", css: "46px", value: .length(touchLargeButtonHeight)),
    ThemeKitEntry("touchIconButtonWidth", file: "src/styles/controls.css", selector: ".btn--icon", media: "(pointer: coarse)", property: "width", kind: "length", css: "40px", value: .length(touchIconButtonWidth)),
    ThemeKitEntry("touchSmallButtonHeight", file: "src/styles/controls.css", selector: ".btn--sm", media: "(pointer: coarse)", property: "min-height", kind: "length", css: "32px", value: .length(touchSmallButtonHeight)),
    ThemeKitEntry("touchSmallIconButtonWidth", file: "src/styles/controls.css", selector: ".btn--icon.btn--sm", media: "(pointer: coarse)", property: "width", kind: "length", css: "32px", value: .length(touchSmallIconButtonWidth)),
    ThemeKitEntry("touchGhostIconButtonSize", file: "src/styles/controls.css", selector: ".btn--ghost.btn--icon", media: "(pointer: coarse)", property: "width", kind: "length", css: "44px", value: .length(touchGhostIconButtonSize)),
    ThemeKitEntry("touchChipHeight", file: "src/styles/controls.css", selector: ".chip", media: "(pointer: coarse)", property: "min-height", kind: "length", css: "40px", value: .length(touchChipHeight)),
    ThemeKitEntry("touchInputHeight", file: "src/styles/controls.css", selector: ".input", media: "(pointer: coarse)", property: "min-height", kind: "length", css: "40px", value: .length(touchInputHeight)),
    ThemeKitEntry("touchInputFontSize", file: "src/styles/controls.css", selector: ".input", media: "(pointer: coarse)", property: "font-size", kind: "length", css: "16px", value: .length(touchInputFontSize)),
    ThemeKitEntry("touchTokenHeight", file: "src/styles/controls.css", selector: ".token", media: "(pointer: coarse)", property: "min-height", kind: "length", css: "32px", value: .length(touchTokenHeight)),
    ThemeKitEntry("touchTokensRowGap", file: "src/styles/controls.css", selector: ".tokens", media: "(pointer: coarse)", property: "row-gap", kind: "length", css: "12px", value: .length(touchTokensRowGap)),
    ThemeKitEntry("touchSegmentedGap", file: "src/styles/controls.css", selector: ".segmented", media: "(pointer: coarse)", property: "gap", kind: "length", css: "22px", value: .length(touchSegmentedGap)),
    ThemeKitEntry("touchSegmentedKeyHeight", file: "src/styles/controls.css", selector: ".segmented-key", media: "(pointer: coarse)", property: "min-height", kind: "length", css: "44px", value: .length(touchSegmentedKeyHeight)),
    ThemeKitEntry("touchMenuItemHeight", file: "src/styles/controls.css", selector: ".menu-item", media: "(pointer: coarse)", property: "min-height", kind: "length", css: "44px", value: .length(touchMenuItemHeight)),
    ThemeKitEntry("touchChartFootActionHeight", file: "src/styles/controls.css", selector: ".chart-foot .link-action", media: "(pointer: coarse)", property: "min-height", kind: "length", css: "44px", value: .length(touchChartFootActionHeight)),
    ThemeKitEntry("touchInfoTipButtonSize", file: "src/styles/controls.css", selector: ".info-tip-button", media: "(pointer: coarse)", property: "width", kind: "length", css: "32px", value: .length(touchInfoTipButtonSize)),
    ThemeKitEntry("highContrastFocusOutlineWidth", file: "src/styles/theme.css", selector: ":root[data-contrast='high'] :focus-visible", property: "outline-width", kind: "length", css: "3px", value: .length(highContrastFocusOutlineWidth)),
    ThemeKitEntry("highContrastSegmentedOnUnderline", file: "src/styles/theme.css", selector: ":root[data-contrast='high'] .segmented .segmented-key.is-on", property: "box-shadow", kind: "shadow", css: "inset 0 -3px 0 var(--ink)", value: .shadow(highContrastSegmentedOnUnderline)),
    ThemeKitEntry("highContrastSwitchEdge", file: "src/styles/theme.css", selector: ":root[data-contrast='high'] .switch", property: "box-shadow", kind: "shadow", css: "inset 0 0 0 2px var(--muted)", value: .shadow(highContrastSwitchEdge)),
    ThemeKitEntry("highContrastSwitchFill", file: "src/styles/theme.css", selector: ":root[data-contrast='high'] .switch", property: "background", kind: "color", css: "transparent", value: .value(highContrastSwitchFill)),
    ThemeKitEntry("highContrastSwitchKnobFill", file: "src/styles/theme.css", selector: ":root[data-contrast='high'] .switch::after", property: "background", kind: "color", css: "var(--muted)", value: .value(highContrastSwitchKnobFill)),
    ThemeKitEntry("highContrastHeatCellEdge", file: "src/styles/theme.css", selector: ":root[data-contrast='high'] .heatmap-cell:not(.is-best):not([data-empty])", property: "box-shadow", kind: "shadow", css: "inset 0 0 0 1px var(--line-soft)", value: .shadow(highContrastHeatCellEdge)),
    ThemeKitEntry("highContrastBarTrackEdge", file: "src/styles/theme.css", selector: ":root[data-contrast='high'] .barlist-track", property: "box-shadow", kind: "shadow", css: "inset 0 0 0 1px var(--line-soft)", value: .shadow(highContrastBarTrackEdge)),
    ThemeKitEntry("highContrastCurrentUnderlineThickness", file: "src/styles/theme.css", selector: ":root[data-contrast='high'] .nav-link[aria-current='page']", property: "text-decoration-thickness", kind: "length", css: "2px", value: .length(highContrastCurrentUnderlineThickness)),
    ThemeKitEntry("highContrastCurrentUnderlineOffset", file: "src/styles/theme.css", selector: ":root[data-contrast='high'] .nav-link[aria-current='page']", property: "text-underline-offset", kind: "length", css: "4px", value: .length(highContrastCurrentUnderlineOffset)),
    ThemeKitEntry("highContrastCurrentTabRing", file: "src/styles/theme.css", selector: ":root[data-contrast='high'] .tabbar-item[aria-current='page']", media: "(max-width: 374px)", property: "box-shadow", kind: "shadow", css: "inset 0 0 0 2px var(--ink)", value: .shadow(highContrastCurrentTabRing)),
    ThemeKitEntry("imageLabelInkAtNight", file: "src/styles/theme.css", selector: ":root[data-theme='dark'] .image-tool", property: "color", kind: "color", css: "#ffffff", value: .value(imageLabelInkAtNight)),
    ThemeKitEntry("landingMaxWidth", file: "src/styles/app.css", selector: ".landing", property: "--landing-max", kind: "value", css: "1160px", value: .value(landingMaxWidth)),
    ThemeKitEntry("landingBarHeight", file: "src/styles/app.css", selector: ".landing-bar", property: "min-height", kind: "length", css: "44px", value: .length(landingBarHeight)),
    ThemeKitEntry("landingBarSpaceAbove", file: "src/styles/app.css", selector: ".landing-bar", property: "padding-top", kind: "length", css: "28px", value: .length(landingBarSpaceAbove)),
    ThemeKitEntry("phoneLandingBarSpaceAbove", file: "src/styles/app.css", selector: ".landing-bar", media: "(max-width: 899px)", property: "padding-top", kind: "length", css: "12px", value: .length(phoneLandingBarSpaceAbove)),
    ThemeKitEntry("landingMainSpaceAbove", file: "src/styles/app.css", selector: ".landing-main", property: "padding-top", kind: "length", css: "clamp(32px, 7svh, 72px)", value: .length(landingMainSpaceAbove)),
    ThemeKitEntry("landingEyebrowFontSize", file: "src/styles/app.css", selector: ".landing-eyebrow", property: "font-size", kind: "value", css: "var(--text-sm)", value: .value(landingEyebrowFontSize)),
    ThemeKitEntry("landingEyebrowWeight", file: "src/styles/app.css", selector: ".landing-eyebrow", property: "font-weight", kind: "number", css: "500", value: .number(landingEyebrowWeight)),
    ThemeKitEntry("landingTitleFontSize", file: "src/styles/app.css", selector: ".landing-title", property: "font-size", kind: "length", css: "clamp(2.5rem, 1.35rem + 4vw, 4.5rem)", value: .length(landingTitleFontSize)),
    ThemeKitEntry("landingTitleWeight", file: "src/styles/app.css", selector: ".landing-title", property: "font-weight", kind: "number", css: "600", value: .number(landingTitleWeight)),
    ThemeKitEntry("landingTitleTracking", file: "src/styles/app.css", selector: ".landing-title", property: "letter-spacing", kind: "length", css: "-0.04em", value: .length(landingTitleTracking)),
    ThemeKitEntry("landingTitleLineHeight", file: "src/styles/app.css", selector: ".landing-title", property: "line-height", kind: "number", css: "1.02", value: .number(landingTitleLineHeight)),
    ThemeKitEntry("landingLedeFontSize", file: "src/styles/app.css", selector: ".landing-lede", property: "font-size", kind: "value", css: "var(--text-lg)", value: .value(landingLedeFontSize)),
    ThemeKitEntry("landingLedeLineHeight", file: "src/styles/app.css", selector: ".landing-lede", property: "line-height", kind: "number", css: "1.5", value: .number(landingLedeLineHeight)),
    ThemeKitEntry("landingLedeMaxWidth", file: "src/styles/app.css", selector: ".landing-lede", property: "max-width", kind: "length", css: "52ch", value: .length(landingLedeMaxWidth)),
    ThemeKitEntry("landingPointRule", file: "src/styles/app.css", selector: ".landing-points > div", property: "border-top", kind: "border", css: "1px solid var(--rule)", value: .border(landingPointRule)),
    ThemeKitEntry("landingPointSpaceAbove", file: "src/styles/app.css", selector: ".landing-points > div", property: "padding-top", kind: "length", css: "18px", value: .length(landingPointSpaceAbove)),
    ThemeKitEntry("returnTitleFontSize", file: "src/styles/app.css", selector: ".return-title", property: "font-size", kind: "value", css: "var(--text-title)", value: .value(returnTitleFontSize)),
    ThemeKitEntry("returnTitleTracking", file: "src/styles/app.css", selector: ".return-title", property: "letter-spacing", kind: "length", css: "-0.025em", value: .length(returnTitleTracking)),
    ThemeKitEntry("returnTitleLineHeight", file: "src/styles/app.css", selector: ".return-title", property: "line-height", kind: "number", css: "1.1", value: .number(returnTitleLineHeight)),
    ThemeKitEntry("appStatusFontSize", file: "src/styles/app.css", selector: ".app-status", property: "font-size", kind: "value", css: "var(--text-lg)", value: .value(appStatusFontSize)),
    ThemeKitEntry("appStatusAnimation", file: "src/styles/app.css", selector: ".app-status", property: "animation", kind: "animation", css: "app-status-in 0.4s ease 0.5s both", value: .animation(appStatusAnimation)),
    ThemeKitEntry("sketchFigureRule", file: "src/styles/app.css", selector: ".sketch-figure", property: "border-top", kind: "border", css: "2px solid var(--line)", value: .border(sketchFigureRule)),
  ]
}
