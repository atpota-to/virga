// Ports src/posting/timers/selfDestruct.js
//
// `Array.prototype.sort(compare)` exactly as V8 runs it (third_party/v8/
// builtins/array-sort.tq): TimSort, with natural runs extended to a minimum
// run by binary insertion, a stack of pending runs kept in balance, and
// merges that gallop when one run keeps winning. selfDestruct.js sorts with
// comparators that aren't a consistent order (compareTimers calls a row
// whose time can't be read equal to everything), and for those the order
// V8 leaves depends on every comparison it happens to make, so the port
// makes the same comparisons, in the same order, on the same elements.
// The server's timer list runs to a hundred rows and more, well past the
// 64 below which V8 only binary-inserts. Internal.

import Foundation

extension TimerJS {
  /// `[...items].sort(compare)` as V8 sorts it. A comparator's NaN is 0,
  /// as V8 reads it.
  static func v8Sorted<T>(_ items: [T], by compare: (T, T) -> Double) -> [T] {
    if items.count < 2 { return items }
    return withoutActuallyEscaping(compare) { compare in
      var sort = V8TimSort(work: items, compare: compare)
      sort.run()
      return sort.work
    }
  }
}

/// One run of V8's ArrayTimSortImpl over `work`.
struct V8TimSort<T> {
  var work: [T]
  let compare: (T, T) -> Double
  /// The pending runs: (base, length), bottom of the stack first.
  var runs: [(base: Int, length: Int)] = []
  /// kMinGallopWins, adapted as the merges go.
  var minGallop = V8TimSort.minGallopWins

  static var minGallopWins: Int { 7 }

  init(work: [T], compare: @escaping (T, T) -> Double) {
    self.work = work
    self.compare = compare
  }

  func cmp(_ x: T, _ y: T) -> Double {
    let v = compare(x, y)
    return v.isNaN ? 0 : v
  }

  mutating func run() {
    let length = work.count
    if length < 2 { return }
    var remaining = length
    var low = 0
    let minRunLength = Self.computeMinRunLength(remaining)
    while remaining != 0 {
      var currentRunLength = countAndMakeRun(low, low + remaining)
      // A short run is extended to min(minRunLength, remaining).
      if currentRunLength < minRunLength {
        let forcedRunLength = min(minRunLength, remaining)
        binaryInsertionSort(low, low + currentRunLength, low + forcedRunLength)
        currentRunLength = forcedRunLength
      }
      runs.append((low, currentRunLength))
      mergeCollapse()
      low += currentRunLength
      remaining -= currentRunLength
    }
    mergeForceCollapse()
  }

  /// n itself under 64; else n's top six bits, plus one if any bit below
  /// them is set.
  static func computeMinRunLength(_ nArg: Int) -> Int {
    var n = nArg
    var r = 0
    while n >= 64 {
      r |= n & 1
      n >>= 1
    }
    return n + r
  }

  /// The length of the run that starts at `lowArg` (ending before `high`),
  /// reversed in place when it descends.
  mutating func countAndMakeRun(_ lowArg: Int, _ high: Int) -> Int {
    let low = lowArg + 1
    if low == high { return 1 }
    var runLength = 2
    let isDescending = cmp(work[low], work[low - 1]) < 0
    var previous = work[low]
    var idx = low + 1
    while idx < high {
      let current = work[idx]
      let order = cmp(current, previous)
      if isDescending {
        if order >= 0 { break }
      } else {
        if order < 0 { break }
      }
      previous = current
      runLength += 1
      idx += 1
    }
    if isDescending { work[lowArg..<(lowArg + runLength)].reverse() }
    return runLength
  }

  /// Sorts [low, high), [low, startArg) being sorted already.
  mutating func binaryInsertionSort(_ low: Int, _ startArg: Int, _ high: Int) {
    var start = low == startArg ? startArg + 1 : startArg
    while start < high {
      var left = low
      var right = start
      let pivot = work[start]
      while left < right {
        let mid = left + ((right - left) >> 1)
        if cmp(pivot, work[mid]) < 0 { right = mid } else { left = mid + 1 }
      }
      var p = start
      while p > left {
        work[p] = work[p - 1]
        p -= 1
      }
      work[left] = pivot
      start += 1
    }
  }

