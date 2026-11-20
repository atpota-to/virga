// Ports harness/world.js, harness/crowd.js, harness/png.js: the arithmetic they
// lean on, as V8 computes it.
//
// The made-up worlds are drawn from a seeded generator and bent with
// `Math.pow` (`rand() ** 2.4`), and the card images draw hills with
// `Math.sin`. V8 computes both with its own port of fdlibm (src/base/
// ieee754.cc), not the platform's libm: glibc's `pow` differs from it in the
// last bit for about one draw in eleven, and its `sin` for one in thirty, and
// Apple's libm differs again. A last-bit difference moves a follower's date
// across a millisecond now and then, and with it a record key, so the worlds
// would not be the web's. These are fdlibm's algorithms, operation for
// operation, so every platform gets V8's bits (checked against Node over the
// worlds' own inputs in demo-world.jsmath).

import Foundation

enum JSMath {
  // MARK: - Words of a double

  @inline(__always) static func high(_ x: Double) -> Int32 {
    Int32(bitPattern: UInt32(truncatingIfNeeded: x.bitPattern >> 32))
  }

  @inline(__always) static func low(_ x: Double) -> UInt32 {
    UInt32(truncatingIfNeeded: x.bitPattern)
  }

  @inline(__always) static func words(_ high: Int32, _ low: UInt32) -> Double {
    Double(bitPattern: UInt64(UInt32(bitPattern: high)) << 32 | UInt64(low))
  }

  @inline(__always) static func withLow(_ x: Double, _ low: UInt32) -> Double {
    words(high(x), low)
  }

  @inline(__always) static func withHigh(_ x: Double, _ high: Int32) -> Double {
    words(high, low(x))
  }

  /// `x * 2^n`, exactly (fdlibm's scalbn).
  @inline(__always) static func scalbn(_ x: Double, _ n: Int) -> Double {
    if x == 0 || !x.isFinite { return x }
    return Double(sign: .plus, exponent: n, significand: x)
  }

  // MARK: - Conversions

  /// ToInt32: what `x | 0`, `x & m` and `Math.imul` do to a number.
  static func toInt32(_ x: Double) -> Int32 {
    guard x.isFinite else { return 0 }
    let whole = x.rounded(.towardZero)
    let wrapped = whole.truncatingRemainder(dividingBy: 4_294_967_296)
    let positive = wrapped < 0 ? wrapped + 4_294_967_296 : wrapped
    return Int32(bitPattern: UInt32(positive))
  }

  /// ToUint8: what storing a number in a Uint8Array does to it.
  static func toUint8(_ x: Double) -> UInt8 {
    UInt8(truncatingIfNeeded: UInt32(bitPattern: toInt32(x)))
  }

  /// `Math.min(a, b)`: NaN wins, and -0 is below +0.
  static func min(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    if a == 0 && b == 0 { return a.sign == .minus ? a : b }
    return a < b ? a : b
  }

  /// `Math.max(a, b)`: NaN wins, and +0 is above -0.
  static func max(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    if a == 0 && b == 0 { return a.sign == .minus ? b : a }
    return a > b ? a : b
  }

  // MARK: - Math.pow

  /// `Math.pow(x, y)` and `x ** y`, as V8 computes them: its port of
  /// fdlibm's `__ieee754_pow` (src/base/ieee754.cc), which answers the
  /// ECMAScript special cases itself (a NaN exponent, and ±1 to an infinite
  /// power, are NaN) and, unlike fdlibm, divides `z·t1` by
  /// `(t1 - 2) - (w + z·w)` in its last step. That one line moves the last
  /// bit of about one result in twenty-five, so it is kept as V8 has it.
  static func pow(_ x: Double, _ y: Double) -> Double {
    ieee754Pow(x, y)
  }

