// Ports src/hillside/scene.js (the sky's ShaderMaterial)
// Ports src/hillside/land.js (the land's ShaderMaterial)
// Ports src/hillside/clouds.js (puffMaterial)
// Ports src/hillside/hillside.css (.live-sky and .live-sky-scene: the band's filter, mask and blend)
//
// The hillside's GLSL, in the Metal Shading Language. VirgaUI compiles
// this at run time (`device.makeLibrary(source:options:)`), so the package
// has no .metal file to build; it is a plain string here so a Linux test
// can hold the uniforms' packing (HillsideUniforms) to the structs it
// declares. Line for line the web's shaders, with three changes a GPU
// without WebGL's habits needs:
//
// - GLSL's smoothstep with its edges either way round (the web's
//   `smoothstep(0.0, -0.02, y)`) is `hill_smooth`, the formula browsers
//   compute, since Metal leaves reversed edges undefined;
// - pow() is given at least 1e-6 rather than 0, which Metal's fast pow
//   leaves undefined; asin is given at most 1;
// - the puffs sample their noise before they can be discarded, as Metal
//   wants a sample with implicit derivatives in uniform control flow.
//
// Every floating literal is written as a float (`0.5f`), so no overload of
// max, pow or mix can be read as half's, and clamp(x, 0, 1) is saturate(x).
//
// The star field's hash uses precise::sin, as the web's highp sin does, so
// the stars land where they do on the web rather than where a fast sin of
// a big angle puts them.
//
// The band (`hill_band_*`) is the live sky's compositing, which the web
// leaves to CSS: the scene drained of colour, brightened and contrasted
// (`filter: grayscale(1) brightness(0.62) contrast(2.4)`, each step
// clamped as a filter's is, in sRGB), faded by the band's opacity and its
// mask, and laid on the page's wash with `screen`. The wash is drawn here
// too (the same stops as ThemeKit.skyWash), so the band comes out opaque
// and needs no compositing of its own.

import Foundation

public enum HillsideShaders {
  public static let source = #"""
    #include <metal_stdlib>
    using namespace metal;

    struct HillUniforms {
      float4x4 projection;
      float4x4 view;
      float4 cameraPos;
      float4 sunDir;
      float4 sunView;
      float4 skyTop;
      float4 skyMid;
      float4 skyLow;
      float4 skyHor;
      float4 haze;
      float4 sunCol;
      float4 landLit;
      float4 landMid;
      float4 landShade;
      float4 cloudLit;
      float4 cloudShadow;
      float4 cloudRim;
      float4 cloudFog;
      float4 cloudStorm;
      float4 wind;
      float4 params;
      float4 cloudParams;
      float4 landParams;
    };

    struct HillBand {
      float4 stops[4];
      float4 places;
      float4 mask;
      float4 maskPlaces;
      float4 tone;
      float4 grayscale;
    };

    // GLSL's smoothstep as browsers work it out, either way round.
    static float hill_smooth(float e0, float e1, float x) {
      float t = saturate((x - e0) / (e1 - e0));
      return t * t * (3.0f - 2.0f * t);
    }

    static float3 hill_mix(float3 a, float3 b, float t) {
      return mix(a, b, float3(t));
    }

    static float hill_hash(float2 p) {
      return fract(precise::sin(dot(p, float2(127.1f, 311.7f))) * 43758.5453f);
    }

    /* ---------- the sky ---------- */

    struct HillSkyOut {
      float4 position [[position]];
      float3 dir;
    };

    vertex HillSkyOut hill_sky_vertex(uint vid [[vertex_id]],
                                      const device packed_float3* positions [[buffer(0)]],
                                      constant HillUniforms& u [[buffer(1)]]) {
      float3 p = float3(positions[vid]);
      HillSkyOut out;
      out.dir = p;
      out.position = u.projection * (u.view * float4(p, 1.0f));
      return out;
    }

