// `array.sort(comparefn)` as V8 runs it, for ports whose web code sorts
// with a comparator that can tie or be inconsistent (`b.count - a.count`
// over counts that may not be numbers).
//
// For a consistent comparator any stable sort gives V8's answer. For one
// that isn't (NaN, which V8 reads as 0, makes "equal" intransitive) the
// answer depends on the algorithm, so this follows V8's TimSort where it
// differs from a plain stable sort: below 64 elements V8 finds the first
// run (reversing a strictly descending one) and binary-inserts the rest,
// which is what this does. Longer arrays are merge-sorted stably, which
// matches V8 for any consistent comparator.

import Foundation

public enum JSSort {
  /// Sorts by `compare(a, b)`, a number as the JavaScript comparator
  /// returns: negative puts `a` first, NaN counts as 0.
  public static func sort<T>(_ items: [T], by compare: (T, T) -> Double) -> [T] {
    var a = items
    let n = a.count
    if n < 2 { return a }
    func cmp(_ x: T, _ y: T) -> Double {
      let v = compare(x, y)
      return v.isNaN ? 0 : v
    }
    if n >= 64 { return mergeSort(a, cmp) }

    // CountAndMakeRun
    var runLength = 2
    let descending = cmp(a[1], a[0]) < 0
    var index = 2
    while index < n {
      let order = cmp(a[index], a[index - 1])
      if descending ? order >= 0 : order < 0 { break }
      runLength += 1
      index += 1
    }
    if descending { a[0..<runLength].reverse() }

    // BinaryInsertionSort
    for start in runLength..<n {
      let pivot = a[start]
      var left = 0
      var right = start
      while left < right {
        let mid = left + ((right - left) >> 1)
        if cmp(pivot, a[mid]) < 0 { right = mid } else { left = mid + 1 }
      }
      var p = start
      while p > left {
        a[p] = a[p - 1]
        p -= 1
      }
      a[left] = pivot
    }
    return a
  }

  static func mergeSort<T>(_ items: [T], _ cmp: (T, T) -> Double) -> [T] {
    if items.count < 2 { return items }
    let mid = items.count / 2
    let left = mergeSort(Array(items[..<mid]), cmp)
    let right = mergeSort(Array(items[mid...]), cmp)
    var out: [T] = []
    out.reserveCapacity(items.count)
    var i = 0
    var j = 0
    while i < left.count && j < right.count {
      if cmp(right[j], left[i]) < 0 {
        out.append(right[j])
        j += 1
      } else {
        out.append(left[i])
        i += 1
      }
    }
    out.append(contentsOf: left[i...])
    out.append(contentsOf: right[j...])
    return out
  }
}
