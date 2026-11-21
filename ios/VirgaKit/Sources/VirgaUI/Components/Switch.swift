// Ports src/styles/controls.css (.switch, .check)
// Ports src/styles/theme.css (high contrast's switch)
//
// VirgaSwitchStyle: 40 × 24, the knob 20; --line-2 off, the accent on (the
// knob takes --on-accent, which is dark at night). In high contrast it is an
// outline (an inset 2-point edge in --muted, no fill) with its knob in
// --muted at 70% of its size; on, the accent's fill with the knob in
// --on-accent, still at 70%. The knob moves on --ease.
//
// VirgaCheckStyle: a checkbox with its words beside it (`.check`), the box
// in the accent when ticked.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

public struct VirgaSwitchStyle: ToggleStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    SwitchBody(configuration: configuration)
  }
}

extension ToggleStyle where Self == VirgaSwitchStyle {
  public static var virgaSwitch: VirgaSwitchStyle { VirgaSwitchStyle() }
}

struct SwitchBody: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  let configuration: ToggleStyleConfiguration

  var body: some View {
    let on = configuration.isOn
    let width = theme.points(ThemeKit.switchWidth)
    let height = theme.points(ThemeKit.switchHeight)
    let inset = theme.points(ThemeKit.switchPadding.left)
    let knob = theme.points(ThemeKit.switchKnobSize)
    let high = theme.isHighContrast
    let scale: CGFloat = high ? Measure.Switch.highContrastKnobScale : 1
    let fill: ThemeValue = on ? ThemeKit.switchOnFill : (high ? ThemeKit.highContrastSwitchFill : ThemeKit.switchOffFill)
    let knobFill: ThemeValue = on ? ThemeKit.switchOnKnobFill : (high ? ThemeKit.highContrastSwitchKnobFill : ThemeKit.switchKnobFill)
    let edge = ThemeKit.highContrastSwitchEdge.first
    let shadow = theme.shadow(ThemeKit.switchKnobShadow)
    HStack {
      configuration.label
      Button {
        configuration.isOn.toggle()
      } label: {
        ZStack(alignment: on ? .trailing : .leading) {
          Capsule().fill(theme.color(fill))
          if high && !on, let edge {
            Capsule().strokeBorder(theme.color(edge.color ?? .color(.transparent)), lineWidth: theme.points(edge.spread ?? .px(0)))
          }
          Circle()
            .fill(theme.color(knobFill))
            .frame(width: knob, height: knob)
            .scaleEffect(scale)
            .virgaShadow(high ? VirgaShadow(color: .clear, radius: 0, x: 0, y: 0) : shadow)
            .padding(inset)
        }
        .frame(width: width, height: height)
        .animation(theme.motion.knob, value: on)
        .touchTarget()
      }
      .buttonStyle(.plain)
      .virgaFocusOutline(Capsule())
      .opacity(isEnabled ? 1 : ThemeKit.switchDisabledOpacity)
    }
    // Read as the system's own switch: its name, and on or off.
    .accessibilityRepresentation {
      Toggle(isOn: configuration.$isOn) { configuration.label }
    }
  }
}

public struct VirgaCheckStyle: ToggleStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    CheckBody(configuration: configuration)
  }
}

extension ToggleStyle where Self == VirgaCheckStyle {
  public static var virgaCheck: VirgaCheckStyle { VirgaCheckStyle() }
}

struct CheckBody: View {
  @Environment(\.virgaTheme) private var theme
  let configuration: ToggleStyleConfiguration

  var body: some View {
    let box = Measure.Legal.checkBox
    Button {
      configuration.isOn.toggle()
    } label: {
      HStack(alignment: .top, spacing: Measure.Legal.checkGap) {
        ZStack {
          RoundedRectangle(cornerRadius: theme.radiusSm / 2)
            .fill(configuration.isOn ? theme.accent : theme.surface)
          RoundedRectangle(cornerRadius: theme.radiusSm / 2)
            .strokeBorder(configuration.isOn ? theme.accent : theme.line2, lineWidth: 1)
          if configuration.isOn {
            Image(systemName: Glyph.check)
              .font(.system(size: box * 0.6, weight: .bold))
              .foregroundStyle(theme.onAccent)
          }
        }
        .frame(width: box, height: box)
        .padding(.top, Measure.Legal.checkSpaceAbove)
        configuration.label
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .frame(minHeight: Measure.Touch.target)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm))
    .accessibilityRepresentation {
      Toggle(isOn: configuration.$isOn) { configuration.label }
    }
  }
}

#Preview("Switch and check") {
  VirgaPreviewHost {
    VStack(alignment: .leading) {
      Toggle("Show the live sky", isOn: .constant(true)).toggleStyle(.virgaSwitch)
      Toggle("Also delete what it keeps in this browser", isOn: .constant(false)).toggleStyle(.virgaCheck)
    }
    .padding()
  }
}
#endif
