// Ports harness/world.js, harness/repo.js, harness/views.js: their
// `array.sort(comparator)`, as V8 sorts.
//
// The harness sorts with comparators that never say "equal"
// (`(a, b) => (a.indexedAt < b.indexedAt ? 1 : -1)`), so two notifications
// with the same time come out in whatever order V8's sort leaves them, which
// depends on exactly which pairs it compares. A stable Swift sort would
// order them differently. This is V8's TimSort (third_party/v8/builtins/
// array-sort.tq): the same runs, binary insertion, galloping and merges, so
// the comparator is asked the same questions in the same order and any
// comparator, consistent or not, gives V8's answer.

import Foundation

extension Array {
  /// `array.sort(compare)` as V8 does it. `compare` returns what the JS
  /// comparator would (NaN reads as 0).
  func jsSorted(by compare: (Element, Element) -> Double) -> [Element] {
    withoutActuallyEscaping(compare) { compare in
      var sorter = V8TimSort(self, compare)
      sorter.sort()
      return sorter.work
    }
  }

  /// `array.sort(compare)` in place.
  mutating func jsSort(by compare: (Element, Element) -> Double) {
    self = jsSorted(by: compare)
  }
}

/// How a merge ended: the rest of the temp run goes after what's left, or
/// the other run's last (first) element lands at the end (front).
private enum MergeExit { case succeed, copyOther }

private struct V8TimSort<Element> {
  var work: [Element]
  let compareFn: (Element, Element) -> Double
  var runs: [(base: Int, length: Int)] = []
  var minGallop = 7
  static var minGallopWins: Int { 7 }

  init(_ elements: [Element], _ compare: @escaping (Element, Element) -> Double) {
    work = elements
    compareFn = compare
  }

  // The comparator's verdict as a number; NaN counts as 0 (+0).
  func compare(_ a: Element, _ b: Element) -> Double {
    let v = compareFn(a, b)
    return v.isNaN ? 0 : v
  }

  mutating func sort() {
    let length = work.count
    if length < 2 { return }
    var remaining = length
    var low = 0
    let minRun = Self.minRunLength(remaining)
    while remaining != 0 {
      var current = countAndMakeRun(low, low + remaining)
      if current < minRun {
        let forced = Swift.min(minRun, remaining)
        binaryInsertionSort(low, low + current, low + forced)
        current = forced
      }
      runs.append((low, current))
      mergeCollapse()
      low += current
      remaining -= current
    }
    mergeForceCollapse()
  }

  static func minRunLength(_ nArg: Int) -> Int {
    var n = nArg
    var r = 0
    while n >= 64 {
      r |= n & 1
      n >>= 1
    }
    return n + r
  }