  private static let bp: [Double] = [1.0, 1.5]
  private static let dpH: [Double] = [0.0, 5.849_624_872_207_641_601_56e-01]
  private static let dpL: [Double] = [0.0, 1.350_039_202_129_748_971_28e-08]
  private static let two53 = 9_007_199_254_740_992.0
  private static let huge = 1.0e300
  private static let tiny = 1.0e-300
  private static let L1 = 5.999_999_999_999_946_487_25e-01
  private static let L2 = 4.285_714_285_785_501_842_52e-01
  private static let L3 = 3.333_333_298_183_774_329_18e-01
  private static let L4 = 2.727_281_238_085_340_064_89e-01
  private static let L5 = 2.306_607_457_755_617_540_67e-01
  private static let L6 = 2.069_750_178_003_384_177_84e-01
  private static let P1 = 1.666_666_666_666_660_190_37e-01
  private static let P2 = -2.777_777_777_701_559_338_42e-03
  private static let P3 = 6.613_756_321_437_934_361_17e-05
  private static let P4 = -1.653_390_220_546_525_153_90e-06
  private static let P5 = 4.138_136_797_057_238_460_39e-08
  private static let lg2 = 6.931_471_805_599_452_862_27e-01
  private static let lg2H = 6.931_471_824_645_996_093_75e-01
  private static let lg2L = -1.904_654_299_957_768_045_25e-09
  private static let ovt = 8.008_566_259_537_294_437_2e-17
  private static let cp = 9.617_966_939_259_755_543_29e-01
  private static let cpH = 9.617_967_009_544_372_558_59e-01
  private static let cpL = -7.028_461_650_952_758_265_16e-09
  private static let ivln2 = 1.442_695_040_888_963_387_00e+00
  private static let ivln2H = 1.442_695_021_629_333_496_09e+00
  private static let ivln2L = 1.925_962_991_126_617_468_87e-08