    fragment float4 hill_sky_fragment(HillSkyOut in [[stage_in]],
                                      constant HillUniforms& u [[buffer(1)]]) {
      // h is 0 at the horizon and 1 at the top of the frame, so the deep blue is always overhead
      float3 d = normalize(in.dir);
      float y = d.y;
      float h = max(y, 0.0f) / u.params.z;
      float3 c = hill_mix(u.skyHor.rgb, u.skyLow.rgb, hill_smooth(0.0f, 0.22f, h));
      c = hill_mix(c, u.skyMid.rgb, hill_smooth(0.18f, 0.75f, h));
      c = hill_mix(c, u.skyTop.rgb, hill_smooth(0.67f, 1.38f, h));
      if (y < 0.0f) c = hill_mix(u.skyHor.rgb, u.haze.rgb, hill_smooth(0.0f, -0.02f, y));
      float sd = max(dot(d, normalize(u.sunDir.xyz)), 0.0f);
      float glow = max(sd, 1e-6f);
      c += u.sunCol.rgb * (pow(glow, 6.0f) * 0.2f + pow(glow, 48.0f) * 0.32f);
      // the sun itself, at dawn and dusk: a warm, soft-edged disc in its own glow
      c += u.sunCol.rgb * u.params.y * (pow(glow, 900.0f) * 0.45f + hill_smooth(0.99935f, 0.9997f, sd) * 0.5f);
      // stars: the sky in squares three degrees across, a star in about one in seven, the same
      // ones every night, soft discs rather than points; fewer low down, where the air is thick
      float stars = u.params.w;
      if (stars > 0.003f && y > 0.0f) {
        float2 sq = float2(atan2(d.x, -d.z), asin(min(y, 1.0f))) * 19.1f;
        float2 id = floor(sq);
        float pick = hill_hash(id);
        float2 at = fract(sq) - 0.5f - (float2(hill_hash(id + 3.1f), hill_hash(id + 7.7f)) - 0.5f) * 0.6f;
        float size = 0.07f + 0.07f * hill_hash(id + 1.3f);
        float star = step(0.86f, pick) * hill_smooth(size, size * 0.3f, length(at));
        c += float3(0.82f, 0.88f, 1.0f) * (star * stars * (0.45f + 0.55f * hill_hash(id + 5.9f)) * hill_smooth(0.03f, 0.3f, h));
      }
      return float4(c, 1.0f);
    }

    /* ---------- the land ---------- */

    struct HillLandVertex {
      packed_float3 position;
      packed_float3 normal;
    };

    struct HillLandOut {
      float4 position [[position]];
      float3 world;
      float3 normal;
    };

    vertex HillLandOut hill_land_vertex(uint vid [[vertex_id]],
                                        const device HillLandVertex* vertices [[buffer(0)]],
                                        constant HillUniforms& u [[buffer(1)]]) {
      HillLandOut out;
      float3 w = float3(vertices[vid].position);
      out.world = w;
      out.normal = float3(vertices[vid].normal);
      out.position = u.projection * (u.view * float4(w, 1.0f));
      return out;
    }

