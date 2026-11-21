// Ports src/archive/useAnalyticsArchive.js
//
// The sync itself (the hook's runSync): followers, follows, blocks, the repo
// CAR (or, without it, a walk of likes and reposts), posts, notifications;
// each step persisted as it goes and measured on the bar; and the words
// beside the bar.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaRepo

/// One sync's bookkeeping: the plan, what has finished or failed, the step
/// under way and what went wrong (the hook's locals).
@MainActor final class SyncRun {
  unowned let model: ArchiveModel
  var plan = SyncProgress.syncPlan
  var done: [String] = []
  var failed: [String] = []
  var current: String?
  var errors: [String] = []

  init(model: ArchiveModel) {
    self.model = model
  }

  /// Close the step before, show this one, and give back its reporter.
  func begin(_ step: String, fraction: Double? = 0, detail: String = "", doing: String? = nil) -> SyncReporter {
    // Starting the same step again (a diff falling back to a full pull)
    // restarts its segment; it never marks it finished.
    if let current, current != step, !failed.contains(current), !done.contains(current) { done.append(current) }
    current = step
    model.setSync(SyncState(plan: plan, done: done, failed: failed, step: step, fraction: fraction, detail: detail, doing: doing))
    return SyncReporter(run: self, step: step)
  }

  func fail(_ step: String, _ message: String) {
    errors.append("\(step): \(message)")
    if !failed.contains(step) { failed.append(step) }
  }
}

/// A step's reporter: moves its own segment only, and only forward.
struct SyncReporter: Sendable {
  let run: SyncRun
  let step: String

  @MainActor func callAsFunction(_ nextFraction: Double?, _ nextDetail: String? = nil, _ nextDoing: String? = nil) {
    guard let s = run.model.sync, s.step == step else { return }
    let fraction: Double?
    if let nextFraction {
      fraction = s.fraction.map { ChartFormat.jsMax($0, nextFraction) } ?? nextFraction
    } else {
      fraction = s.fraction
    }
    run.model.setSync(
      SyncState(
        plan: run.plan, done: s.done, failed: s.failed, step: s.step, fraction: fraction, detail: nextDetail ?? s.detail,
        doing: nextDoing ?? s.doing))
  }
}

/// VirgaNetwork's transport as the repo download's.
struct RepoTransport: RepoCarTransport {
  let transport: any HTTPTransport

  func get(_ url: String) async throws -> RepoCarResponse {
    let response = try await transport.send(HTTPRequest(url: url))
    // One chunk, as the web's stream gives a whole body: the total is the
    // Content-Length or none.
    let body = response.body
    let stream = AsyncThrowingStream<Data, any Error> { continuation in
      if !body.isEmpty { continuation.yield(body) }
      continuation.finish()
    }
    return RepoCarResponse(status: response.status, headers: response.headers.canonical, body: .stream(stream))
  }
}

extension ArchiveModel {
  /// `!!value` for a number: present, non-zero and not NaN.
  static func truthy(_ value: Double?) -> Double? {
    guard let value, value != 0, !value.isNaN else { return nil }
    return value
  }

  static func truthy(_ value: Int?) -> Int? {
    guard let value, value != 0 else { return nil }
    return value
  }