  /// run_length(n - 2) > run_length(n - 1) + run_length(n).
  func runInvariantEstablished(_ n: Int) -> Bool {
    if n < 2 { return true }
    return runs[n - 2].length > runs[n - 1].length + runs[n].length
  }

  mutating func mergeCollapse() {
    while runs.count > 1 {
      var n = runs.count - 2
      if !runInvariantEstablished(n + 1) || !runInvariantEstablished(n) {
        if runs[n - 1].length < runs[n + 1].length { n -= 1 }
        mergeAt(n)
      } else if runs[n].length <= runs[n + 1].length {
        mergeAt(n)
      } else {
        break
      }
    }
  }

  mutating func mergeForceCollapse() {
    while runs.count > 1 {
      var n = runs.count - 2
      if n > 0 && runs[n - 1].length < runs[n + 1].length { n -= 1 }
      mergeAt(n)
    }
  }

  /// Merges the runs at stack indices i and i + 1.
  mutating func mergeAt(_ i: Int) {
    let stackSize = runs.count
    var baseA = runs[i].base
    var lengthA = runs[i].length
    let baseB = runs[i + 1].base
    var lengthB = runs[i + 1].length
    runs[i].length = lengthA + lengthB
    if i == stackSize - 3 { runs[i + 1] = runs[i + 2] }
    runs.removeLast()

    // Where does b start in a? What comes before is in place already.
    let k = gallopRight(work, work[baseB], baseA, lengthA, 0)
    baseA += k
    lengthA -= k
    if lengthA == 0 { return }
    // Where does a end in b? What comes after is in place already.
    lengthB = gallopLeft(work, work[baseA + lengthA - 1], baseB, lengthB, lengthB - 1)
    if lengthB == 0 { return }
    if lengthA <= lengthB {
      mergeLow(baseA, lengthA, baseB, lengthB)
    } else {
      mergeHigh(baseA, lengthA, baseB, lengthB)
    }
  }

  /// k such that array[base + k - 1] < key <= array[base + k], searched
  /// from `hint`.
  func gallopLeft(_ array: [T], _ key: T, _ base: Int, _ length: Int, _ hint: Int) -> Int {
    var lastOfs = 0
    var offset = 1
    var order = cmp(array[base + hint], key)
    if order < 0 {
      // a[hint] < key: gallop right.
      let maxOfs = length - hint
      while offset < maxOfs {
        order = cmp(array[base + hint + offset], key)
        if order >= 0 { break }
        lastOfs = offset
        offset = (offset << 1) + 1
      }
      if offset > maxOfs { offset = maxOfs }
      lastOfs += hint
      offset += hint
    } else {
      // key <= a[hint]: gallop left.
      let maxOfs = hint + 1
      while offset < maxOfs {
        order = cmp(array[base + hint - offset], key)
        if order < 0 { break }
        lastOfs = offset
        offset = (offset << 1) + 1
      }
      if offset > maxOfs { offset = maxOfs }
      let tmp = lastOfs
      lastOfs = hint - offset
      offset = hint - tmp
    }
    lastOfs += 1
    while lastOfs < offset {
      let m = lastOfs + ((offset - lastOfs) >> 1)
      order = cmp(array[base + m], key)
      if order < 0 { lastOfs = m + 1 } else { offset = m }
    }
    return offset
  }

  /// k such that array[base + k - 1] <= key < array[base + k], searched
  /// from `hint`.
  func gallopRight(_ array: [T], _ key: T, _ base: Int, _ length: Int, _ hint: Int) -> Int {
    var lastOfs = 0
    var offset = 1
    var order = cmp(key, array[base + hint])
    if order < 0 {
      // key < a[hint]: gallop left.
      let maxOfs = hint + 1
      while offset < maxOfs {
        order = cmp(key, array[base + hint - offset])
        if order >= 0 { break }
        lastOfs = offset
        offset = (offset << 1) + 1
      }
      if offset > maxOfs { offset = maxOfs }
      let tmp = lastOfs
      lastOfs = hint - offset
      offset = hint - tmp
    } else {
      // a[hint] <= key: gallop right.
      let maxOfs = length - hint
      while offset < maxOfs {
        order = cmp(key, array[base + hint + offset])
        if order < 0 { break }
        lastOfs = offset
        offset = (offset << 1) + 1
      }
      if offset > maxOfs { offset = maxOfs }
      lastOfs += hint
      offset += hint
    }
    lastOfs += 1
    while lastOfs < offset {
      let m = lastOfs + ((offset - lastOfs) >> 1)
      order = cmp(key, array[base + m])
      if order < 0 { offset = m } else { lastOfs = m + 1 }
    }
    return offset
  }