    fragment float4 hill_land_fragment(HillLandOut in [[stage_in]],
                                       constant HillUniforms& u [[buffer(1)]],
                                       texture2d<float> noise [[texture(0)]],
                                       sampler s [[sampler(0)]]) {
      float3 N = normalize(in.normal);
      float2 p = in.world.xz;
      float3 toEye = u.cameraPos.xyz - in.world;
      float dist = length(toEye);
      float time = u.params.x;
      float2 windOff = u.wind.xy;
      float2 windDir = u.wind.zw;
      // grass catches the light softly, even a little past side-on
      float light = saturate(dot(N, u.sunDir.xyz) * 0.72f + 0.3f);
      // the shadows of clouds overhead, drifting downwind
      float2 sp = (p - windOff) * 0.0010f;
      float cl = noise.sample(s, sp).r * 0.65f + noise.sample(s, sp * 2.13f + 0.37f).r * 0.35f;
      light *= 1.0f - 0.55f * hill_smooth(0.47f, 0.58f, cl) * u.landParams.y;
      float3 col = hill_mix(u.landShade.rgb, u.landMid.rgb, hill_smooth(0.08f, 0.6f, light));
      col = hill_mix(col, u.landLit.rgb, hill_smooth(0.6f, 1.0f, light));
      // fields of it greener, or going yellow
      float n1 = noise.sample(s, p * 0.0021f + 0.11f).r;
      float n2 = noise.sample(s, p * 0.0085f + 0.53f).r;
      col *= 0.88f + 0.26f * n1;
      col = hill_mix(col, col * float3(1.14f, 1.07f, 0.6f), hill_smooth(0.5f, 0.86f, n2) * 0.32f);
      // blades up close, combed downhill; longer streaks further off
      float fine = 1.0f - hill_smooth(25.0f, 240.0f, dist);
      // two layers at odd angles and scales, so the noise never lines up into a weave
      float2 q1 = float2x2(float2(0.83f, -0.56f), float2(0.56f, 0.83f)) * p;
      float2 q2 = float2x2(float2(0.96f, 0.28f), float2(-0.28f, 0.96f)) * p;
      float g = noise.sample(s, q1 * float2(1.37f, 0.31f)).r * 0.55f + noise.sample(s, q2 * float2(0.71f, 0.173f) + 0.31f).r * 0.45f;
      float g2 = noise.sample(s, q2 * float2(0.083f, 0.027f) + 0.2f).r * 0.6f + noise.sample(s, q1 * float2(0.031f, 0.012f) + 0.6f).r * 0.4f;
      col *= mix(1.0f, 0.84f + 0.32f * g, fine) * (0.9f + 0.2f * g2);
      // seen from above, grass shows the dark between its blades; at a glance along it, its sheen
      float ndv = saturate(dot(N, normalize(toEye)));
      col *= mix(1.0f, 0.6f, hill_smooth(0.2f, 0.8f, ndv));
      // gusts: bands of wind running downwind, the grass bending over and showing its pale side
      float along = dot(p, windDir);
      float wave = sin(along * 0.065f - time * 1.25f + noise.sample(s, p * 0.0045f + float2(0.0f, time * 0.003f)).r * 8.0f);
      float gust = hill_smooth(0.45f, 1.0f, wave) * hill_smooth(0.4f, 0.68f, noise.sample(s, (p - windOff * 0.7f) * 0.0026f + 0.7f).r);
      col = hill_mix(col, u.landLit.rgb * float3(1.08f, 1.12f, 0.92f), gust * 0.26f * (1.0f - hill_smooth(500.0f, 1600.0f, dist)));
      // the air between here and there
      float fog = 1.0f - exp(-dist * u.landParams.x);
      col = hill_mix(col, u.haze.rgb, fog);
      return float4(col, 1.0f);
    }

    /* ---------- the clouds' puffs ---------- */

    struct HillPuffOut {
      float4 position [[position]];
      float2 uv;
      float4 data;
      float4 fx;
      float2 e1;
      float fog;
      float fiber;
      float flatness;
    };