  func performSync(_ mode: SyncMode, store: any AnalyticsStoreHandle) async {
    guard let agent else { return }
    let data = self.data
    let run = SyncRun(model: self)
    setSyncError(nil)
    let startedAt = clockNow()
    let tz = timeZone
    let transport = env.transport
    let clock = env.clock

    func aborted() -> Bool { Task.isCancelled }

    body: do {
      // One public profile read up front: Bluesky's own counters, the
      // yardstick the sweeps are measured against.
      let prof = try? await Atproto.getProfile(did, transport: transport)
      let profFollowers = prof?["followersCount"]?.doubleValue
      let profFollows = prof?["followsCount"]?.doubleValue
      let profPosts = prof?["postsCount"]?.doubleValue

      // Followers: always the full set.
      let followerEst = Self.truthy(data.meta.followers?.count.map(Double.init)) ?? Self.truthy(profFollowers)
      var report = run.begin("followers", fraction: followerEst != nil ? 0 : nil)
      let followersReport = report
      let locale = self.locale
      let fw = await AnalyticsSync.sweepFollowers(agent: agent, did: did, clock: clock) { @MainActor p in
        followersReport(SyncProgress.share(Double(p.fetched), followerEst), Self.ofAbout(Double(p.fetched), followerEst, "followers", locale: locale))
      }
      if fw.complete {
        // Who left and who arrived since the last complete sweep.
        if data.meta.followers?.complete == true && !data.followers.isEmpty {
          let since = Self.truthy(data.meta.followers?.syncedAt)
          let changes = FollowerLog.followerChanges(data.followers, fw.followers, at: startedAt, since: since)
          let held = (await store.getMeta("followerLog")).flatMap(FollowerLogRecord.init(json:)) ?? FollowerLogRecord()
          await store.setMeta("followerLog", FollowerLog.mergeFollowerLog(held, changes, startedAt).json)
        }
        await store.clear("followers")
        await store.putAll("followers", fw.followers.map(\.json))
        await store.setMeta(
          "followers",
          [
            "syncedAt": .number(startedAt), "count": .number(Double(fw.followers.count)), "complete": true,
            "profileCount": profFollowers.map(JSONValue.number) ?? .null,
          ])
      } else if let error = fw.error {
        run.fail("followers", error)
      }
      if aborted() { break body }

      // Who the account follows, replaced only by a complete set.
      let followingEst = Self.truthy(data.meta.following?.count.map(Double.init)) ?? Self.truthy(profFollows)
      report = run.begin("following", fraction: followingEst != nil ? 0 : nil)
      let followingReport = report
      let fl = await AnalyticsSync.sweepFollowing(agent: agent, did: did, clock: clock) { @MainActor p in
        followingReport(SyncProgress.share(Double(p.fetched), followingEst), Self.ofAbout(Double(p.fetched), followingEst, "follows", locale: locale))
      }
      if fl.complete {
        await store.clear("following")
        await store.putAll("following", fl.following.map(\.json))
        await store.setMeta(
          "following", ["syncedAt": .number(startedAt), "count": .number(Double(fl.following.count)), "complete": true])
      } else if let error = fl.error {
        run.fail("following", error)
      }
      if aborted() { break body }

      // Blocks received, replaced only after a complete sweep.
      let directEstimate = Self.truthy(data.blocks.filter { $0.source == "direct" }.count)
      report = run.begin("blocks")
      let blocksReport = report
      let bw = await AnalyticsSync.sweepBlocks(did: did, transport: transport, clock: clock, timeZone: tz) { @MainActor p in
        blocksReport(
          SyncProgress.blocksFraction(p, directEstimate: directEstimate), Self.blocksDetail(p, directEstimate, locale: locale))
      }
      if bw.complete {
        let reach = Analytics.blockReach(bw.blocks, timeZone: tz)
        await store.clear("blocks")
        await store.putAll("blocks", bw.blocks.map(\.json))
        await store.setMeta(
          "blocks",
          [
            "syncedAt": .number(startedAt), "count": .number(Double(reach.people.count)),
            "pathCount": .number(Double(bw.blocks.count)), "version": 2, "complete": true,
          ])
        // Every list the account is on, for Lists you're on.
        await store.setMeta("lists", ["syncedAt": .number(startedAt), "lists": .array(bw.lists.map(\.json))])
      } else if let error = bw.error {
        run.fail("blocks", error)
      }
      if aborted() { break body }

      // The repo CAR: every record in every collection, one download.
      var carEntries: [RepoCarEntry]?
      let repoMeta = data.meta.repo
      // Rows of an older shape are brought up from the repo's records,
      // which needs the whole repo this once rather than a diff.
      let postsShapeOld = data.meta.posts != nil && data.meta.posts?.shape != Analytics.postRowVersion
      do {
        let pds = try await Atproto.resolvePds(did, transport: transport, clock: clock, cache: env.didDocuments)
        let carTransport = RepoTransport(transport: transport)
        func pull(_ since: String?) async throws -> (parsed: RepoCarContents, size: Int) {
          let full = since == nil
          let totalGuess = full ? Self.truthy(repoMeta?.bytes.map(Double.init)) : nil
          let repoReport = run.begin(
            "repo", fraction: totalGuess != nil ? 0 : nil,
            doing: full ? "Downloading the repo" : "Downloading what changed in the repo")
          report = repoReport
          let (downloads, downloaded) = AsyncStream<RepoCarDownloadProgress>.makeStream()
          let downloading = Task { @MainActor in
            for await p in downloads {
              let total = Self.truthy(p.total) ?? totalGuess
              repoReport(SyncProgress.repoDownloadFraction(Double(p.bytes), total), Self.megabytes(Double(p.bytes), total))
            }
          }
          let bytes: [UInt8]
          do {
            bytes = try await CarRepo.fetchRepoCar(pds, did, since: since, transport: carTransport) { downloaded.yield($0) }
          } catch {
            downloaded.finish()
            await downloading.value
            throw error
          }
          downloaded.finish()
          await downloading.value
          let expectedRecords = full ? Self.truthy(data.atmosphere.count) : nil
          repoReport(nil, "", "Reading the repo archive")
          let (reads, read) = AsyncStream<RepoCarReadProgress>.makeStream()
          let reading = Task { @MainActor in
            for await p in reads {
              repoReport(SyncProgress.repoReadFraction(p, expectedRecords: expectedRecords), Self.carDetail(p, locale: locale))
            }
          }
          let parsed: RepoCarContents
          do {
            parsed = try await CarRepo.readRepoCar(bytes) { read.yield($0) }
          } catch {
            read.finish()
            await reading.value
            throw error
          }
          read.finish()
          await reading.value
          return (parsed, bytes.count)
        }
        var since: String? = mode != .full && !postsShapeOld ? repoMeta?.rev.flatMap { $0.isEmpty ? nil : $0 } : nil
        var pulled: (parsed: RepoCarContents, size: Int)
        do {
          pulled = try await pull(since)
        } catch {
          // A diff fails when the PDS no longer holds that rev: pull it all.
          if since == nil || aborted() { throw error }
          since = nil
          pulled = try await pull(nil)
        }
        let parsed = pulled.parsed
        if aborted() { break body }

        var atmoRows: [JSONValue] = []
        var outRows: [JSONValue] = []
        for entry in parsed.entries {
          if let row = try CarRepo.atmosphereRowFromEntry(entry, timeZone: tz) { atmoRows.append(row.json) }
          let kind = entry.collection == "app.bsky.feed.like" ? "like" : entry.collection == "app.bsky.feed.repost" ? "repost" : nil
          if let kind,
            let ev = Analytics.outboundFromRecord(kind, ["uri": .string(entry.uri), "value": entry.record], timeZone: tz)
          {
            outRows.append(ev.json)
          }
        }
        // The size of the last full pull is the next one's yardstick.
        let bytesMeta: JSONValue = since == nil ? .number(Double(pulled.size)) : repoMeta?["bytes"].nonNull ?? .null
        let toWrite = atmoRows.count + outRows.count
        var written = 0
        let repoReport = report
        func saved(_ rows: Int) {
          written += rows
          repoReport(SyncProgress.repoSaveFraction(written, toWrite), "\(Self.num(Double(written), locale: locale)) of \(Self.num(Double(toWrite), locale: locale)) rows")
        }
        repoReport(
          SyncProgress.repoSaveFraction(0, toWrite), "\(Self.num(0, locale: locale)) of \(Self.num(Double(toWrite), locale: locale)) rows",
          "Saving the repo to this browser")
        if since == nil {
          // A full pull replaces, so deleted records leave; the rev is
          // cleared first, so a death mid-write makes the next sync pull
          // in full again.
          await store.clear("atmosphere")
          await store.clear("outbound")
          await store.setMeta("repo", ["syncedAt": .number(startedAt), "rev": .null, "bytes": bytesMeta])
        }
        for start in stride(from: 0, to: atmoRows.count, by: 5000) {
          let chunk = Array(atmoRows[start..<min(start + 5000, atmoRows.count)])
          await store.putAll("atmosphere", chunk)
          saved(chunk.count)
        }
        for start in stride(from: 0, to: outRows.count, by: 5000) {
          let chunk = Array(outRows[start..<min(start + 5000, outRows.count)])
          await store.putAll("outbound", chunk)
          saved(chunk.count)
        }
        // An empty diff names no rev: nothing was written since the one held.
        let rev: JSONValue = parsed.rev.truthy ?? since.map(JSONValue.string) ?? .null
        await store.setMeta("repo", ["syncedAt": .number(startedAt), "rev": rev, "bytes": bytesMeta])
        // The CAR is the complete outbound record.
        await store.setMeta("outbound", ["syncedAt": .number(startedAt), "coverageMs": 0, "truncated": false])
        carEntries = parsed.entries
      } catch {
        if aborted() { break body }
        if run.current != "repo" { _ = run.begin("repo") }
        run.fail("repo", jsMessage(error))
        // Without the CAR, likes and reposts need their own walk at the end.
        run.plan.append("outbound")
      }
      if aborted() { break body }

      // Posts.
      let postsMeta = data.meta.posts
      let full = mode == .full || postsMeta == nil
      // Resume finishes an incomplete build: from its cursor, or (died
      // before the first checkpoint) from page one without clearing.
      let resume = !full && mode == .resume && postsMeta?.complete != true
      var est: Double? = Self.truthy(Double(data.posts.count))
      if full || resume, let posts = Self.truthy(profPosts) { est = posts }
      var heldPosts = data.posts
      let building = full || resume
      var shape: JSONValue = full ? .number(Double(Analytics.postRowVersion)) : postsMeta?["shape"].nonNull ?? .null
      report = run.begin("posts", fraction: nil, doing: building ? "Archiving posts" : "Refreshing recent posts")
      if full {
        await store.clear("posts")
        // The build is underway before page one: however it dies from
        // here, the archive reads as incomplete and resumable.
        await store.setMeta("posts", ["syncedAt": .number(startedAt), "complete": false, "cursor": .null, "shape": shape])
        heldPosts = []
        if let carEntries {
          // Seed the cleared archive with the repo's own posts (counts all
          // zero) and draw the charts now; the sweep overwrites every one.
          var seed: [PostRow] = []
          for entry in carEntries where entry.collection == "app.bsky.feed.post" {
            if let row = Analytics.compactPostFromRecord(entry.uri, entry.record, timeZone: tz) { seed.append(row) }
          }
          if !seed.isEmpty {
            report(nil, "copying \(Self.num(Double(seed.count), locale: locale)) posts from the repo so the charts can draw")
            await store.putAll("posts", seed.map(\.json))
            await reload(store)
          }
          heldPosts = seed
        }
      } else if postsShapeOld, let carEntries {
        // The upgrade: held rows take their text and facts from their own
        // records, and keep their counts.
        var records: [JSKey: JSONValue] = [:]
        for entry in carEntries where entry.collection == "app.bsky.feed.post" { records[JSKey(entry.uri)] = entry.record }
        let upgraded = Analytics.upgradePostRows(data.posts, records, timeZone: tz)
        if !upgraded.isEmpty {
          report(nil, "reading \(Self.num(Double(upgraded.count), locale: locale)) posts again from the repo")
          await store.putAll("posts", upgraded.map(\.json))
        }
        shape = .number(Double(Analytics.postRowVersion))
        await store.setMeta("posts", (postsMeta ?? ArchiveMetaRecord()).updating(["shape": shape]).json)
      }
      let postTimes = heldPosts.map { JSDate.parse($0.at ?? "", timeZone: tz) }.filter(\.isFinite).sorted()
      // A build walks to the oldest post; a top-up back through the window
      // whose counts it refreshes.
      let rehydrateFrom = startedAt - Self.rehydrateDays * Self.dayMs
      let postTarget: Double? = building ? postTimes.first : rehydrateFrom
      let measurable = postTarget.map { SyncProgress.walkFraction(postTimes, nil, $0) != nil } ?? false
      let postsEst = building ? est : nil
      if measurable || postsEst != nil { report(0, "") }
      let known: Set<JSKey>? = building ? nil : Set(data.posts.map { JSKey($0.uri) })
      let postsReport = report
      let postsShape = shape
      let ps = await AnalyticsSync.sweepPosts(
        did: did, knownUris: known, rehydrateSinceMs: building ? -.infinity : rehydrateFrom,
        resumeCursor: resume ? postsMeta?.cursor.flatMap { $0.isEmpty ? nil : $0 } : nil, transport: transport, clock: clock,
        timeZone: tz,
        // Persist the page, then checkpoint the cursor that resumes after it.
        onPage: { rows, info in
          await store.putAll("posts", rows.map(\.json))
          if building, let cursor = info.cursor {
            await store.setMeta(
              "posts", ["syncedAt": .number(startedAt), "complete": false, "cursor": .string(cursor), "shape": postsShape])
          }
        },
        onProgress: { @MainActor p in
          let walked = measurable ? SyncProgress.walkFraction(postTimes, p.reachedMs, postTarget ?? .nan) : nil
          postsReport(
            walked ?? SyncProgress.share(Double(p.fetched), postsEst),
            Self.reachedDetail(Self.ofAbout(Double(p.fetched), postsEst, "posts", locale: locale), p.reachedMs, locale: locale, timeZone: tz))
        })
      if let error = ps.error { run.fail("posts", error) }
      if building {
        await store.setMeta(
          "posts",
          [
            "syncedAt": .number(startedAt), "complete": .bool(ps.complete),
            "cursor": ps.complete ? .null : ps.cursor.map(JSONValue.string) ?? .null, "shape": shape,
          ])
      } else {
        await store.setMeta("posts", (postsMeta ?? ArchiveMetaRecord()).updating(["syncedAt": .number(startedAt), "shape": shape]).json)
      }
      if aborted() { break body }

      // Inbound engagement.
      let cutoffMs = startedAt - Self.eventDepthDays * Self.dayMs
      let im = data.meta.inbound
      let inCovered = im?.coverageMs.map { $0 <= cutoffMs } ?? false
      let inTarget = inCovered ? (Self.truthy(im?.syncedAt) ?? cutoffMs) : cutoffMs
      report = run.begin("inbound")
      let inboundReport = report
      let inb = await AnalyticsSync.sweepInbound(
        agent: agent, cutoffMs: cutoffMs, knownUris: Set(data.inbound.map { JSKey($0.uri) }), coveredToMs: im?.coverageMs,
        clock: clock, timeZone: tz,
        onPage: { rows in await store.putAll("inbound", rows.map(\.json)) },
        onProgress: { @MainActor p in
          let head = "\(Self.num(Double(p.fetched), locale: locale)) engagement \(p.fetched == 1 ? "event" : "events") read"
          inboundReport(
            SyncProgress.timeFraction(startedAt, p.reachedMs, inTarget),
            Self.reachedDetail(head, p.reachedMs, locale: locale, timeZone: tz))
        })
      if let error = inb.error {
        run.fail("inbound", error)
      } else if !inb.aborted {
        let coverage = ChartFormat.jsMin(im?.coverageMs ?? .infinity, inb.complete ? cutoffMs : (inb.reachedMs ?? .infinity))
        await store.setMeta(
          "inbound",
          [
            "syncedAt": .number(startedAt), "coverageMs": coverage.isFinite ? .number(coverage) : .null,
            "truncated": .bool(inb.truncated),
          ])
      }
      if aborted() { break body }

      // Outbound: only when the repo pull failed.
      if carEntries == nil {
        let om = data.meta.outbound
        let outCovered = om?.coverageMs.map { $0 <= cutoffMs } ?? false
        let outTarget = outCovered ? (Self.truthy(om?.syncedAt) ?? cutoffMs) : cutoffMs
        report = run.begin("outbound")
        let outboundReport = report
        let outb = await AnalyticsSync.sweepOutbound(
          agent: agent, did: did, cutoffMs: cutoffMs, knownUris: Set(data.outbound.map { JSKey($0.uri) }),
          coveredToMs: om?.coverageMs, clock: clock, timeZone: tz,
          onPage: { rows in await store.putAll("outbound", rows.map(\.json)) },
          onProgress: { @MainActor p in
            let head = "\(p.part == 0 ? "likes" : "reposts") · \(AppLocale.formatNumber(Double(p.fetched), locale: locale)) read"
            outboundReport(
              SyncProgress.partsFraction(p.part.map(Double.init), p.parts.map(Double.init), SyncProgress.timeFraction(startedAt, p.reachedMs, outTarget)),
              Self.reachedDetail(head, p.reachedMs, locale: locale, timeZone: tz))
          })
        if let error = outb.error {
          run.fail("outbound", error)
        } else if !outb.aborted {
          let coverage = ChartFormat.jsMin(om?.coverageMs ?? .infinity, outb.complete ? cutoffMs : (outb.reachedMs ?? .infinity))
          await store.setMeta(
            "outbound",
            [
              "syncedAt": .number(startedAt), "coverageMs": coverage.isFinite ? .number(coverage) : .null,
              "truncated": .bool(outb.truncated),
            ])
        }
      }
    }

    // finally: every step has had its turn; read the archive back.
    syncTask = nil
    if let current = run.current, !run.failed.contains(current), !run.done.contains(current), !aborted() {
      run.done.append(current)
    }
    if var s = sync {
      s.done = run.done
      s.failed = run.failed
      s.step = nil
      s.fraction = nil
      s.detail = ""
      s.doing = nil
      setSync(s)
    }
    if let store = self.store { await reload(store) }
    setSync(nil)
    if !run.errors.isEmpty { setSyncError(run.errors.joined(separator: " · ")) }
  }

