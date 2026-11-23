# Virga on iOS: how the screens look

This is the guide for whoever builds VirgaUI. The iOS app is not a new
design: it is Virga's look, from README's "The look" and `src/styles/`, drawn
in SwiftUI. Every colour, size, weight and duration below is data in
`VirgaCore/Theme` (`ThemeTokens`, `ThemeKit`), held to the stylesheets by the
parity fixtures `ui.theme` and `ui.themeKit`, so a screen that takes its
numbers from there follows the web when the web changes. Never write a hex
code, a point size or a duration into a view: name the token.

> Quiet sky: your numbers set straight on the page, under a sky.

## Getting the tokens

```swift
let attrs = preferencesModel.rootAttributes          // sky, theme, accent, contrast, density
let theme = ThemeTokens.resolve(attrs, viewportWidth: width)  // the window's width, in points
```

`Preferences.rootAttributes` is what the web stamps on `<html>`; the model
keeps it current (the clock's sky, the system's dark and Increase Contrast).
`ThemeTokens.resolve` runs the stylesheets' cascade for it, with the phone's
media queries decided by the width, and gives a `ResolvedTheme`. Put it in the
environment at the root of the scene and re-resolve when the attributes or the
window's width change (it is cheap; cache by `(attrs, width)` if you like).

- **Colours** are `ThemeColor` (sRGB, 0–1 channels and alpha):
  `Color(.sRGB, red: c.red, green: c.green, blue: c.blue, opacity: c.alpha)`.
  `theme.bg`, `theme.ink`, `theme.accent`, `theme.chart1`, … (every token has
  a named accessor).