    // Each puff is four float4s: where and how big, its light, shade, alpha and seed,
    // its edge's erosion (in z), and the axis it is stretched along with the stretch.
    vertex HillPuffOut hill_puff_vertex(uint vid [[vertex_id]],
                                        uint iid [[instance_id]],
                                        const device float4* puffs [[buffer(0)]],
                                        constant HillUniforms& u [[buffer(1)]]) {
      float2 corner = float2((vid & 1u) != 0u ? 1.0f : -1.0f, (vid & 2u) != 0u ? 1.0f : -1.0f);
      float4 at = puffs[iid * 4u];
      float4 data = puffs[iid * 4u + 1u];
      float4 fx = puffs[iid * 4u + 2u];
      float4 shape = puffs[iid * 4u + 3u];
      float time = u.params.x;
      float4 mv = u.view * float4(at.xyz, 1.0f);
      float r = at.w * (1.0f + 0.045f * u.cloudParams.x * sin(time * 0.8f + data.w * 40.0f));
      // the spheroid's outline on screen, in units of r: I + k a a^T, a being its axis as seen from here
      float3x3 view3 = float3x3(u.view[0].xyz, u.view[1].xyz, u.view[2].xyz);
      float2 a = (view3 * shape.xyz).xy;
      float k = shape.w * shape.w - 1.0f;
      float cxx = 1.0f + k * a.x * a.x;
      float cyy = 1.0f + k * a.y * a.y;
      float cxy = k * a.x * a.y;
      float m = 0.5f * (cxx + cyy);
      float dl = sqrt(0.25f * (cxx - cyy) * (cxx - cyy) + cxy * cxy);
      float l1 = m + dl;
      float l2 = max(m - dl, 0.0004f);
      float2 e1 = abs(cxy) > 1e-5f ? normalize(float2(l1 - cyy, cxy)) : (cxx >= cyy ? float2(1.0f, 0.0f) : float2(0.0f, 1.0f));
      float2 spread = (corner.x * sqrt(l1) * e1 + corner.y * sqrt(l2) * float2(-e1.y, e1.x)) * (r * 1.25f);
      mv.xy += spread;
      HillPuffOut out;
      out.position = u.projection * mv;
      out.uv = corner;
      out.data = data;
      out.fx = fx;
      out.e1 = e1;
      out.fiber = hill_smooth(1.7f, 3.6f, sqrt(l1 / l2));
      out.flatness = hill_smooth(0.95f, 0.45f, shape.w);
      out.fog = hill_smooth(u.cloudParams.y, u.cloudParams.z, -mv.z) * u.cloudParams.w;
      return out;
    }

    fragment float4 hill_puff_fragment(HillPuffOut in [[stage_in]],
                                       constant HillUniforms& u [[buffer(1)]],
                                       texture2d<float> noise [[texture(0)]],
                                       sampler s [[sampler(0)]]) {
      float time = u.params.x;
      // x runs along the puff's long axis: a streak's noise changes slowly along it and fast across it
      float2 nuv = in.uv * float2(0.32f, 0.32f + in.fiber * 0.9f) + in.data.w * float2(13.17f, 7.71f) + time * float2(0.006f, 0.0025f);
      float nn = noise.sample(s, nuv).r * 0.6f + noise.sample(s, nuv * 2.6f + 0.43f).r * 0.4f;
      float2 p = in.uv * 1.25f;
      float r2 = dot(p, p);
      if (r2 > 1.5625f) discard_fragment();
      float ero = in.fx.z;
      float flatness = in.flatness;
      // pancakes get softer edges, so a sheet of them melts into one
      float a = hill_smooth(0.0f, 0.42f + ero * 0.35f + flatness * 0.3f, (1.0f - r2) + (nn - 0.5f) * ero * 1.5f - ero * 0.06f);
      float alpha = a * in.data.z;
      if (alpha < 0.004f) discard_fragment();
      float2 e1 = in.e1;
      float2 ps = p.x * e1 + p.y * float2(-e1.y, e1.x);
      float z = sqrt(max(1.0f - min(r2, 1.0f), 0.0f));
      float3 N = normalize(float3(ps * 0.5f, z + 0.6f));
      float3 sunView = u.sunView.xyz;
      // mostly the cloud's own light, a little of the puff's roundness
      float L = saturate(mix(dot(N, sunView) * 0.5f + 0.5f, in.data.x, 0.75f + flatness * 0.2f) + (nn - 0.5f) * (0.2f - flatness * 0.1f));
      float3 col = hill_mix(u.cloudShadow.rgb, u.cloudLit.rgb, hill_smooth(0.0f, 0.78f, L));
      col = hill_mix(col, u.cloudStorm.rgb, in.data.y);
      float rimF = pow(max(saturate(1.0f - z), 1e-6f), 1.6f) * (1.0f - flatness * 0.75f);
      float svl = length(sunView.xy);
      float toward = svl > 0.001f ? saturate(dot(normalize(ps + 1e-4f), sunView.xy / svl)) : 0.0f;
      col += u.cloudRim.rgb * (rimF * toward * (1.0f - in.data.y * 0.7f) * (0.3f + 0.5f * saturate(-sunView.z)));
      col = hill_mix(col, u.cloudFog.rgb, in.fog);
      return float4(col * alpha, alpha);
    }

    /* ---------- the live sky's band ---------- */