  /// `Copy` within `work`, as memmove: overlapping ranges come out right.
  mutating func move(_ from: Int, _ to: Int, _ count: Int) {
    if count <= 0 { return }
    let items = Array(work[from..<(from + count)])
    work.replaceSubrange(to..<(to + count), with: items)
  }

  enum MergeEnd { case succeed, copyRest }

  /// Merges the lengthA elements at baseA with the lengthB at baseB
  /// (baseA + lengthA == baseB, lengthA <= lengthB), front to back, run A
  /// in a temporary array.
  mutating func mergeLow(_ baseA: Int, _ lengthAArg: Int, _ baseB: Int, _ lengthBArg: Int) {
    var lengthA = lengthAArg
    var lengthB = lengthBArg
    let temp = Array(work[baseA..<(baseA + lengthA)])
    var dest = baseA
    var cursorTemp = 0
    var cursorB = baseB

    work[dest] = work[cursorB]
    dest += 1
    cursorB += 1

    func merge(_ s: inout V8TimSort) -> MergeEnd {
      lengthB -= 1
      if lengthB == 0 { return .succeed }
      if lengthA == 1 { return .copyRest }
      var minGallop = s.minGallop
      while true {
        var nofWinsA = 0
        var nofWinsB = 0
        // One at a time, until one run seems to win every time.
        while true {
          let order = s.cmp(s.work[cursorB], temp[cursorTemp])
          if order < 0 {
            s.work[dest] = s.work[cursorB]
            dest += 1
            cursorB += 1
            nofWinsB += 1
            lengthB -= 1
            nofWinsA = 0
            if lengthB == 0 { return .succeed }
            if nofWinsB >= minGallop { break }
          } else {
            s.work[dest] = temp[cursorTemp]
            dest += 1
            cursorTemp += 1
            nofWinsA += 1
            lengthA -= 1
            nofWinsB = 0
            if lengthA == 1 { return .copyRest }
            if nofWinsA >= minGallop { break }
          }
        }
        // Gallop, until neither run wins consistently any more.
        minGallop += 1
        var firstIteration = true
        while nofWinsA >= Self.minGallopWins || nofWinsB >= Self.minGallopWins || firstIteration {
          firstIteration = false
          minGallop = max(1, minGallop - 1)
          s.minGallop = minGallop

          nofWinsA = s.gallopRight(temp, s.work[cursorB], cursorTemp, lengthA, 0)
          if nofWinsA > 0 {
            s.work.replaceSubrange(dest..<(dest + nofWinsA), with: temp[cursorTemp..<(cursorTemp + nofWinsA)])
            dest += nofWinsA
            cursorTemp += nofWinsA
            lengthA -= nofWinsA
            if lengthA == 1 { return .copyRest }
            // Impossible for a consistent comparator, but not assumed.
            if lengthA == 0 { return .succeed }
          }
          s.work[dest] = s.work[cursorB]
          dest += 1
          cursorB += 1
          lengthB -= 1
          if lengthB == 0 { return .succeed }

          nofWinsB = s.gallopLeft(s.work, temp[cursorTemp], cursorB, lengthB, 0)
          if nofWinsB > 0 {
            s.move(cursorB, dest, nofWinsB)
            dest += nofWinsB
            cursorB += nofWinsB
            lengthB -= nofWinsB
            if lengthB == 0 { return .succeed }
          }
          s.work[dest] = temp[cursorTemp]
          dest += 1
          cursorTemp += 1
          lengthA -= 1
          if lengthA == 1 { return .copyRest }
        }
        // Penalized for leaving galloping mode.
        minGallop += 1
        s.minGallop = minGallop
      }
    }

    switch merge(&self) {
    case .succeed:
      if lengthA > 0 {
        work.replaceSubrange(dest..<(dest + lengthA), with: temp[cursorTemp..<(cursorTemp + lengthA)])
      }
    case .copyRest:
      // The last element of run A belongs at the end of the merge.
      move(cursorB, dest, lengthB)
      work[dest + lengthB] = temp[cursorTemp]
    }
  }

