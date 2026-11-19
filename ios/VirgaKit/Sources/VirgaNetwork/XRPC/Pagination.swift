// The web's cursor loops, as one helper each port sets to match its own.
//
// Every paged read in the web app is the same loop with different stopping
// rules: read a page with the cursor so far, keep its items, take its
// cursor, and stop when
//
//   there is no cursor                       every loop
//   the page came back empty                 analyticsSync's sweeps (`batch.length === 0`)
//   the cursor is the one just used          analyticsSync's Constellation sweeps
//   the cursor was seen before               templateService, drafts
//   a page cap is reached                    analyticsSync (CAPS), harvest, drafts (maxPages)
//
// and each says how the loop ended, so a caller can tell a complete read
// from a capped one. A cursor that is the empty string ends the loop, as
// `!cursor` does.

import Foundation
import VirgaCore

public enum Pagination {
  /// What a repeated cursor does.
  public enum RepeatedCursor: Sendable {
    /// Nothing: the loop follows it (the page cap still ends it).
    case follow
    /// Stop when the cursor is the one just used (`next === cursor`).
    case stopOnPrevious
    /// Stop when the cursor was seen before at all.
    case stopOnAny
  }

  public enum Stop: Sendable, Hashable {
    /// No cursor, or (with `stopOnEmptyPage`) an empty page: everything was read.
    case complete
    /// The page cap was reached with a cursor still to follow.
    case pageLimit
    /// The service handed back a cursor it had given before.
    case repeatedCursor
    /// The task was cancelled before a page.
    case cancelled
  }

  public struct Page<Item: Sendable>: Sendable {
    public var items: [Item]
    public var cursor: String?

    public init(items: [Item], cursor: String?) {
      self.items = items
      self.cursor = cursor
    }
  }

  public struct Outcome<Item: Sendable>: Sendable {
    public var items: [Item]
    public var pages: Int
    public var stop: Stop
    /// The cursor the loop didn't follow (to resume from), if any.
    public var cursor: String?

    /// Every item was read.
    public var complete: Bool { stop == .complete }
  }

  /// Reads pages from `fetch(cursor)` until a stopping rule says so.
  /// Errors from `fetch` are thrown as they are, so a caller keeps its own
  /// error handling (some web loops keep what was read, some don't).
  public static func collect<Item: Sendable>(
    startingAt start: String? = nil,
    maxPages: Int? = nil,
    stopOnEmptyPage: Bool = true,
    repeatedCursor: RepeatedCursor = .stopOnAny,
    onPage: ((_ itemsSoFar: Int) -> Void)? = nil,
    fetch: (_ cursor: String?) async throws -> Page<Item>
  ) async throws -> Outcome<Item> {
    var items: [Item] = []
    var cursor = start.flatMap { $0.isEmpty ? nil : $0 }
    var seen = Set<String>()
    if let cursor { seen.insert(cursor) }
    var pages = 0
    while maxPages.map({ pages < $0 }) ?? true {
      if Task.isCancelled { return Outcome(items: items, pages: pages, stop: .cancelled, cursor: cursor) }
      let page = try await fetch(cursor)
      pages += 1
      items.append(contentsOf: page.items)
      onPage?(items.count)
      guard let next = page.cursor, !next.isEmpty else {
        return Outcome(items: items, pages: pages, stop: .complete, cursor: nil)
      }
      if stopOnEmptyPage && page.items.isEmpty {
        return Outcome(items: items, pages: pages, stop: .complete, cursor: nil)
      }
      switch repeatedCursor {
      case .follow: break
      case .stopOnPrevious where next == cursor, .stopOnAny where seen.contains(next):
        return Outcome(items: items, pages: pages, stop: .repeatedCursor, cursor: next)
      default: break
      }
      seen.insert(next)
      cursor = next
    }
    return Outcome(items: items, pages: pages, stop: .pageLimit, cursor: cursor)
  }
}

extension XRPCAgent {
  /// Every item of a paged query: `itemsKey` names the items' array in each
  /// answer (`records`, `followers`, `feed`), `cursor` the next cursor. The
  /// cursor is sent as the `cursor` parameter, after the others.
  public func collect(
    _ nsid: String,
    _ params: XRPCParams = XRPCParams(),
    itemsKey: String,
    maxPages: Int? = nil,
    stopOnEmptyPage: Bool = true,
    repeatedCursor: Pagination.RepeatedCursor = .stopOnAny
  ) async throws -> Pagination.Outcome<JSONValue> {
    try await Pagination.collect(maxPages: maxPages, stopOnEmptyPage: stopOnEmptyPage, repeatedCursor: repeatedCursor) { cursor in
      var query = params
      query["cursor"] = cursor.map(XRPCParamValue.string)
      let data = try await self.query(nsid, query).data
      return Pagination.Page(items: data[itemsKey]?.arrayValue ?? [], cursor: data["cursor"]?.stringValue)
    }
  }
}