  // V8's base::ieee754::pow (fdlibm 5.3's e_pow.c, as V8 changed it).
  private static func ieee754Pow(_ x: Double, _ y: Double) -> Double {
    var z: Double, ax: Double, zH: Double, zL: Double, pH: Double, pL: Double
    var y1: Double, t1: Double, t2: Double, r: Double, s: Double, t: Double, u: Double, v: Double, w: Double
    var i: Int32, j: Int32, k: Int32, n: Int32
    var yisint: Int32

    let hx = high(x), lx = low(x)
    let hy = high(y), ly = low(y)
    var ix = hx & 0x7fff_ffff
    let iy = hy & 0x7fff_ffff

    // y == 0: x**0 = 1
    if (UInt32(bitPattern: iy) | ly) == 0 { return 1 }
    // A NaN on either side (V8 has no `1**y = 1` before this, so 1**NaN is NaN)
    if ix > 0x7ff0_0000 || (ix == 0x7ff0_0000 && lx != 0) || iy > 0x7ff0_0000 || (iy == 0x7ff0_0000 && ly != 0) {
      return x + y
    }

    // Whether y is an odd integer when x < 0: 0 not an integer, 1 odd, 2 even.
    yisint = 0
    if hx < 0 {
      if iy >= 0x4340_0000 {
        yisint = 2
      } else if iy >= 0x3ff0_0000 {
        k = (iy >> 20) - 0x3ff
        if k > 20 {
          let jj = ly >> UInt32(52 - k)
          if (jj << UInt32(52 - k)) == ly { yisint = 2 - Int32(jj & 1) }
        } else if ly == 0 {
          let jj = iy >> (20 - k)
          if (jj << (20 - k)) == iy { yisint = 2 - (jj & 1) }
        }
      }
    }

    // Special values of y
    if ly == 0 {
      if iy == 0x7ff0_0000 {  // y is ±inf
        if ((ix &- 0x3ff0_0000) | Int32(bitPattern: lx)) == 0 {
          return y - y  // (±1)**±inf is NaN
        } else if ix >= 0x3ff0_0000 {
          return hy >= 0 ? y : 0
        } else {
          return hy < 0 ? -y : 0
        }
      }
      if iy == 0x3ff0_0000 {  // y is ±1
        return hy < 0 ? 1 / x : x
      }
      if hy == 0x4000_0000 { return x * x }  // y is 2
      if hy == 0x3fe0_0000 {  // y is 0.5
        if hx >= 0 { return x.squareRoot() }
      }
    }

    ax = Swift.abs(x)
    // Special values of x
    if lx == 0 {
      if ix == 0x7ff0_0000 || ix == 0 || ix == 0x3ff0_0000 {
        z = ax
        if hy < 0 { z = 1 / z }
        if hx < 0 {
          if ((ix &- 0x3ff0_0000) | yisint) == 0 {
            z = (z - z) / (z - z)
          } else if yisint == 1 {
            z = -z
          }
        }
        return z
      }
    }

    n = (hx >> 31) + 1

    // (x<0)**(non-int) is NaN
    if (n | yisint) == 0 { return (x - x) / (x - x) }

    s = 1
    if (n | (yisint &- 1)) == 0 { s = -1 }

    if iy > 0x41e0_0000 {  // |y| > 2**31
      if iy > 0x43f0_0000 {  // |y| > 2**64: must overflow or underflow
        if ix <= 0x3fef_ffff { return hy < 0 ? huge * huge : tiny * tiny }
        if ix >= 0x3ff0_0000 { return hy > 0 ? huge * huge : tiny * tiny }
      }
      if ix < 0x3fef_ffff { return hy < 0 ? s * huge * huge : s * tiny * tiny }
      if ix > 0x3ff0_0000 { return hy > 0 ? s * huge * huge : s * tiny * tiny }
      // |1-x| is tiny: log(x) by x - x^2/2 + x^3/3 - x^4/4
      t = ax - 1
      w = (t * t) * (0.5 - t * (3.333_333_333_333_333_1e-01 - t * 0.25))
      u = ivln2H * t
      v = t * ivln2L - w * ivln2
      t1 = u + v
      t1 = withLow(t1, 0)
      t2 = v - (t1 - u)
    } else {
      var ss: Double, s2: Double, sH: Double, sL: Double, tH: Double, tL: Double
      n = 0
      // subnormal x
      if ix < 0x0010_0000 {
        ax *= two53
        n -= 53
        ix = high(ax)
      }
      n += (ix >> 20) - 0x3ff
      j = ix & 0x000f_ffff
      ix = j | 0x3ff0_0000
      if j <= 0x3988E {
        k = 0
      } else if j < 0xBB67A {
        k = 1
      } else {
        k = 0
        n += 1
        ix -= 0x0010_0000
      }
      ax = withHigh(ax, ix)

      // ss = sH + sL = (x-1)/(x+1) or (x-1.5)/(x+1.5)
      let kk = Int(k)
      u = ax - bp[kk]
      v = 1 / (ax + bp[kk])
      ss = u * v
      sH = ss
      sH = withLow(sH, 0)
      tH = 0
      tH = withHigh(tH, ((ix >> 1) | 0x2000_0000) &+ 0x0008_0000 &+ (k << 18))
      tL = ax - (tH - bp[kk])
      sL = v * ((u - sH * tH) - sH * tL)
      // log(ax)
      s2 = ss * ss
      r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))))
      r += sL * (sH + ss)
      s2 = sH * sH
      tH = 3.0 + s2 + r
      tH = withLow(tH, 0)
      tL = r - ((tH - 3.0) - s2)
      u = sH * tH
      v = sL * tH + tL * ss
      pH = u + v
      pH = withLow(pH, 0)
      pL = v - (pH - u)
      zH = cpH * pH
      zL = cpL * pH + pL * cp + dpL[kk]
      t = Double(n)
      t1 = (((zH + zL) + dpH[kk]) + t)
      t1 = withLow(t1, 0)
      t2 = zL - (((t1 - t) - dpH[kk]) - zH)
    }

    // (y1 + y2) * (t1 + t2)
    y1 = y
    y1 = withLow(y1, 0)
    pL = (y - y1) * t1 + y * t2
    pH = y1 * t1
    z = pL + pH
    j = high(z)
    i = Int32(bitPattern: low(z))
    if j >= 0x4090_0000 {  // z >= 1024
      if ((j &- 0x4090_0000) | i) != 0 {
        return s * huge * huge
      } else if pL + ovt > z - pH {
        return s * huge * huge
      }
    } else if (j & 0x7fff_ffff) >= 0x4090_cc00 {  // z <= -1075
      if ((j &- Int32(bitPattern: 0xc090_cc00)) | i) != 0 {
        return s * tiny * tiny
      } else if pL <= z - pH {
        return s * tiny * tiny
      }
    }

    // 2**(pH + pL)
    i = j & 0x7fff_ffff
    k = (i >> 20) - 0x3ff
    n = 0
    if i > 0x3fe0_0000 {  // |z| > 0.5: n = [z + 0.5]
      n = j &+ (0x0010_0000 >> (k + 1))
      k = ((n & 0x7fff_ffff) >> 20) - 0x3ff
      t = 0
      t = withHigh(t, n & ~(0x000f_ffff >> k))
      n = ((n & 0x000f_ffff) | 0x0010_0000) >> (20 - k)
      if j < 0 { n = -n }
      pH -= t
    }
    t = pL + pH
    t = withLow(t, 0)
    u = t * lg2H
    v = (pL - (t - pH)) * lg2 + t * lg2L
    z = u + v
    w = v - (z - u)
    t = z * z
    t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))))
    r = (z * t1) / ((t1 - 2) - (w + z * w))  // sic: V8's grouping, not fdlibm's
    z = 1 - (r - z)
    j = high(z)
    j = j &+ (n << 20)
    if (j >> 20) <= 0 {
      z = scalbn(z, Int(n))  // subnormal output
    } else {
      z = withHigh(z, j)
    }
    return s * z
  }

  // MARK: - Math.sin

  /// `Math.sin(x)`, as V8 computes it: fdlibm's `sin`, with its argument
  /// reduction (`__ieee754_rem_pio2`, and `__kernel_rem_pio2` for huge
  /// arguments) and kernels.
  static func sin(_ x: Double) -> Double {
    let ix = high(x) & 0x7fff_ffff
    if ix <= 0x3fe9_21fb { return kernelSin(x, 0, 0) }
    if ix >= 0x7ff0_0000 { return x - x }
    let (n, y0, y1) = remPio2(x)
    switch n & 3 {
    case 0: return kernelSin(y0, y1, 1)
    case 1: return kernelCos(y0, y1)
    case 2: return -kernelSin(y0, y1, 1)
    default: return -kernelCos(y0, y1)
    }
  }

  private static let S1 = -1.666_666_666_666_663_243_48e-01
  private static let S2 = 8.333_333_333_322_489_461_24e-03
  private static let S3 = -1.984_126_982_985_794_931_34e-04
  private static let S4 = 2.755_731_370_707_006_767_89e-06
  private static let S5 = -2.505_076_025_340_686_341_95e-08
  private static let S6 = 1.589_690_995_211_550_102_21e-10

  private static func kernelSin(_ x: Double, _ y: Double, _ iy: Int) -> Double {
    let ix = high(x) & 0x7fff_ffff
    if ix < 0x3e40_0000 {  // |x| < 2**-27
      if Int(x) == 0 { return x }
    }
    let z = x * x
    let v = z * x
    let r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))
    if iy == 0 { return x + v * (S1 + z * r) }
    return x - ((z * (0.5 * y - v * r) - y) - v * S1)
  }

  private static let C1 = 4.166_666_666_666_660_190_37e-02
  private static let C2 = -1.388_888_888_887_410_957_49e-03
  private static let C3 = 2.480_158_728_947_672_941_78e-05
  private static let C4 = -2.755_731_435_139_066_330_35e-07
  private static let C5 = 2.087_572_321_298_174_827_90e-09
  private static let C6 = -1.135_964_755_778_819_482_65e-11

  private static func kernelCos(_ x: Double, _ y: Double) -> Double {
    let ix = high(x) & 0x7fff_ffff
    if ix < 0x3e40_0000 {
      if Int(x) == 0 { return 1 }
    }
    let z = x * x
    let r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
    if ix < 0x3FD3_3333 { return 1 - (0.5 * z - (z * r - x * y)) }
    let qx: Double = ix > 0x3fe9_0000 ? 0.28125 : words(ix &- 0x0020_0000, 0)
    let hz = 0.5 * z - qx
    let a = 1 - qx
    return a - (hz - (z * r - x * y))
  }

  private static let npio2HW: [Int32] = [
    0x3FF9_21FB, 0x4009_21FB, 0x4012_D97C, 0x4019_21FB, 0x401F_6A7A, 0x4022_D97C,
    0x4025_FDBB, 0x4029_21FB, 0x402C_463A, 0x402F_6A7A, 0x4031_475C, 0x4032_D97C,
    0x4034_6B9C, 0x4035_FDBB, 0x4037_8FDB, 0x4039_21FB, 0x403A_B41B, 0x403C_463A,
    0x403D_D85A, 0x403F_6A7A, 0x4040_7E4C, 0x4041_475C, 0x4042_106C, 0x4042_D97C,
    0x4043_A28C, 0x4044_6B9C, 0x4045_34AC, 0x4045_FDBB, 0x4046_C6CB, 0x4047_8FDB,
    0x4048_58EB, 0x4049_21FB,
  ]

  private static let twoOverPi: [Int32] = [
    0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C, 0x439041, 0xFE5163,
    0xABDEBB, 0xC561B7, 0x246E3A, 0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129,
    0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C, 0x7026B4, 0x5F7E41, 0x3991D6, 0x398353, 0x39F49C,
    0x845F8B, 0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D, 0x367ECF,
    0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5, 0xF17B3D, 0x0739F7, 0x8A5292,
    0xEA6BFB, 0x5FB11F, 0x8D5D08, 0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3,
    0x91615E, 0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA,
    0x73A8C9, 0x60E27B, 0xC08C6B,
  ]

  private static let invpio2 = 6.366_197_723_675_813_824_33e-01
  private static let pio2_1 = 1.570_796_326_734_125_614_17e+00
  private static let pio2_1t = 6.077_100_506_506_192_249_32e-11
  private static let pio2_2 = 6.077_100_506_303_965_976_60e-11
  private static let pio2_2t = 2.022_266_248_795_950_631_54e-21
  private static let pio2_3 = 2.022_266_248_711_166_455_80e-21
  private static let pio2_3t = 8.478_427_660_368_899_569_97e-32
  private static let two24 = 1.677_721_600_000_000_000_00e+07
  private static let twon24 = 5.960_464_477_539_062_500_00e-08

  /// fdlibm's `__ieee754_rem_pio2`: x - n·π/2 as y0 + y1, and n.
  private static func remPio2(_ x: Double) -> (Int32, Double, Double) {
    let hx = high(x)
    let ix = hx & 0x7fff_ffff
    if ix <= 0x3fe9_21fb { return (0, x, 0) }
    if ix < 0x4002_d97c {  // |x| < 3π/4: n = ±1
      if hx > 0 {
        var z = x - pio2_1
        if ix != 0x3ff9_21fb {
          let y0 = z - pio2_1t
          return (1, y0, (z - y0) - pio2_1t)
        }
        z -= pio2_2
        let y0 = z - pio2_2t
        return (1, y0, (z - y0) - pio2_2t)
      } else {
        var z = x + pio2_1
        if ix != 0x3ff9_21fb {
          let y0 = z + pio2_1t
          return (-1, y0, (z - y0) + pio2_1t)
        }
        z += pio2_2
        let y0 = z + pio2_2t
        return (-1, y0, (z - y0) + pio2_2t)
      }
    }
    if ix <= 0x4139_21fb {  // |x| ≲ 2^19·π/2: medium
      let t0 = Swift.abs(x)
      let n = Int32(t0 * invpio2 + 0.5)
      let fn = Double(n)
      var r = t0 - fn * pio2_1
      var w = fn * pio2_1t
      var y0: Double
      if n < 32 && ix != npio2HW[Int(n) - 1] {
        y0 = r - w
      } else {
        let j = ix >> 20
        y0 = r - w
        var i = j - ((high(y0) >> 20) & 0x7ff)
        if i > 16 {  // a second round, good to 118 bits
          var t = r
          w = fn * pio2_2
          r = t - w
          w = fn * pio2_2t - ((t - r) - w)
          y0 = r - w
          i = j - ((high(y0) >> 20) & 0x7ff)
          if i > 49 {  // a third, good to 151 bits
            t = r
            w = fn * pio2_3
            r = t - w
            w = fn * pio2_3t - ((t - r) - w)
            y0 = r - w
          }
        }
      }
      let y1 = (r - y0) - w
      return hx < 0 ? (-n, -y0, -y1) : (n, y0, y1)
    }
    // Huge arguments: split |x| into 24-bit pieces for __kernel_rem_pio2.
    if ix >= 0x7ff0_0000 { return (0, x - x, x - x) }
    let e0 = (ix >> 20) - 1046
    var z = words(ix &- (e0 << 20), low(x))
    var tx = [Double](repeating: 0, count: 3)
    for i in 0..<2 {
      tx[i] = Double(Int32(z))
      z = (z - tx[i]) * two24
    }
    tx[2] = z
    var nx = 3
    while tx[nx - 1] == 0 { nx -= 1 }
    let (n, y0, y1) = kernelRemPio2(tx, Int(e0), nx)
    return hx < 0 ? (-n, -y0, -y1) : (n, y0, y1)
  }

  private static let PIo2: [Double] = [
    1.570_796_251_296_997_070_31e+00, 7.549_789_415_861_596_353_35e-08,
    5.390_302_529_957_764_765_54e-15, 3.282_003_415_807_912_941_23e-22,
    1.270_655_753_080_676_073_49e-29, 1.229_333_089_811_113_289_32e-36,
    2.733_700_538_164_645_596_24e-44, 2.167_416_838_778_048_194_44e-51,
  ]

  /// fdlibm's `__kernel_rem_pio2` at double precision (prec 2), for the
  /// huge arguments only.
  private static func kernelRemPio2(_ x: [Double], _ e0: Int, _ nx: Int) -> (Int32, Double, Double) {
    let jk = 4  // init_jk[2]
    let jp = jk
    let jx = nx - 1
    var jv = (e0 - 3) / 24
    if jv < 0 { jv = 0 }
    var q0 = e0 - 24 * (jv + 1)

    var f = [Double](repeating: 0, count: 20)
    var q = [Double](repeating: 0, count: 20)
    var fq = [Double](repeating: 0, count: 20)
    var iq = [Int32](repeating: 0, count: 20)

    var j = jv - jx
    let m = jx + jk
    for i in 0...m {
      f[i] = j < 0 ? 0 : Double(twoOverPi[j])
      j += 1
    }
    for i in 0...jk {
      var fw = 0.0
      for jj in 0...jx { fw += x[jj] * f[jx + i - jj] }
      q[i] = fw
    }

    var jz = jk
    var z: Double
    var n: Int32
    var ih: Int32
    while true {
      // distill q[] into iq[] reversingly
      var i = 0
      var jj = jz
      z = q[jz]
      while jj > 0 {
        let fw = Double(Int32(twon24 * z))
        iq[i] = Int32(z - two24 * fw)
        z = q[jj - 1] + fw
        i += 1
        jj -= 1
      }
      // n
      z = scalbn(z, q0)
      z -= 8.0 * (z * 0.125).rounded(.down)
      n = Int32(z)
      z -= Double(n)
      ih = 0
      if q0 > 0 {
        let ii = iq[jz - 1] >> Int32(24 - q0)
        n += ii
        iq[jz - 1] -= ii << Int32(24 - q0)
        ih = iq[jz - 1] >> Int32(23 - q0)
      } else if q0 == 0 {
        ih = iq[jz - 1] >> 23
      } else if z >= 0.5 {
        ih = 2
      }

      if ih > 0 {  // q > 0.5
        n += 1
        var carry: Int32 = 0
        for ii in 0..<jz {
          let jw = iq[ii]
          if carry == 0 {
            if jw != 0 {
              carry = 1
              iq[ii] = 0x100_0000 - jw
            }
          } else {
            iq[ii] = 0xff_ffff - jw
          }
        }
        if q0 > 0 {
          switch q0 {
          case 1: iq[jz - 1] &= 0x7f_ffff
          case 2: iq[jz - 1] &= 0x3f_ffff
          default: break
          }
        }
        if ih == 2 {
          z = 1 - z
          if carry != 0 { z -= scalbn(1, q0) }
        }
      }

      // recompute if needed
      if z == 0 {
        var jw: Int32 = 0
        var ii = jz - 1
        while ii >= jk {
          jw |= iq[ii]
          ii -= 1
        }
        if jw == 0 {
          var k = 1
          while iq[jk - k] == 0 { k += 1 }
          for ii in (jz + 1)...(jz + k) {
            f[jx + ii] = Double(twoOverPi[jv + ii])
            var fw = 0.0
            for jj in 0...jx { fw += x[jj] * f[jx + ii - jj] }
            q[ii] = fw
          }
          jz += k
          continue
        }
      }
      break
    }

    // chop off zero terms
    if z == 0 {
      jz -= 1
      q0 -= 24
      while iq[jz] == 0 {
        jz -= 1
        q0 -= 24
      }
    } else {
      z = scalbn(z, -q0)
      if z >= two24 {
        let fw = Double(Int32(twon24 * z))
        iq[jz] = Int32(z - two24 * fw)
        jz += 1
        q0 += 24
        iq[jz] = Int32(fw)
      } else {
        iq[jz] = Int32(z)
      }
    }

    // integer chunks to floating point
    var fw = scalbn(1, q0)
    var i = jz
    while i >= 0 {
      q[i] = fw * Double(iq[i])
      fw *= twon24
      i -= 1
    }

    // PIo2[0...jp] * q[jz...0]
    i = jz
    while i >= 0 {
      var sum = 0.0
      var k = 0
      while k <= jp && k <= jz - i {
        sum += PIo2[k] * q[i + k]
        k += 1
      }
      fq[jz - i] = sum
      i -= 1
    }

    // compress fq[] into y[]
    var sum = 0.0
    i = jz
    while i >= 0 {
      sum += fq[i]
      i -= 1
    }
    let y0 = ih == 0 ? sum : -sum
    sum = fq[0] - sum
    if jz >= 1 {
      for ii in 1...jz { sum += fq[ii] }
    }
    let y1 = ih == 0 ? sum : -sum
    return (n & 7, y0, y1)
  }
}
