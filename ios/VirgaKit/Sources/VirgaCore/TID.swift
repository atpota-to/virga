// Ports src/posting/lib/tid.js
//
// Record keys for new posts: TIDs (https://atproto.com/specs/tid), minted so
// a write can be retried under the same key without posting twice. A TID is
// 64 bits (a zero, 53 bits of microseconds since the epoch, 10 bits of clock
// id) written in base32-sortable as 13 characters, so keys sort in the order
// they were minted.

import Foundation

public enum TID {
  static let alphabet = Array("234567abcdefghijklmnopqrstuvwxyz")

  /// The 13-character TID for `micros` and `clockId` (0..<1024).
  public static func encode(micros: UInt64, clockId: UInt64) -> String {
    var n = (micros << 10) | (clockId & 1023)
    var out = [Character](repeating: "2", count: 13)
    for i in stride(from: 12, through: 0, by: -1) {
      out[i] = alphabet[Int(n & 31)]
      n >>= 5
    }
    return String(out)
  }

  /// Whether `rkey` is a well-formed TID.
  public static func isTid(_ rkey: String?) -> Bool {
    guard let rkey else { return false }
    let chars = Array(rkey.unicodeScalars)
    guard chars.count == 13 else { return false }
    let first = "234567abcdefghij".unicodeScalars
    let rest = "234567abcdefghijklmnopqrstuvwxyz".unicodeScalars
    guard first.contains(chars[0]) else { return false }
    return chars.dropFirst().allSatisfy { rest.contains($0) }
  }

  /// The time a TID was minted, in milliseconds, or nil for a non-TID.
  public static func tidTimestamp(_ rkey: String?) -> Int64? {
    guard let rkey, isTid(rkey) else { return nil }
    var n: UInt64 = 0
    for ch in rkey {
      guard let index = alphabet.firstIndex(of: ch) else { return nil }
      n = n * 32 + UInt64(index)
    }
    return Int64((n >> 10) / 1000)
  }
}

/// A TID minter whose keys always increase, even for the same or an earlier
/// time, so a batch minted in one loop is in order. The web app's
/// `createTidClock`; `TIDClock.shared` is its `nextTid`.
public final class TIDClock: @unchecked Sendable {
  public static let shared = TIDClock()

  private let lock = NSLock()
  private var lastMicros: UInt64 = 0
  private let clockId: UInt64

  public init(clockId: UInt64 = UInt64.random(in: 0..<1024)) {
    self.clockId = clockId & 1023
  }

  /// A fresh TID for `date` (default now).
  public func next(_ date: Date = Date()) -> String {
    let micros = UInt64(max(0, date.timeIntervalSince1970 * 1_000_000))
    lock.lock()
    defer { lock.unlock() }
    var value = micros
    if value <= lastMicros { value = lastMicros + 1 }
    lastMicros = value
    return TID.encode(micros: value, clockId: clockId)
  }

  /// A fresh TID for a time in epoch milliseconds.
  public func next(ms: Double) -> String {
    next(Date(timeIntervalSince1970: ms / 1000))
  }
}