  /// Merges the lengthA elements at baseA with the lengthB at baseB
  /// (lengthA >= lengthB), back to front, run B in a temporary array.
  mutating func mergeHigh(_ baseA: Int, _ lengthAArg: Int, _ baseB: Int, _ lengthBArg: Int) {
    var lengthA = lengthAArg
    var lengthB = lengthBArg
    let temp = Array(work[baseB..<(baseB + lengthB)])
    var dest = baseB + lengthB - 1
    var cursorTemp = lengthB - 1
    var cursorA = baseA + lengthA - 1

    work[dest] = work[cursorA]
    dest -= 1
    cursorA -= 1

    func merge(_ s: inout V8TimSort) -> MergeEnd {
      lengthA -= 1
      if lengthA == 0 { return .succeed }
      if lengthB == 1 { return .copyRest }
      var minGallop = s.minGallop
      while true {
        var nofWinsA = 0
        var nofWinsB = 0
        while true {
          let order = s.cmp(temp[cursorTemp], s.work[cursorA])
          if order < 0 {
            s.work[dest] = s.work[cursorA]
            dest -= 1
            cursorA -= 1
            nofWinsA += 1
            lengthA -= 1
            nofWinsB = 0
            if lengthA == 0 { return .succeed }
            if nofWinsA >= minGallop { break }
          } else {
            s.work[dest] = temp[cursorTemp]
            dest -= 1
            cursorTemp -= 1
            nofWinsB += 1
            lengthB -= 1
            nofWinsA = 0
            if lengthB == 1 { return .copyRest }
            if nofWinsB >= minGallop { break }
          }
        }
        minGallop += 1
        var firstIteration = true
        while nofWinsA >= Self.minGallopWins || nofWinsB >= Self.minGallopWins || firstIteration {
          firstIteration = false
          minGallop = max(1, minGallop - 1)
          s.minGallop = minGallop

          var k = s.gallopRight(s.work, temp[cursorTemp], baseA, lengthA, lengthA - 1)
          nofWinsA = lengthA - k
          if nofWinsA > 0 {
            dest -= nofWinsA
            cursorA -= nofWinsA
            s.move(cursorA + 1, dest + 1, nofWinsA)
            lengthA -= nofWinsA
            if lengthA == 0 { return .succeed }
          }
          s.work[dest] = temp[cursorTemp]
          dest -= 1
          cursorTemp -= 1
          lengthB -= 1
          if lengthB == 1 { return .copyRest }

          k = s.gallopLeft(temp, s.work[cursorA], 0, lengthB, lengthB - 1)
          nofWinsB = lengthB - k
          if nofWinsB > 0 {
            dest -= nofWinsB
            cursorTemp -= nofWinsB
            s.work.replaceSubrange(
              (dest + 1)..<(dest + 1 + nofWinsB), with: temp[(cursorTemp + 1)..<(cursorTemp + 1 + nofWinsB)])
            lengthB -= nofWinsB
            if lengthB == 1 { return .copyRest }
            // Impossible for a consistent comparator, but not assumed.
            if lengthB == 0 { return .succeed }
          }
          s.work[dest] = s.work[cursorA]
          dest -= 1
          cursorA -= 1
          lengthA -= 1
          if lengthA == 0 { return .succeed }
        }
        minGallop += 1
        s.minGallop = minGallop
      }
    }

    switch merge(&self) {
    case .succeed:
      if lengthB > 0 {
        work.replaceSubrange((dest - (lengthB - 1))..<(dest + 1), with: temp[0..<lengthB])
      }
    case .copyRest:
      // The first element of run B belongs at the front of the merge.
      dest -= lengthA
      cursorA -= lengthA
      move(cursorA + 1, dest + 1, lengthA)
      work[dest] = temp[cursorTemp]
    }
  }
}