    struct HillBandOut {
      float4 position [[position]];
      float y;
    };

    // One triangle over the whole band; y runs from 0 at its top to 1 at its foot.
    vertex HillBandOut hill_band_vertex(uint vid [[vertex_id]]) {
      float2 xy = float2(vid == 1u ? 3.0f : -1.0f, vid == 2u ? 3.0f : -1.0f);
      HillBandOut out;
      out.position = float4(xy, 0.0f, 1.0f);
      out.y = (1.0f - xy.y) * 0.5f;
      return out;
    }

    // The page's wash at y: its stops' colours, linear between them.
    static float3 hill_band_wash(float y, constant HillBand& b) {
      int count = int(b.mask.w);
      float3 c = b.stops[0].rgb;
      for (int i = 1; i < 4; i++) {
        if (i >= count) break;
        float p0 = b.places[i - 1];
        float p1 = b.places[i];
        if (y <= p0) break;
        float t = p1 > p0 ? saturate((y - p0) / (p1 - p0)) : 1.0f;
        c = hill_mix(b.stops[i - 1].rgb, b.stops[i].rgb, t);
      }
      return c;
    }

    // The mask's alpha at y: full at the top, mask.y by maskPlaces.y, mask.z by maskPlaces.z.
    static float hill_band_mask(float y, constant HillBand& b) {
      float mid = b.maskPlaces.y;
      float end = b.maskPlaces.z;
      if (y <= mid) return mix(b.mask.x, b.mask.y, saturate(y / max(mid, 1e-4f)));
      return mix(b.mask.y, b.mask.z, saturate((y - mid) / max(end - mid, 1e-4f)));
    }