  mutating func binaryInsertionSort(_ low: Int, _ startArg: Int, _ high: Int) {
    var start = low == startArg ? startArg + 1 : startArg
    while start < high {
      var left = low
      var right = start
      let pivot = work[start]
      while left < right {
        let mid = left + ((right - left) >> 1)
        let order = compare(pivot, work[mid])
        if order < 0 { right = mid } else { left = mid + 1 }
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

  mutating func countAndMakeRun(_ lowArg: Int, _ high: Int) -> Int {
    let low = lowArg + 1
    if low == high { return 1 }
    var runLength = 2
    let elementLow = work[low]
    let elementLowPre = work[low - 1]
    var order = compare(elementLow, elementLowPre)
    let isDescending = order < 0
    var previous = elementLow
    var idx = low + 1
    while idx < high {
      let current = work[idx]
      order = compare(current, previous)
      if isDescending {
        if order >= 0 { break }
      } else {
        if order < 0 { break }
      }
      previous = current
      runLength += 1
      idx += 1
    }
    if isDescending {
      work[lowArg..<(lowArg + runLength)].reverse()
    }
    return runLength
  }

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

  mutating func mergeAt(_ i: Int) {
    let stackSize = runs.count
    var baseA = runs[i].base
    var lengthA = runs[i].length
    let baseB = runs[i + 1].base
    var lengthB = runs[i + 1].length
    runs[i].length = lengthA + lengthB
    if i == stackSize - 3 { runs[i + 1] = runs[i + 2] }
    runs.removeLast()

    let keyRight = work[baseB]
    let k = gallopRight(work, keyRight, baseA, lengthA, 0)
    baseA += k
    lengthA -= k
    if lengthA == 0 { return }

    let keyLeft = work[baseA + lengthA - 1]
    lengthB = gallopLeft(work, keyLeft, baseB, lengthB, lengthB - 1)
    if lengthB == 0 { return }

    if lengthA <= lengthB {
      mergeLow(baseA, lengthA, baseB, lengthB)
    } else {
      mergeHigh(baseA, lengthA, baseB, lengthB)
    }
  }

  func gallopLeft(_ array: [Element], _ key: Element, _ base: Int, _ length: Int, _ hint: Int) -> Int {
    var lastOfs = 0
    var offset = 1
    var order = compare(array[base + hint], key)
    if order < 0 {
      let maxOfs = length - hint
      while offset < maxOfs {
        order = compare(array[base + hint + offset], key)
        if order >= 0 { break }
        lastOfs = offset
        offset = (offset << 1) + 1
        if offset <= 0 { offset = maxOfs }
      }
      if offset > maxOfs { offset = maxOfs }
      lastOfs += hint
      offset += hint
    } else {
      let maxOfs = hint + 1
      while offset < maxOfs {
        order = compare(array[base + hint - offset], key)
        if order < 0 { break }
        lastOfs = offset
        offset = (offset << 1) + 1
        if offset <= 0 { offset = maxOfs }
      }
      if offset > maxOfs { offset = maxOfs }
      let tmp = lastOfs
      lastOfs = hint - offset
      offset = hint - tmp
    }
    lastOfs += 1
    while lastOfs < offset {
      let m = lastOfs + ((offset - lastOfs) >> 1)
      order = compare(array[base + m], key)
      if order < 0 { lastOfs = m + 1 } else { offset = m }
    }
    return offset
  }

  func gallopRight(_ array: [Element], _ key: Element, _ base: Int, _ length: Int, _ hint: Int) -> Int {
    var lastOfs = 0
    var offset = 1
    var order = compare(key, array[base + hint])
    if order < 0 {
      let maxOfs = hint + 1
      while offset < maxOfs {
        order = compare(key, array[base + hint - offset])
        if order >= 0 { break }
        lastOfs = offset
        offset = (offset << 1) + 1
        if offset <= 0 { offset = maxOfs }
      }
      if offset > maxOfs { offset = maxOfs }
      let tmp = lastOfs
      lastOfs = hint - offset
      offset = hint - tmp
    } else {
      let maxOfs = length - hint
      while offset < maxOfs {
        order = compare(key, array[base + hint + offset])
        if order < 0 { break }
        lastOfs = offset
        offset = (offset << 1) + 1
        if offset <= 0 { offset = maxOfs }
      }
      if offset > maxOfs { offset = maxOfs }
      lastOfs += hint
      offset += hint
    }
    lastOfs += 1
    while lastOfs < offset {
      let m = lastOfs + ((offset - lastOfs) >> 1)
      order = compare(key, array[base + m])
      if order < 0 { offset = m } else { lastOfs = m + 1 }
    }
    return offset
  }

  mutating func mergeLow(_ baseA: Int, _ lengthAArg: Int, _ baseB: Int, _ lengthBArg: Int) {
    var lengthA = lengthAArg
    var lengthB = lengthBArg
    var temp = Array(work[baseA..<(baseA + lengthA)])
    var dest = baseA
    var cursorTemp = 0
    var cursorB = baseB

    work[dest] = work[cursorB]
    dest += 1
    cursorB += 1

    var exit = MergeExit.succeed
    merge: do {
      lengthB -= 1
      if lengthB == 0 {
        exit = .succeed
        break merge
      }
      if lengthA == 1 {
        exit = .copyOther
        break merge
      }
      var minGallop = self.minGallop
      while true {
        var winsA = 0
        var winsB = 0
        while true {
          let order = compare(work[cursorB], temp[cursorTemp])
          if order < 0 {
            work[dest] = work[cursorB]
            dest += 1
            cursorB += 1
            winsB += 1
            lengthB -= 1
            winsA = 0
            if lengthB == 0 {
              exit = .succeed
              break merge
            }
            if winsB >= minGallop { break }
          } else {
            work[dest] = temp[cursorTemp]
            dest += 1
            cursorTemp += 1
            winsA += 1
            lengthA -= 1
            winsB = 0
            if lengthA == 1 {
              exit = .copyOther
              break merge
            }
            if winsA >= minGallop { break }
          }
        }
        minGallop += 1
        var first = true
        while winsA >= Self.minGallopWins || winsB >= Self.minGallopWins || first {
          first = false
          minGallop = Swift.max(1, minGallop - 1)
          self.minGallop = minGallop

          winsA = gallopRight(temp, work[cursorB], cursorTemp, lengthA, 0)
          if winsA > 0 {
            for o in 0..<winsA { work[dest + o] = temp[cursorTemp + o] }
            dest += winsA
            cursorTemp += winsA
            lengthA -= winsA
            if lengthA == 1 {
              exit = .copyOther
              break merge
            }
            if lengthA == 0 {
              exit = .succeed
              break merge
            }
          }
          work[dest] = work[cursorB]
          dest += 1
          cursorB += 1
          lengthB -= 1
          if lengthB == 0 {
            exit = .succeed
            break merge
          }

          winsB = gallopLeft(work, temp[cursorTemp], cursorB, lengthB, 0)
          if winsB > 0 {
            for o in 0..<winsB { work[dest + o] = work[cursorB + o] }
            dest += winsB
            cursorB += winsB
            lengthB -= winsB
            if lengthB == 0 {
              exit = .succeed
              break merge
            }
          }
          work[dest] = temp[cursorTemp]
          dest += 1
          cursorTemp += 1
          lengthA -= 1
          if lengthA == 1 {
            exit = .copyOther
            break merge
          }
        }
        minGallop += 1
        self.minGallop = minGallop
      }
    }

    switch exit {
    case .succeed:
      if lengthA > 0 {
        for o in 0..<lengthA { work[dest + o] = temp[cursorTemp + o] }
      }
    case .copyOther:
      for o in 0..<lengthB { work[dest + o] = work[cursorB + o] }
      work[dest + lengthB] = temp[cursorTemp]
    }
    temp.removeAll()
  }

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

    var exit = MergeExit.succeed
    merge: do {
      lengthA -= 1
      if lengthA == 0 {
        exit = .succeed
        break merge
      }
      if lengthB == 1 {
        exit = .copyOther
        break merge
      }
      var minGallop = self.minGallop
      while true {
        var winsA = 0
        var winsB = 0
        while true {
          let order = compare(temp[cursorTemp], work[cursorA])
          if order < 0 {
            work[dest] = work[cursorA]
            dest -= 1
            cursorA -= 1
            winsA += 1
            lengthA -= 1
            winsB = 0
            if lengthA == 0 {
              exit = .succeed
              break merge
            }
            if winsA >= minGallop { break }
          } else {
            work[dest] = temp[cursorTemp]
            dest -= 1
            cursorTemp -= 1
            winsB += 1
            lengthB -= 1
            winsA = 0
            if lengthB == 1 {
              exit = .copyOther
              break merge
            }
            if winsB >= minGallop { break }
          }
        }
        minGallop += 1
        var first = true
        while winsA >= Self.minGallopWins || winsB >= Self.minGallopWins || first {
          first = false
          minGallop = Swift.max(1, minGallop - 1)
          self.minGallop = minGallop

          var k = gallopRight(work, temp[cursorTemp], baseA, lengthA, lengthA - 1)
          winsA = lengthA - k
          if winsA > 0 {
            dest -= winsA
            cursorA -= winsA
            // Copy(work, cursorA + 1, work, dest + 1, winsA): overlapping,
            // so from the top down, as V8's Copy does when moving right.
            var o = winsA - 1
            while o >= 0 {
              work[dest + 1 + o] = work[cursorA + 1 + o]
              o -= 1
            }
            lengthA -= winsA
            if lengthA == 0 {
              exit = .succeed
              break merge
            }
          }
          work[dest] = temp[cursorTemp]
          dest -= 1
          cursorTemp -= 1
          lengthB -= 1
          if lengthB == 1 {
            exit = .copyOther
            break merge
          }

          k = gallopLeft(temp, work[cursorA], 0, lengthB, lengthB - 1)
          winsB = lengthB - k
          if winsB > 0 {
            dest -= winsB
            cursorTemp -= winsB
            for o in 0..<winsB { work[dest + 1 + o] = temp[cursorTemp + 1 + o] }
            lengthB -= winsB
            if lengthB == 1 {
              exit = .copyOther
              break merge
            }
            if lengthB == 0 {
              exit = .succeed
              break merge
            }
          }
          work[dest] = work[cursorA]
          dest -= 1
          cursorA -= 1
          lengthA -= 1
          if lengthA == 0 {
            exit = .succeed
            break merge
          }
        }
        minGallop += 1
        self.minGallop = minGallop
      }
    }

    switch exit {
    case .succeed:
      if lengthB > 0 {
        let start = dest - (lengthB - 1)
        for o in 0..<lengthB { work[start + o] = temp[o] }
      }
    case .copyOther:
      dest -= lengthA
      cursorA -= lengthA
      var o = lengthA - 1
      while o >= 0 {
        work[dest + 1 + o] = work[cursorA + 1 + o]
        o -= 1
      }
      work[dest] = temp[cursorTemp]
    }
  }
}