  // MARK: - The words beside the bar

  /// `Math.round(v).toLocaleString(activeLocale())`.
  static func num(_ v: Double, locale: String?) -> String {
    AppLocale.formatNumber(v.jsRounded, locale: locale)
  }

  /// "2,300 of ~5,592 followers", or "2,300 followers" with nothing to go by.
  static func ofAbout(_ fetched: Double, _ est: Double?, _ noun: String, locale: String?) -> String {
    if let est, est != 0, !est.isNaN {
      return "\(num(fetched, locale: locale)) of ~\(num(est, locale: locale)) \(noun)"
    }
    return "\(num(fetched, locale: locale)) \(noun)"
  }

  /// A walk's count, then how far back in time it has reached.
  static func reachedDetail(_ head: String, _ reachedMs: Double?, locale: String?, timeZone: TimeZone) -> String {
    guard let reachedMs else { return head }
    return "\(head) · back to \(Time.formatDateShort(reachedMs, locale: locale, timeZone: timeZone))"
  }

  static func blocksDetail(_ p: BlocksProgress?, _ directEstimate: Int?, locale: String?) -> String {
    guard let p else { return "" }
    switch p.stage {
    case "direct":
      return ofAbout(Double(p.done), directEstimate.map(Double.init), "direct blocks", locale: locale)
    case "lists":
      return "finding the lists you’re on · \(num(Double(p.done), locale: locale)) \(p.done == 1 ? "membership" : "memberships")"
    case "check":
      return "checking \(num(Double(p.done), locale: locale)) of \(num(Double(p.total ?? 0), locale: locale)) lists for moderation lists"
    case "subscribers":
      return "moderation lists \(num(Double(p.done), locale: locale)) of \(num(Double(p.total ?? 0), locale: locale)) · \(num(Double(p.fetched), locale: locale)) block paths"
    default:
      return ""
    }
  }

  /// "4.2 of ~66 MB", or "4.2 MB" with no total.
  static func megabytes(_ bytes: Double, _ total: Double?) -> String {
    func mb(_ v: Double) -> String { (v / 1_048_576).jsToFixed(v < 10 * 1_048_576 ? 1 : 0) }
    if let total, total != 0, !total.isNaN { return "\(mb(bytes)) of ~\(mb(total)) MB" }
    return "\(mb(bytes)) MB"
  }

  static func carDetail(_ p: RepoCarReadProgress?, locale: String?) -> String {
    guard let p else { return "" }
    switch p.stage {
    case .index: return "indexing blocks"
    case .walk: return "\(num(Double(p.done), locale: locale)) records found"
    case .decode: return "\(num(Double(p.done), locale: locale)) of \(num(Double(p.total ?? 0), locale: locale)) records"
    }
  }
}