- **Lengths** are points: `theme.space4`, `theme.pagePad`, `theme.textBase`.
  `--measure` (54ch) is the one in the font's own unit, and a ch is the
  width of "0" in the font at the size of the text it holds, 13 for every
  line held to it (a section's sub-line, a caption, a note, a callout): use
  `theme.points(.measure, in: ThemeLengthContext(viewportWidth: width,
  chWidth: zeroWidth))`. `theme.figureSize` measures its 26cqi against the
  viewport, as CSS does with no container; inside the shell the figure size
  is the shell's own (below).
- **Lengths in em** (a heading's tracking, `ThemeKit.headingTracking`; a
  code's 0.92em) are of the text's own size, as a browser has them:
  `theme.points(of: ThemeKit.headingTracking, in: ThemeLengthContext(viewportWidth:
  width, fontSize: size))`, and the same for `.tracking()`.
- **Kit measures** (`ThemeKit`) are as the rule writes them; the ones that say
  `var()` go through the theme: `theme.points(of: ThemeKit.buttonHeight)`,
  `theme.color(of: ThemeKit.primaryButtonFill)`, `theme.resolve(_:)`.
- **A swatch** (Settings' accent choices): `ThemeTokens.swatch(.violet, in:
  attrs, viewportWidth:)` gives the tokens inside an element that shows that
  accent in the page's own theme and contrast.
- **An element that declares tokens again** (a field in trouble declares its
  focus ring in the danger colour; the shell declares `--figure-size` from
  the page's column, shell.css, whose value is VirgaUI's to write):
  `theme.declaring([(.focusRing, ThemeKit.invalidFocusRing), (.focus,
  ThemeKit.invalidFocus)])`, with `ThemeKit.highContrastInvalidFocus` for
  `.focus` in high contrast. Its own declarations follow var() on it (the
  ring in `--danger`), the rest it inherits.
- **A colour another stylesheet writes as a literal** (charts.css's tooltip
  ground, say): `ThemeColor(css: "#0f1b33")` reads hex, rgb(), rgba(),
  hsl(), hsla() and the named colours the sheets use, as a browser does.
- **The colour scheme**: `theme.colorScheme` is `.dark` at night (and only
  then); set `.preferredColorScheme` from it so system controls and the
  keyboard match.

## The page

**No boxes.** Things sit on the page itself, set apart by space and by
one-point rules: a rule in ink (`--rule`) under a section's heading, hairlines
(`--line`) between its rows. Only what floats (a menu, a dialog, a popover,
the composer) has an edge and a shadow (`--shadow-md`, `--shadow-lg`) and the
`--surface` ground (an info tip's ground is ink instead, below). Don't wrap sections in `GroupBox`, `List` insets, cards or
`Form` sections: those are boxes. A plain `ScrollView` with a `VStack` is the
page.

**The sky is the theme.** Behind every page is a wash: `--sky-top` at the top,
`--sky-mid` by `--sky-mid-at`, faded into `--bg` by `--sky-end`
(`ThemeKit.skyWash`: `linear-gradient(180deg, sky-top 0, sky-mid sky-mid-at,
bg sky-end)`). It belongs to the page's content, so it scrolls away as you
read: draw it as the background of the scroll content (a `LinearGradient`
with stops at those points, over `--bg` that continues below), not as a fixed
background. On a phone the sky is shorter (170 and 420; 460 at night). There
are four skies: dawn, day and dusk are light pages that differ only in the
wash; night is the dark theme. Settings keeps one or follows the clock
(`Sky.phaseAtHour`), and a device set to dark stays on night. The status bar
and the navigation bar take `--sky-top` (`Sky.skyColor`), so the system's
chrome runs into the wash; make the navigation bar's background clear over
the sky. High contrast has no sky: the wash is the flat ground, white or black.
The live sky (Settings › Appearance, or five taps on the mark) is the 3D
scene's sky and clouds drawn over the wash's top, in a band as tall as the
wash, moved with it (`LiveSky`, VirgaUI/Sky); never in high contrast.

**Ink does the work, sparingly.** Words are `--ink`, `--ink-2` (a label) and
`--muted` (meta, captions); `--faint` is for marks, never words. The thing to
do is filled with ink (`--btn` with `--on-btn` on it). The pressed key of a
control is ink, 600, with a line under it. The page you are on is ink, 600,
too: with a dot in the accent beside it on the sidebar's hairline rail, or
with its name on an `--accent-tint` pill in the tab bar (it is underlined
only in high contrast). Links are ink, underlined.

**The accent means one thing:** the data, or what is selected. Blue unless
Settings picks violet, teal, amber, rose or graphite; each is a full set of
steps for the light pages, night and high contrast (`ThemeTokens.accentTokens`).
The second colour (`--second*`) is the second series on a chart and a change
downward; coral beside a cool accent, blue beside amber and rose. A change
says which way it went with its sign, not whether that is good: the kit's
own (Delta) is ink, and `--up` and `--down` (the accent's ink and the second
colour's, with their washes) are set but drawn by no rule yet. States (`--ok`, `--warn`, `--danger`, each with a `-wash`) always ship
with a word or an icon beside them.

## Type

One typeface, **Instrument Sans**, in sentence case, in three weights: 400 to
read, 500 for a label, 600 for a heading or a thing that is on
(`ThemeTokens.fontWeights`). Bundle the variable font (SIL OFL; the web's copy
is `@fontsource-variable/instrument-sans`) and register it in the app; the
stack after it (`theme.sans`) is the web's fallback. Numbers are set in the
same face in its **tabular figures**, everywhere (`ThemeKit.bodyNumerals`):
`.monospacedDigit()`. Monospace (`theme.code`, `ui-monospace`) is for
identifiers only: NSIDs, DIDs, record names, at 0.92em.

| Token | Desk | Phone | For |
| --- | --- | --- | --- |
| `--text-xs` | 12 | 12 | a badge, a code under a title |
| `--text-sm` | 13 | 13 | meta lines, captions, labels, small controls |
| `--text-base` | 14 | 14 (15 at 760 and under) | the body, a row's title |
| `--text-md` | 15 | 15 | a section's title, a large control |
| `--text-lg` | 18 | 18 | a dialog's title, a lede |
| `--text-xl` | 22 | 22 | |
| `--text-2xl` | 28 | 28 | |
| `--text-3xl` | 36 | 36 | |
| `--text-title` | 32 | 28 | a page's title (600, tracking −0.025em, line 1.1) |
| `--text-figure` | 40–60 with the width | | the figure that leads a page |
| `--text-lead` | 20–24 with the width | | the statement that leads a tool |

`ThemeTokens.typeScale` lists them. Body text is `--text-base` at line height
1.45; headings are 600 with tracking −0.012em and line height 1.25. A figure's
number is `--figure-size` (500, tracking −0.04em, line height 1): inside the
app the shell works it out from the page's column (shell.css, VirgaUI), so the
same number is the same size on a dashboard, a report and the index. Use
`Font.custom(name, size: points, relativeTo:)` with the matching text style so
Dynamic Type scales the scale as a browser's text size does.

## Space, density and shape

Space is the scale `--space-1` … `--space-7`: 4, 8, 12, 16, 24, 32, 48
(`ThemeTokens.spaceScale`). Gaps are wide on purpose: space is what sets
sections apart.

Compact (Settings › Appearance) tightens what `ThemeTokens.densityTokens`
lists: the page's margin (`--page-pad`: 28–56 with the width, 24–40 compact;
20 on a phone, 16 compact), the page's top (40, 28; 8 on a phone at either
density), the space between sections (`--grid-gap`, `--section-gap`: 40, 28;
28 and 22 on a phone), a row's padding (`--row-pad` 12 → 8, `--row-pad-lg`
16 → 12) and a control's height (`--control-h` 36 → 32).

Shape: `--radius-sm` 6, `--radius` 8 (fields, menu items), `--radius-lg` 12
(a menu); buttons, chips and tokens are pills (`--pill`: `Capsule()`). A
dialog's corners and the top ones of a phone's menu sheet are 16, which the
stylesheets write as a number rather than a token (shell.css's `.dialog`,
`ThemeKit.menuSheetRadius`).

Layout: the page's column is at most `--content-max` (1040) wide plus its
margins, centred; the sidebar is `--sidebar-w` (272), the rail `--rail-w`
(72); the phone's app bar is `--appbar-h` (56) and its tab bar `--tabbar-h`
(64, plus the home indicator's room). A list led by a time keeps it in a
column `--time-col` (112) wide, so lists that share it line up.

## The controls, and what each is for

One look per job. Use these, in these places, and nothing else.

- **Button** (`Button.jsx`): a pill. *Primary* is filled with ink (its edge
  the fill's colour, as Danger's is) and is the one thing to do: New post
  (always there, in the sidebar or the tab bar), and inside a page only the
  button that confirms what you opened (a dialog, a sheet, the composer). *Quiet* (the default) is an outline in `--line-2`.
  *Ghost* has no edge until pressed: an icon alone (⋯, ✕) or the few quiet
  words that keep a button's shape (Show 10 more, Save as draft). *Danger* is a
  confirm dialog's red: `--danger` with white words by day, but at night the
  fill stays the deep red (`ThemeKit.dangerButtonFillAtNight`, `#b42318`;
  pointed at, `dangerButtonHoverFillAtNight`), since night's `--danger` is a
  light coral meant for words. Sizes: medium (`--control-h`), small 30 (the one
  labelled action of a row or a callout, words alone), large 46. An icon alone
  is a circle (`ThemeKit.iconButtonWidth`). A button that is a state
  (Following) is its word alone, quiet. Disabled is 45% opacity. SwiftUI: a
  `ButtonStyle` per tier and size, `Capsule()`, weight 500 (600 primary and
  danger).
- **Link action** (`.link-action`): every other verb, as words in ink with a
  line under them, led by a 14-point icon: Export, Show as table, Add to
  queue, Customize. It sits beside what it acts on: Export over the list it
  exports, a chart's actions under the chart (`.chart-foot`), an add at the
  head of the list it adds to. Heavier (600, a 2-point line) while what it
  opens is open.
- **More link** (`.more-link`): the way to the whole of a list, at the right
  of its heading (All scheduled, All posts), in muted words: a place to go,
  not a thing to do. A `NavigationLink`.
- **Segmented** (`Segmented.jsx`): a row of words, one pressed. The pressed
  one is ink, 600, with a 2-point line under it; no track and no chip (not
  `Picker(.segmented)`, which is a track of chips). Each key keeps the width
  of its word in bold, so pressing doesn't nudge the rest. Medium is the
  window of the whole page (the period, in its header); small narrows one list
  or one chart, over it. When it doesn't fit it scrolls sideways, without a
  scroll bar, fading the edge with more behind it (24 points), and brings the
  pressed key into view. Tabs narrow a list or a chart; nothing else is tabs.
- **Chip** (`.chip`): picks a value in a form, as one of a radio group's
  choices (a template's answers). Pressed is filled with ink. Not a filter and
  not a tag.
- **Token** (`.token`): a value that has been chosen, with a ✕ to take it back
  (a time in the weekly schedule, a language, a tag); a wrapping row of them.
- **Badge** (`.badge`): only a problem the person has to find (Didn't go out,
  Needs sign-in, This session only): warn or danger, a pill of wash with the
  words in its colour. Everything else a row says about itself is meta.
- **Meta line** (`.meta`): the small facts under a title: muted words at
  `--text-sm` with a dot between them (date · kind · counts). The dot belongs
  to the word before it, so a wrapped line never starts with one. A row's key
  fact is a step louder (`ThemeKit.metaKeyInk`, 500). A post's counts are a
  group 12 apart with no dots. What a page can touch is a meta line of icons
  and words (writing a little louder, asking for a new permission in warn).
- **Switch** (`.switch`): 40 × 24, the knob 20; `--line-2` off, the accent on
  (the knob takes `--on-accent`, which is dark at night). A `ToggleStyle`.
- **Field** (`.input`): a pale pane (`--surface` at 72%, so the sky shows
  through) with a `--line-2` edge, radius 8, `--control-h` tall; the edge goes
  `--muted` when pointed at and draws the focus ring when focused. In trouble,
  its edge and ring are danger. A text area is the same, at least 2.5 controls
  tall. A count against a limit (280 of 300) turns danger and bold past it.
  Search has its glass inside the left edge.
- **Menu** (`Menu.jsx`, the ⋯ every row and dashboard has): a short list of
  actions, anything that deletes last and in red; within one menu every item
  has an icon or none does; an item may have a hint under it. A native
  `Menu` with the destructive item last (`role: .destructive`) is right on
  iOS: the web's own phone menu rises as a sheet when it has no room beside
  its button, which is what a native menu does.
- **Dialog** (`Dialog.jsx`, shell.css `.dialog`): a title (`--text-lg`,
  600), a Close, the content, actions at the foot on the right, the confirm
  in ink. The web draws it as a modal at every width: at most 520 wide, on
  `--surface` with a `--line` edge, corners of 16 and `--shadow-lg`, over
  `--scrim`; from 560 down its buttons share the foot in equal halves, 44
  tall. On iPhone present it as a sheet. The composer fills the screen from
  640 down, with a bar of its own held at the top while the post scrolls
  under it (composer.css `.composer-bar`): Close, its title and the send
  button, where the keyboard can't cover them; the tools, Save as draft and
  Schedule stay at the foot, above the home indicator.
- **Info tip** (`InfoTip.jsx`): a small (i) beside a number that explains it:
  a popover in ink (`--btn`) with the page's colour written on it, up to 280
  wide.
- **Callout** (`.callout`): something to know before going on, with a rule
  down its side (2 points of `--line-2`, `ThemeKit.calloutEdge`); a warning
  or a failure has its colour for the rule and the words, and its wash, as
  well, since it has to be found.
- **Empty state** (`.empty-block`): one sentence, and at most one way to change
  that, a quiet button (New post, Sync now). No heading and no ink.
- **Progress** (`.progress`): a 3-point line in `--line`, filled in the accent;
  indeterminate slides a 35% fill across.
- **Avatar** 34 (24 small, 44 large), a circle; without a picture, initials in
  `--avatar-ink` on `--avatar-bg`.
- **Dot** (`.dot`): 7 points, says a state, always beside its word: ok, warn,
  danger, idle (`--faint`), current (the accent).
- **Delta** (`Delta.jsx`): a change against the window before: the figure in
  ink, 600, with its sign. No colour.
- **Figures** (`Figures.jsx`): a row of figures, each under a 2-point rule in
  `--line`: its label (`--ink-2`, 500, small), the number (`--figure-size`),
  and a note (muted, small; a delta and the words about it). Four or five to a
  row on a wide screen, two on a phone, an odd last one taking the whole row.
- **Table** (Show as table): every chart has one. No sides: an ink rule under
  the head (muted, 500, small), hairlines between rows, numbers right-aligned;
  a chosen row is tinted with `--accent-tint`, let out 10 points past the
  sides. A `Grid`.

## A page's header

The top of every page (shell.css `.page-header`): on the sky, at the page's
margin and `--page-top` down,

1. the title (`--text-title`, 600, tracking −0.025em, line height 1.1), one
   line, with at most a tool or two for the thing it names (the dashboard's ⋯)
   just after it;
2. a line saying what the page is (`--muted`, `--text-base`, at most about 68
   characters wide);
3. a quiet meta line of what the page can touch (`AccessBadge.jsx`);
4. at most one row of controls: the period (a medium Segmented) and, on a
   dashboard, Customize. On a wide screen it sits at the right of the title's
   line, level with it; when it doesn't fit, under the words. On a phone it is
   one row under the words that never wraps: the period first (scrolling
   sideways if it must), anything else at the far end.

Draw the header in the scroll content, so it sits on the sky and scrolls away
with it; keep `navigationTitle` for the back button and VoiceOver, but don't
use the system's large title (its type is not Virga's).

## A section, and a list's row

A **section** (`.card`, though it has no box) is a heading and what is under
it. The heading (`.card-head`) is a title (`--text-md`, 600) with an optional
line under it (`--muted`, small, held to `--measure`), and at the right at most
one thing: a more link, one or two link actions, a small Segmented, or a few
icon tools, on the title's baseline; 16 points to what follows. A section that
is a list or a table (`.card--flush`) has a rule in ink under its heading,
which is the top of its first row, and its rows run the section's full width.
A caption about it sits 12 under it; under a list, "Show 10 more" first and
"12 of 64" at the right. Filters for one list (search, a small Segmented,
selects) go over its heading (`.list-toolbar`).

A **row** of posts or data: `--row-pad` above and below, a hairline under it.
In order: a time in its `--time-col` column (for lists led by a time), then the
words (a title, the meta line under it), then the row's actions at the end,
centred on its first line: at most one small quiet button with words and a ⋯
that holds the rest, deleting last and in red. A setting, an account or a link
to somewhere else is the roomier row (`--row-pad-lg`). On a phone a row keeps
its width for its words: the ⋯ goes to the row's top corner, and the button
drops under the meta. A row picked out is tinted with `--accent-tint`, let out
10 points past its sides.

## Phone and desk

The web decides by the window's width, not by the kind of device, and so
should the app (an iPad held upright gets the phone's shell). The breakpoints:

| Width | What changes |
| --- | --- |
| 900 and wider | the sidebar: the six parts as words with their icons, only the part you are in opened out into its pages; no ground, on the sky; New post (ink) and Search over it; folds to a 72-point rail of icons. The page's column is centred beside it, the two held together. |
| 899 and narrower | the app bar (the mark, or ‹ the page above on an inner page; Search; the account, whose menu has Settings and Sync now), scrolling away with the sky; the tab bar along the bottom (the parts as icons, the one you are in with its name on an `--accent-tint` pill; New post as a round ink button at its end); the page's margin 20 (16 compact), its top 8, the title 28, a shorter sky. |
| 760 and narrower | body text 15. |
| 640 and narrower | the composer (and the adviser beside it) fill the screen, as a full-height sheet with Close, its title and the send button in a bar held at the top, where the keyboard can't cover them. |
| 560 and narrower | figures two to a row; a section's heading keeps one thing beside its title and puts a small Segmented under it; a list's filters stack; the page's controls go under its words; a row's ⋯ moves to its top corner. |
| 429 and narrower | the current tab is a tinted disc, its name read out but not shown. In high contrast, from 374 down, it has a 2-point ink ring (`ThemeKit.highContrastCurrentTabRing`). theme.css's comment means the ring for every disc, but its query says 374 while shell.css starts the disc at 429; that is reported to the web side, and the app follows the stylesheet until it is settled. |

In SwiftUI: from 900 a `NavigationSplitView` with Virga's own sidebar (words
on the sky, no list styling); below it a `NavigationStack` with the app bar in
the toolbar and a custom tab bar. All the token-level changes come from
`ThemeTokens.resolve(_, viewportWidth:)`; the component-level ones (560, 429)
are VirgaUI's to apply from the same width.

## Touch

Fingers get more to press whatever the size says (`@media (pointer: coarse)`,
which is every iPhone and iPad): a medium control is 40 tall
(`ThemeKit.touchButtonHeight`), a small one stays visibly small at 32 but is
pressed through a 44-point area, a ghost icon is 44 square, a field's words are
16 (smaller, and iOS zooms in), a Segmented's keys and a menu's items are 44
tall. Give every control at least a 44-point hit area with
`.contentShape` and padding, without making it look bigger.

## Focus and high contrast

Keyboard focus (an iPad with a keyboard) is an outline: 2 points of
`--focus-ring` (the accent; its lighter ink at night), 2 points outside the
control (`ThemeKit.focusOutline`, `ThemeKit.focusOutlineOffset`). A
Segmented's key, and anything in a row that scrolls sideways, draws it 2
points inside instead, so the row's clipping can't cut it off. A field draws
its focus as a shadow rather than an outline: its edge turns `--focus-ring`
and `--focus` rings it, a 1-point line in `--focus-ring` with a halo of the
same at 32% out to 4 points (`theme.focus`); a field in trouble declares both
again in `--danger` (`theme.declaring`, above). Use `.focusEffectDisabled()`
and draw these.

High contrast (`data-contrast='high'`: Settings, or the system's Increase
Contrast) gives words at 7:1 or better on every ground, solid lines and
borders at 3:1, chart colours at 4.5:1, no sky, a 3-point focus outline
(`ThemeKit.highContrastFocusOutlineWidth`), and a field's ring with a gap
inside it (`--focus`: 2 points of `--surface`, then 3 of the ring). It also
says what tokens can't (`ThemeKit.highContrast…`): a 3-point line under a
pressed key; a switch drawn as an outline (an inset 2-point edge in
`--muted`, no fill) with its knob in `--muted` at 70% of its size, and when
on, the accent's fill with the knob in `--on-accent`, still at 70% (the
`scale(0.7)` is a transform, not in ThemeKit); heat cells and bar tracks
outlined in `--line-soft`; the current page underlined (2 points, 4 below);
and a 2-point ink ring round the narrow tab bar's disc. The forced-colours
rules in theme.css are Windows' and don't apply.

## Motion

| What | Duration | Curve |
| --- | --- | --- |
| a control's colour and edge (button, chip, field, segmented key) | 0.12 s | ease |
| a switch, its knob; a disclosure's chevron | 0.15 s | the knob on `--ease`, the rest ease |
| a menu's scrim | 0.16 s | `--ease` |
| a phone's menu sheet rising | 0.2 s | `--ease`, from 24 points down |
| a progress bar filling | 0.3 s | ease |
| an indeterminate progress bar | 1.2 s, for ever | ease-in-out |
| the first "restoring" message | 0.4 s after 0.5 s | ease |

`--ease` is `cubic-bezier(0.2, 0.8, 0.2, 1)`:
`.timingCurve(0.2, 0.8, 0.2, 1, duration:)`. With Reduce Motion, none of it
moves (the web cuts every transition to 0.01 ms).

## Charts

The chart colours come with the accent: `--chart-1` (the accent's line) and
`--chart-2` (the second colour) are the only two series a chart has, held
apart for colour-blind eyes; `--chart-3` and `--chart-4` are the third and
fourth slots, which no chart uses yet; `--chart-area` is the tint under a
line; `--chart-grid` and `--chart-axis` are the chrome; `--chart-ghost` is
what must never pass for data: the dashed reach from a line's end to a value
it can't arrive at itself (the followers chart's reach to the profile's own
count) and the Defense radar's dust; `--heat-0` (nothing) to `--heat-6` is a
heatmap's ramp. Every chart has a table, and hover (a press on
iOS) shows a value. The tooltip's own ground is charts.css's (dark by day,
light at night); `--second-tip` is the second series' colour on it.

## Where it comes from

| | |
| --- | --- |
| The tokens | `src/styles/theme.css` → `ThemeTokens.blocks` (`ThemeTokens+Blocks.swift`) |
| The cascade | `ThemeTokens.resolve`, `ThemeTokens.swatch`, `ResolvedTheme` (`ThemeTokens+Cascade.swift`) |
| The kit's measures | `base.css`, `controls.css`, `app.css`, theme.css's last rules → `ThemeKit` (`ThemeTokens+Kit.swift`, listed in `ios/parity/cases/_themeKit.js`) |
| The components | `src/components/*.jsx`, `src/styles/controls.css`, `src/shell/shell.css` → VirgaUI (wave 4) |

When a stylesheet changes, `npm run parity:write` makes `ui.theme` or
`ui.themeKit` stale, `swift test` says which token or measure moved, and
`node ios/scripts/generate-theme-tokens.mjs` rewrites the Swift tables. A new
measure for the kit is a line in `_themeKit.js`.