    fragment float4 hill_band_fragment(HillBandOut in [[stage_in]],
                                       constant HillBand& b [[buffer(0)]],
                                       texture2d<float> scene [[texture(0)]]) {
      uint2 size = uint2(scene.get_width(), scene.get_height());
      uint2 px = min(uint2(in.position.xy), size - uint2(1u, 1u));
      float3 s = scene.read(px).rgb;
      // grayscale(amount), as the filter's matrix has it
      float k = 1.0f - b.grayscale.x;
      float3 toR = float3(0.2126f + 0.7874f * k, 0.7152f - 0.7152f * k, 0.0722f - 0.0722f * k);
      float3 toG = float3(0.2126f - 0.2126f * k, 0.7152f + 0.2848f * k, 0.0722f - 0.0722f * k);
      float3 toB = float3(0.2126f - 0.2126f * k, 0.7152f - 0.7152f * k, 0.0722f + 0.9278f * k);
      float3 lit = saturate(float3(dot(toR, s), dot(toG, s), dot(toB, s)));
      // brightness, then contrast
      lit = saturate(lit * b.tone.x);
      lit = saturate((lit - 0.5f) * b.tone.y + 0.5f);
      float a = b.tone.z * hill_band_mask(in.y, b);
      float3 w = hill_band_wash(in.y, b);
      // screen: the wash and the scene each through what the other leaves
      float3 screen = w + lit - w * lit;
      return float4(hill_mix(w, screen, a), 1.0f);
    }
    """#
}

/// The shaders' HillUniforms, packed from the scene's state: every member
/// a float4 or a float4x4, so the layout is the members one after another.
public enum HillsideUniforms {
  /// HillUniforms' members, in order, and the floats each takes.
  public static let fields: [(name: String, floats: Int)] = [
    ("projection", 16), ("view", 16), ("cameraPos", 4), ("sunDir", 4), ("sunView", 4), ("skyTop", 4), ("skyMid", 4),
    ("skyLow", 4), ("skyHor", 4), ("haze", 4), ("sunCol", 4), ("landLit", 4), ("landMid", 4), ("landShade", 4),
    ("cloudLit", 4), ("cloudShadow", 4), ("cloudRim", 4), ("cloudFog", 4), ("cloudStorm", 4), ("wind", 4),
    ("params", 4), ("cloudParams", 4), ("landParams", 4),
  ]

  public static var floatCount: Int { fields.reduce(0) { $0 + $1.floats } }

  /// The land's fog (`uFogDen`) and whether cloud shadows cross it (`uShadows`).
  public static let landFogDensity = 0.00021
  public static let landShadows: Double = 1

  /// The uniforms for a picture of `s`, through `projection` (the camera's,
  /// in the target's depth range and view offset).
  public static func pack(_ s: HillsideSceneState, projection: HillsideMatrix) -> [Float] {
    var out: [Float] = []
    out.reserveCapacity(floatCount)
    func add(_ m: HillsideMatrix) { out += m.elements.map { Float($0) } }
    func add(_ v: HillsideVector, _ w: Double = 0) { out += [Float(v.x), Float(v.y), Float(v.z), Float(w)] }
    func add(_ c: HillsideColor) { out += [Float(c.r), Float(c.g), Float(c.b), 1] }
    func add(_ a: Double, _ b: Double, _ c: Double, _ d: Double) { out += [Float(a), Float(b), Float(c), Float(d)] }
    add(projection)
    add(s.camera.matrixWorldInverse)
    add(s.camera.position, 1)
    add(s.sunDir)
    add(s.clouds.sunView)
    for key: HillsideColorKey in [.top, .mid, .low, .hor, .haze, .sunCol, .lit, .mid2, .shade, .cloudLit, .cloudShadow, .cloudRim, .cloudFog] {
      add(s.color(key))
    }
    add(HillsideCloudBatch.storm)
    let windDir = HillsideScene.windDir
    add(s.windOff.x, s.windOff.y, windDir.x, windDir.y)
    add(s.clock, s.disc, s.span, s.stars)
    add(s.calm ? 0 : 1, HillsideCloudBatch.fogNear, HillsideCloudBatch.fogFar, HillsideCloudBatch.fogMax)
    add(landFogDensity, landShadows, 0, 0)
    return out
  }
}

/// The shaders' HillBand: the live sky's compositing over the page's wash.
public enum HillsideBandUniforms {
  public static let fields: [(name: String, floats: Int)] = [
    ("stops", 16), ("places", 4), ("mask", 4), ("maskPlaces", 4), ("tone", 4), ("grayscale", 4),
  ]

  public static var floatCount: Int { fields.reduce(0) { $0 + $1.floats } }

  /// A stop of the wash: its colour (sRGB, 0 to 1) and where it sits, as a
  /// share of the band's height.
  public struct Stop: Hashable, Sendable {
    public var red: Double
    public var green: Double
    public var blue: Double
    public var at: Double

    public init(red: Double, green: Double, blue: Double, at: Double) {
      self.red = red
      self.green = green
      self.blue = blue
      self.at = at
    }
  }

  /// - Parameters:
  ///   - wash: the wash's stops, at most four, from the top.
  ///   - maskMidAt: `--sky-mid-at` as a share of the band's height (the
  ///     band is `--sky-end` tall, where the mask ends).
  ///   - night: the dark theme, where the scene is turned down further.
  public static func pack(wash: [Stop], maskMidAt: Double, night: Bool) -> [Float] {
    let stops = Array(wash.prefix(4))
    var out: [Float] = []
    out.reserveCapacity(floatCount)
    for index in 0..<4 {
      let stop = index < stops.count ? stops[index] : stops.last
      out += [Float(stop?.red ?? 0), Float(stop?.green ?? 0), Float(stop?.blue ?? 0), 1]
    }
    for index in 0..<4 { out.append(Float(index < stops.count ? stops[index].at : 1)) }
    let mask = HillsideStyle.liveSkyMask
    out += [Float(mask[0]), Float(mask[1]), Float(mask[2]), Float(stops.count)]
    out += [0, Float(maskMidAt), 1, 0]
    let opacity = night ? HillsideStyle.liveSkyOpacityAtNight : HillsideStyle.liveSkyOpacity
    out += [Float(HillsideStyle.liveSkyBrightness), Float(HillsideStyle.liveSkyContrast), Float(opacity), 0]
    out += [Float(HillsideStyle.liveSkyGrayscale), 0, 0, 0]
    return out
  }
}
