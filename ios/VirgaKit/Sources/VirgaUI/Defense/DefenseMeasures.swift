// Ports src/defense/defense.css (its measures)
//
// The measures of Defense's stylesheet, which ThemeKit doesn't read yet,
// each named once with the rule it comes from (Theme/Measures.swift says
// why). Lengths are points (CSS px; a rem is 16). The radar's own lengths
// are in its drawing's units, a square 1000 across, as Radar.jsx's SVG
// draws them.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

extension Measure {
  public enum Defense {
    /// `.defense-field, .defense-band-list, .defense-add-form, … { max-width: 44rem }`
    public static let columnMax: CGFloat = 704
    /// `.defense-band { grid-template-columns: 10rem 1fr }`, `.defense-band dt { gap: 10px }`
    public static let bandLabel: CGFloat = 160
    public static let bandLabelGap: CGFloat = 10
    /// `.defense-row-band { width: 14px }`
    public static let rowBand: CGFloat = 14
    /// `.band-mark { width: 12px }`
    public static let bandMark: CGFloat = 12
    /// `.defense-post-main { gap: 2px }`
    public static let postGap: CGFloat = 2
    /// `.defense-confirm { max-width: 34rem }`
    public static let confirmMax: CGFloat = 544
    /// `.defense-new-list { grid-template-columns: 1fr 12rem }`
    public static let selectColumn: CGFloat = 192
    /// `.defense-keep-form { grid-template-columns: 14rem 1fr auto }`
    public static let keepColumn: CGFloat = 224
    /// `.defense-band-never { padding: var(--row-pad) 0 0 26px }`
    public static let neverInset: CGFloat = 26
    /// `.defense-band-tick { gap: 2px 10px }`
    public static let tickGap: CGFloat = 10
    /// `.defense-list-main { gap: 3px }`, `.defense-list-name { gap: 6px }`
    public static let listMainGap: CGFloat = 3
    public static let listNameGap: CGFloat = 6
    /// `.defense-moderator .field { max-width: 22rem }`
    public static let moderatorField: CGFloat = 352
    /// `.defense-link-code code { padding: 8px 14px; font-size: 1.125rem; letter-spacing: 0.06em }`
    public static let codePaddingV: CGFloat = 8
    public static let codePaddingH: CGFloat = 14
    public static let codeSize: CGFloat = 18
    public static let codeTracking: CGFloat = 0.06

    // The radar.
    /// `.radar { max-width: 600px }`
    public static let radarMax: CGFloat = 600
    /// Radar.jsx's `SIZE`: the drawing's own square.
    public static let radarSize: Double = 1000
    /// `HIT_PX`: how far a finger may be from a mark and still be on it.
    public static let radarHit: Double = 12
    /// `reachFor(count)`: the circle's radius as a share of the square.
    public static func radarReach(_ sectors: Int) -> Double { sectors == 4 ? 0.43 : 0.38 }
    /// `.radar-edge, .radar-axis { stroke-width: 2 }`, `.radar-edge--protected { stroke-dasharray: 6 8 }`
    public static let radarLine: Double = 2
    public static let radarProtectedDash: [CGFloat] = [6, 8]
    /// `.radar-mark[data-band='PROTECTED'] { stroke-width: 3 }`, the picked and hover rings' 3.
    public static let radarRing: Double = 3
    /// `Mark`: 8 for the connected, 7 for the rest; the protected 1 less; the diamond 1.5 more.
    public static let radarMarkConnected: Double = 8
    public static let radarMark: Double = 7
    /// The strangers' texture, 5 across; the hover ring 15; the picked ring 6 out; You's dot 7.
    public static let radarDust: Double = 5
    public static let radarHover: Double = 15
    public static let radarPickedOut: Double = 6
    public static let radarYou: Double = 7
    /// The sectors' words at `reach + 0.065` from the centre, the strangers' counts at 0.8 of it.
    public static let radarSectorOut: Double = 0.065
    public static let radarFarAt: Double = 0.8
    /// `.radar-you { transform: translate(-50%, 9px) }`
    public static let radarYouBelow: CGFloat = 9
    /// `.radar-far { padding: 1px 6px }`
    public static let radarFarPaddingV: CGFloat = 1
    public static let radarFarPaddingH: CGFloat = 6
    /// `.radar-sector { line-height: 1.2 }`
    public static let radarSectorLineHeight: Double = 1.2
    /// `.radar-callout { max-width: min(260px, 60%); padding: 9px 12px; gap: 2px; line-height: 1.35 }`, 16 from the mark.
    public static let calloutMax: CGFloat = 260
    public static let calloutShare: CGFloat = 0.6
    public static let calloutPaddingV: CGFloat = 9
    public static let calloutPaddingH: CGFloat = 12
    public static let calloutGap: CGFloat = 2
    public static let calloutLineHeight: Double = 1.35
    public static let calloutOffset: CGFloat = 16
    /// `.radar-legend { gap: 6px 20px }`, `.radar-legend li { gap: 7px }`
    public static let legendRowGap: CGFloat = 6
    public static let legendColumnGap: CGFloat = 20
    public static let legendItemGap: CGFloat = 7
  }
}
#endif
