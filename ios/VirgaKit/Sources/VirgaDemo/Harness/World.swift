// Ports harness/world.js
//
// A made-up account and everything the dashboard reads about it: posts with
// their counts, followers, follows, notifications, likes and reposts, the
// rest of a repo, and the blocks pointing at it. Deterministic (a seeded
// PRNG), and dated back from "now", so the charts always have a recent week
// to draw.
//
// Nobody here is real. Handles are under example.com, which nobody can own.
// It is stand-in content shaped like the real thing: long names and missing
// ones, accounts with no avatar, a post that took off, a quiet month.
//
// Every number is drawn and bent exactly as the web draws it: `mulberry` bit
// for bit, `**` as V8's pow (Support/JSMath.swift), each sum and product in
// the web's order, and every sort as V8's (Support/JSSort.swift), since the
// harness's comparators never say two things are equal. So a world built
// here for a `now` and seed is the web's, record key for record key.

import Foundation
import VirgaCore

public enum World {
  static let day: Double = 86_400_000

  /// The busy account: three years of history.
  public static let me = WorldAccount(
    did: "did:plc:virgaharnessmira2zq4x",
    handle: "mira.example.com",
    displayName: "Mira Okafor"
  )

  /// A second account on the same device, for switching and posting as
  /// someone else: a small, quiet one with a few followers and nothing
  /// pointing at it.
  public static let lab = WorldAccount(
    did: "did:plc:virgaharnesslab7k2pq",
    handle: "lab.example.org",
    displayName: "Field Lab",
    avatar: avatarFor("F", 146)
  )

  public static let pds = "https://pds.harness.example"

  /// Tiny deterministic RNG, so two runs draw the same account.
  public static func mulberry(_ seed: Double) -> Mulberry {
    Mulberry(seed: seed)
  }

  static let b32 = Array("234567abcdefghijklmnopqrstuvwxyz".utf16)

  /// A real TID for a timestamp: the encoding tidToTimestamp reads back.
  /// Throws the web's RangeError for a time that isn't finite.
  public static func tidAt(_ ms: Double, _ clock: Double = 0) throws -> String {
    let whole = ms.rounded(.down)
    guard whole.isFinite else {
      throw HarnessJSError.rangeError(
        "The number \(JSNumber.format(whole)) cannot be converted to a BigInt because it is not an integer")
    }
    return tid(whole, Int(JSMath.toInt32(clock) & 1023))
  }

  /// `tidAt` for a time known to be finite.
  static func tid(_ ms: Double, _ clock: Int) -> String {
    // n = (floor(ms) * 1000 << 10) | clock, as a BigInt; the key is its low
    // 65 bits (13 characters of 5), two's complement for a negative time.
    // Times 1000 << 10 = 1_024_000, which is even, so the time's own bit 64
    // lands above the key and only the product's carry reaches bit 64.
    let product = low65(ms.rounded(.down)).low.multipliedFullWidth(by: 1_024_000)
    let low = product.low | UInt64(clock & 1023)
    let top = product.high & 1
    var out = [UInt16](repeating: 0, count: 13)
    for i in 0..<13 {
      let digit: UInt64 = i < 12 ? (low >> UInt64(5 * i)) & 31 : (low >> 60) | (top << 4)
      out[12 - i] = b32[Int(digit)]
    }
    return String(decoding: out, as: UTF16.self)
  }

  /// An integral, finite double modulo 2^65: (bit 64, bits 0–63).
  private static func low65(_ x: Double) -> (top: UInt64, low: UInt64) {
    if Swift.abs(x) < 9_223_372_036_854_775_808 {
      let v = Int64(x)
      return (v < 0 ? 1 : 0, UInt64(bitPattern: v))
    }
    // |x| = m · 2^e, with e ≥ 11 here.
    let m = (UInt64(1) << 52) | x.significandBitPattern
    let e = Int(x.exponent) - 52
    var top: UInt64 = 0
    var low: UInt64 = 0
    if e < 64 {
      low = m << UInt64(e)
      top = (m >> UInt64(64 - e)) & 1
    } else if e == 64 {
      top = m & 1
    }
    if x < 0 {
      let negated = ~low &+ 1
      top = (~top &+ (low == 0 ? 1 : 0)) & 1
      low = negated
    }
    return (top, low)
  }

  static let first = [
    "Ana", "Bo", "Cyrus", "Dee", "Edna", "Fio", "Gideon", "Hana", "Ines", "Jun", "Kofi", "Lior",
    "Maren", "Nadia", "Oskar", "Priya", "Quentin", "Rosa", "Sami", "Tove", "Uma", "Viktor",
    "Wren", "Xiomara", "Yusuf", "Zadie", "Alasdair", "Bettina", "Caetano", "Dorothea",
  ]
  static let last = [
    "Abara", "Lindqvist", "Moreau", "Nakamura", "Oyelaran", "Pereira", "Quispe", "Rahman",
    "Sokolova", "Tanaka", "Underhill", "Vasquez", "Whitcombe", "Yilmaz", "Zielinski",
    "Featherstonehaugh-Barrington", "de la Cruz", "van der Berg", "Okonkwo", "Haddad",
  ]
  static let hues = [212, 28, 146, 268, 338, 48, 188, 12, 96, 300]

  /// The lists the account is on, by position: even ones below 8 are moderation lists.
  static let listNames = [
    "Muted for now",
    "Gardening people",
    "Too many takes",
    "Urbanists I read",
    "Reply guys",
    "Bookish",
    "Low-effort replies",
    "Cycling",
    "Mutuals",
  ]

  /// A few dozen more accounts the account follows, outside the cast: people
  /// it followed once and rarely hears from. Some have gone quiet, a few are
  /// gone altogether, which is what Follow cleanup is for. Built without the
  /// RNG, so the rest of the world draws the same as before they were added.
  static func followedOnlyPeople() -> [WorldPerson] {
    (0..<36).map { i in
      let firstName = first[(i * 5 + 2) % first.count]
      let lastName = last[(i * 3 + 1) % last.count]
      let lettersOnly = String(
        decoding: lastName.jsLowercased().utf16.filter { $0 >= 0x61 && $0 <= 0x7A }, as: UTF16.self)
      return WorldPerson(
        did: "did:plc:virgaharnessfol\(String.zeroPadded(i, 4))",
        handle: "\(firstName.jsLowercased()).\(lettersOnly).example.net",
        displayName: i % 7 == 3 ? "" : "\(firstName) \(lastName)",
        avatar: i % 4 == 1 ? "" : avatarFor(firstName.jsSlice(0, 1), hues[(i + 3) % hues.count])
      )
    }
  }

  /// The 64 people around the accounts. Built without the RNG, so both
  /// accounts share them and the rest of each world draws the same as before.
  public static func buildCast() -> [WorldPerson] {
    (0..<64).map { i in
      let firstName = first[i % first.count]
      let lastName = last[(i * 7 + 3) % last.count]
      let hue = hues[i % hues.count]
      let handle = "\(firstName)\(i > first.count ? String(i) : "").example.com".jsLowercased()
      return WorldPerson(
        did: "did:plc:virgaharnesscast\(String.zeroPadded(i, 4))",
        handle: handle,
        // Some people never set a name, and some never set a picture.
        displayName: i % 9 == 4 ? "" : "\(firstName) \(lastName)",
        avatar: i % 6 == 5 ? "" : avatarFor(firstName.jsSlice(0, 1), hue)
      )
    }
  }

  /// A number from a string, for deterministic per-account facts: FNV-1a
  /// over the UTF-16 code units, as an unsigned 32-bit number.
  public static func hashOf(_ text: String) -> Int {
    var h: UInt32 = 2_166_136_261
    for unit in text.utf16 {
      h ^= UInt32(unit)
      h = h &* 16_777_619
    }
    return Int(h)
  }

  /// When an account outside the main account was last active, as days
  /// ago, or gone (deleted or deactivated) or never (has never posted). The
  /// cast is mostly active; the follows outside it are mostly quiet.
  public static func activityOf(_ did: String) -> WorldActivity {
    let h = hashOf(did)
    if did.jsContains("fol") {
      if h % 9 == 0 { return .gone }
      if h % 13 == 0 { return .never }
      return .daysAgo(h % 420)
    }
    return .daysAgo(h % 28)
  }

  /// A round avatar with an initial on it, as a data URI. No image host needed.
  static func avatarFor(_ letter: String, _ hue: Int) -> String {
    let svg =
      "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">"
      + "<rect width=\"64\" height=\"64\" fill=\"hsl(\(hue) 70% 78%)\"/>"
      + "<text x=\"32\" y=\"42\" font-family=\"system-ui,sans-serif\" font-size=\"30\" font-weight=\"700\" "
      + "text-anchor=\"middle\" fill=\"hsl(\(hue) 60% 24%)\">\(letter)</text></svg>"
    return "data:image/svg+xml,\(JSURI.encodeURIComponent(svg))"
  }

  static let postText = [
    "Spent the morning relabelling the seed jars. Found three kinds of bean I have no memory of buying.",
    "The library is doing a repair café on Saturday. Bring a lamp, a zip, a toaster, anything with one thing wrong with it.",
    "New essay is up: what a street tree costs a city, and what it gives back over forty years.",
    "Does anyone have a sourdough starter that survived a house move? Mine did not.",
    "Field notes, week 31. The swifts have gone, a full week earlier than last year.",
    "Finally read the book everyone told me to read in 2019. They were right, annoyingly.",
    "Rewrote the same paragraph six times and it is now the one I started with.",
    "A map of every public bench in the neighbourhood, with how long each one gets the afternoon sun.",
    "Hot take: the best feature of any app is an export button.",
    "Thread on what I learned running a community garden waiting list for four years. It is mostly about spreadsheets.",
    "The bus was on time and I do not know what to do with myself.",
    "Slides from last night are here, along with the three questions I could not answer.",
    "Looking for someone who can identify a moth from a very bad photo.",
    "Made the thing. It is small and it works. That is the whole post.",
    "I counted: 41 tabs open, 11 of them the same page.",
    "This is the clearest explanation of how handles and DIDs fit together that I have come across.",
    "Reminder that the allotment society AGM is on the 14th, and that there will be cake as a deliberate tactic.",
    "Three weeks of rain and the shed roof has finally told us where it leaks.",
    "Small request: if you make a chart, label the axes. Both of them.",
    "What I got wrong about composting, a list in nine parts.",
    "",
    "Good morning to the heron on the canal and to nobody else.",
    "We are hiring a part-time coordinator for the tool library. Details in the reply.",
    "Tried the new route to the market. Eleven minutes longer and much better.",
    "An appreciation post for people who write alt text.",
    "The data says Tuesday is when people read. The data did not say why.",
    "Somebody has been leaving tiny knitted hats on the bollards again and I would like to thank them.",
    "Notes from the atproto meetup: groups, permissions, and a very long conversation about moderation lists.",
    "Printed the zine. Folded 200 copies. My thumbs have opinions.",
    "A question for people who keep bees in a city: how do your neighbours feel about it now, a few years in?",
  ]

  // What the posts are made of, for the Content report: a few tags used
  // often and a few once, a handful of sites linked to, and the odd GIF.
  static let postTags = ["gardening", "fieldnotes", "atproto", "zines", "Cities", "bees", "repaircafe", "swifts"]
  static let postLinks = [
    "https://streettrees.example/essays/forty-years",
    "https://library.example/events/repair-cafe",
    "https://www.youtube.com/watch?v=harness",
    "https://allotments.example/agm",
    "https://streettrees.example/maps/benches",
  ]
  static let postGif = "https://media.tenor.com/harness/heron.gif"

  /// Other apps writing to the same repo, for the Atmosphere tab.
  static let otherCollections: [(String, Int)] = [
    ("fm.teal.alpha.feed.play", 2600),
    ("site.standard.document", 44),
    ("community.lexicon.calendar.rsvp", 58),
    ("sh.tangled.graph.follow", 23),
    ("app.bsky.graph.listitem", 131),
    ("app.bsky.graph.block", 17),
    ("social.popfeed.feed.review", 72),
    ("app.bsky.feed.threadgate", 9),
    ("blue.flashes.feed.post", 36),
  ]

  /// `new Date(ms).toISOString()`. The worlds only date things inside the
  /// range a Date can hold; outside it the web throws, and so does this.
  static func iso(_ ms: Double) -> String {
    guard let text = JSDate.toISOString(ms) else {
      preconditionFailure("RangeError: Invalid time value (\(ms))")
    }
    return text
  }

  static func floor(_ x: Double) -> Double { x.rounded(.down) }

  /// Build an account and what's around it. `now` anchors every date; the
  /// same `now`, seed and account give the same world. `account` is `me`
  /// (the default: the busy account with three years of history) or any
  /// other, which gets a small, quiet world (`lab`).
  ///
  /// Besides the fixtures, a world carries what the harness changes as the
  /// app is used (HarnessRepo): records written and deleted, uploaded blobs,
  /// all in memory.
  ///
  /// - Parameter now: epoch milliseconds, a time a Date can hold.
  public static func buildWorld(now: Double, seed: Double? = nil, account: WorldAccount = me) -> AccountWorld {
    if !account.did.jsEquals(me.did) {
      return buildQuietWorld(now: now, seed: seed ?? 20_261_113, account: account)
    }
    let seedValue = seed ?? 20_261_112
    var rand = mulberry(seedValue)
    func pick<T>(_ list: [T]) -> T { list[Int(floor(rand() * Double(list.count)))] }
    // A long tail: mostly small, now and then large.
    func tail(_ scale: Double) -> Double { floor(scale * (1 / (1 - rand() * 0.985) - 1)) }

    /* ---- the people around the account ---------------------------- */
    let cast = buildCast()
    // A few people do most of the engaging: weight toward the front of the cast.
    func castPick() -> WorldPerson {
      cast[Int(Swift.min(Double(cast.count - 1), floor(Double(cast.count) * JSMath.pow(rand(), 2.4))))]
    }

    /* ---- posts ---------------------------------------------------- */
    let span = 3.1 * 365 * day
    let start = now - span
    var posts: [WorldPost] = []
    // What each post is made of comes from a generator of its own, so
    // adding to it never moves the numbers the rest of the world is drawn from.
    var made = mulberry(seedValue + 97)
    func madePick<T>(_ list: [T]) -> T { list[Int(floor(made() * Double(list.count)))] }
    var opener: String? = nil  // the last top-level post, which a self-reply continues
    var lastInThread: String? = nil
    var t = start
    while t < now {
      // Busier lately, with one month off in the middle of last year.
      let age = (now - t) / span
      let quiet = age > 0.36 && age < 0.39
      let gap = (quiet ? 9 : 0.35 + age * 1.9) * day * (0.25 + rand() * 1.6)
      t += gap
      if t >= now { break }
      let reply = rand() < 0.38
      let selfReply = reply && rand() < 0.2
      let quote = !reply && rand() < 0.08
      let media = rand() < 0.22
      let text = pick(postText)
      // Engagement grows with the account, and one post in a few hundred runs away.
      let reach = (1.2 - age) * (reply ? 0.25 : 1) * (rand() < 0.006 ? 40 : 1)
      let likes = tail(9 * reach)
      let rkey = tid(t, posts.count)
      // Pictures mostly, a video now and then; one to four pictures, most
      // of them described. Posts without either sometimes carry a link or a GIF.
      let video = media && made() < 0.12
      let images = media && !video ? 1 + Int(floor(JSMath.pow(made(), 2) * 4)) : 0
      let described =
        made() < 0.7 ? (images != 0 ? images : 1) : made() < 0.5 ? Int(floor(Double(images != 0 ? images : 1) / 2)) : 0
      let linkRoll = made()
      let link: String? = !media && !quote && !reply && linkRoll < 0.16 ? madePick(postLinks) : nil
      let gif = !media && !quote && link == nil && linkRoll > 0.97
      let tagRoll = made()
      var tags: [String] = []
      if !reply {
        if tagRoll < 0.2 {
          tags = [postTags[Int(floor(JSMath.pow(made(), 2) * Double(postTags.count)))]]
        } else if tagRoll < 0.26 {
          let one = madePick(postTags)
          tags = [one, madePick(postTags)]
        }
      }
      // A self-reply continues the thread the last top-level post started.
      let thread: WorldThread? = selfReply ? opener.map { WorldThread(root: $0, parent: lastInThread ?? $0) } : nil
      if !reply {
        opener = rkey
        lastInThread = nil
      } else if thread != nil {
        lastInThread = rkey
      }
      let replyTo: String? = reply ? (selfReply ? me.did : castPick().did) : nil
      let quoteOf: String? = quote ? castPick().did : nil
      let langs = made() < 0.04 ? ["en", "fr"] : ["en"]
      let reposts = floor(likes * (0.08 + rand() * 0.2))
      let replies = floor(likes * (0.04 + rand() * 0.12))
      let quotes = floor(likes * rand() * 0.04)
      posts.append(
        WorldPost(
          fixture: .busy,
          rkey: rkey,
          at: iso(t),
          text: !text.isEmpty ? text : (media ? "" : "Morning."),
          replyTo: replyTo,
          quoteOf: quoteOf,
          media: media,
          video: video,
          images: images,
          described: described,
          link: link,
          gif: gif,
          tags: JSOrderedSet(tags).elements,
          thread: thread,
          langs: langs,
          likes: Int(likes),
          reposts: Int(reposts),
          replies: Int(replies),
          quotes: Int(quotes)
        ))
    }
    posts.reverse()  // newest first, as the author feed pages

    /* ---- followers ------------------------------------------------ */
    // An accelerating curve with two bursts, the newest first as
    // getFollowers pages. A handful carry a follow record with a
    // hand-written key, so they count toward the total and not toward the curve.
    let followerCount = 4810
    var followers: [WorldFollower] = []
    followers.reserveCapacity(followerCount)
    for i in 0..<followerCount {
      var frac = 1 - JSMath.pow(1 - Double(i) / Double(followerCount), 2.2)
      if i > 2900 && i < 3500 { frac = 0.705 + Double(i - 2900) / 600 / 60 }  // a post went round
      if i > 4300 && i < 4560 { frac = 0.948 + Double(i - 4300) / 260 / 120 }
      let at = start + frac * span - rand() * day * 0.5
      // Some of the people who engage are followers too; each of them once.
      let known: WorldPerson? = i % 61 == 0 && i / 61 < cast.count ? cast[i / 61] : nil
      let did = known.map(\.did).flatMap { $0.isEmpty ? nil : $0 } ?? "did:plc:virgaharnessfan\(String.zeroPadded(i, 5))"
      let handle = known.map(\.handle).flatMap { $0.isEmpty ? nil : $0 } ?? "reader\(i).example.com"
      let displayName: String
      if let name = known?.displayName, !name.isEmpty {
        displayName = name
      } else if i % 4 == 0 {
        displayName = ""
      } else {
        let firstName = pick(first)
        displayName = "\(firstName) \(pick(last))"
      }
      followers.append(
        WorldFollower(
          did: did,
          handle: handle,
          displayName: displayName,
          avatar: known?.avatar ?? "",
          viewer: .init(followedBy: "at://\(did)/app.bsky.graph.follow/\(i % 400 == 7 ? "self" : tid(at, i))")
        ))
    }
    followers.reverse()

    /* ---- who the account follows ---------------------------------- */
    let followedOnly = followedOnlyPeople()
    var follows: [WorldRecordRow] = []
    for (i, person) in cast.enumerated().filter({ $0.offset % 3 != 2 }).map(\.element).enumerated() {
      let at = now - (2 + Double(i) * 19 + rand() * 9) * day
      follows.append(followRow(me.did, person.did, at, i))
    }
    // The ones outside the cast were followed a while ago, without the RNG.
    for (i, person) in followedOnly.enumerated() {
      let at = now - (60 + Double(i) * 23) * day
      follows.append(followRow(me.did, person.did, at, 500 + i))
    }

    /* ---- notifications -------------------------------------------- */
    let reasons = ["like", "like", "like", "like", "repost", "reply", "reply", "quote", "mention", "follow"]
    var notifications: [WorldNotification] = []
    notifications.reserveCapacity(3400)
    for i in 0..<3400 {
      let at = now - JSMath.pow(rand(), 1.6) * 150 * day
      let who = castPick()
      let reason = pick(reasons)
      // What it was about: one of the account's posts, the recent ones more often.
      var about: WorldPost? = nil
      if ["like", "repost", "reply", "quote"].contains(reason) {
        let index = Int(floor(JSMath.pow(made(), 2) * Double(posts.count)))
        about = posts.indices.contains(index) ? posts[index] : nil
      }
      notifications.append(
        WorldNotification(
          uri: "at://\(who.did)/app.bsky.harness.\(reason)/\(tid(at, i))",
          reason: reason,
          reasonSubject: about.map { "at://\(me.did)/app.bsky.feed.post/\($0.rkey)" },
          author: who,
          record: .init(createdAt: iso(at)),
          indexedAt: iso(at + 900)
        ))
    }
    notifications.jsSort { a, b in a.indexedAt.jsLess(b.indexedAt) ? 1 : -1 }

    /* ---- likes and reposts given ---------------------------------- */
    func given(_ collection: String, _ count: Int) -> [WorldRecordRow] {
      var rows: [WorldRecordRow] = []
      rows.reserveCapacity(count)
      for i in 0..<count {
        let at = now - JSMath.pow(rand(), 1.3) * span
        let who = castPick()
        rows.append(givenRow(me.did, collection, who.did, at, i))
      }
      return rows.jsSorted { a, b in a.uri.jsLess(b.uri) ? 1 : -1 }
    }
    let likes = given("app.bsky.feed.like", 5200)
    let reposts = given("app.bsky.feed.repost", 430)

    /* ---- blocks --------------------------------------------------- */
    var blockers: [WorldBacklink] = []
    for i in 0..<148 {
      let at = now - JSMath.pow(rand(), 0.8) * span * 0.8
      blockers.append(
        WorldBacklink(
          did: "did:plc:virgaharnessblk\(String.zeroPadded(i, 4))", collection: "app.bsky.graph.block", rkey: tid(at, i)))
    }
    // Nine lists hold the account. Four are moderation lists with
    // subscribers; the rest are ordinary curation lists and block nobody.
    var lists: [WorldList] = []
    for i in 0..<9 {
      let owner = "did:plc:virgaharnesslst\(String.zeroPadded(i, 4))"
      let memberAt = now - (40 + Double(i) * 97 + rand() * 30) * day
      let mod = i % 2 == 0 && i < 8
      var subscribers: [WorldBacklink] = []
      if mod {
        let count = 30 + Int(floor(rand() * 260))
        for j in 0..<count {
          // Subscribed any time from a while before the account was added
          // to the list up to yesterday.
          let from = memberAt - 120 * day
          let at = from + rand() * (now - day - from)
          subscribers.append(
            WorldBacklink(
              // A few subscribers also block directly: one person, two paths.
              did: j % 23 == 0
                ? blockers[(i * 5 + j) % blockers.count].did
                : "did:plc:virgaharnesssub\(i)x\(String.zeroPadded(j, 4))",
              collection: "app.bsky.graph.listblock",
              rkey: tid(at, j)
            ))
        }
      }
      lists.append(
        WorldList(
          name: listNames[i],
          uri: "at://\(owner)/app.bsky.graph.list/\(tid(memberAt - 30 * day, i))",
          purpose: mod ? "app.bsky.graph.defs#modlist" : "app.bsky.graph.defs#curatelist",
          item: WorldBacklink(did: owner, collection: "app.bsky.graph.listitem", rkey: tid(memberAt, i)),
          subscribers: subscribers
        ))
    }

    /* ---- the rest of the repo ------------------------------------- */
    var others: [WorldOtherRecord] = []
    for (collection, count) in otherCollections {
      for i in 0..<count {
        let at = now - JSMath.pow(rand(), 1.2) * span * (collection.jsHasPrefix("fm.") ? 0.6 : 1)
        others.append(
          WorldOtherRecord(
            collection: collection, rkey: tid(at, i),
            value: ["$type": .string(collection), "createdAt": .string(iso(at))]))
      }
    }

    let profile = WorldProfile(
      did: me.did,
      handle: me.handle,
      displayName: me.displayName,
      avatar: avatarFor("M", 212),
      // The profile counter runs ahead of what can be listed, as it does
      // for real accounts: it still counts the deactivated and the deleted.
      followersCount: followerCount + 263,
      followsCount: follows.count,
      postsCount: posts.count,
      createdAt: iso(start)
    )

    var world = AccountWorld(
      me: me, now: now, start: start, profile: profile, cast: cast, followedOnly: followedOnly, posts: posts,
      followers: followers, follows: follows, notifications: notifications, likes: likes, reposts: reposts,
      blockers: blockers, lists: lists, others: others, feeds: [], ownLists: [], preferences: [], drafts: [],
      bookmarks: [], written: JSOrderedMap(), removed: JSOrderedSet(), blobs: JSOrderedMap(), revision: 0)
    withPostingFixtures(&world, miraPosting)
    return world
  }

  static func followRow(_ owner: String, _ subject: String, _ at: Double, _ clock: Int) -> WorldRecordRow {
    WorldRecordRow(
      uri: "at://\(owner)/app.bsky.graph.follow/\(tid(at, clock))",
      value: [
        "$type": "app.bsky.graph.follow", "subject": .string(subject), "createdAt": .string(iso(at)),
      ])
  }

  static func givenRow(_ owner: String, _ collection: String, _ author: String, _ at: Double, _ i: Int)
    -> WorldRecordRow
  {
    WorldRecordRow(
      uri: "at://\(owner)/\(collection)/\(tid(at, i))",
      value: [
        "$type": .string(collection),
        "subject": [
          "uri": .string("at://\(author)/app.bsky.feed.post/\(tid(at - 3_600_000, i))"), "cid": "bafyharness",
        ],
        "createdAt": .string(iso(at)),
      ])
  }

  /// The second account: five months old, a handful of posts, a few dozen
  /// followers drawn from the same cast, nothing pointing at it. Enough for
  /// the dashboard to draw something and for posting as it to show up
  /// somewhere.
  static func buildQuietWorld(now: Double, seed: Double, account: WorldAccount) -> AccountWorld {
    var rand = mulberry(seed)
    let cast = buildCast()
    let span = 140 * day
    let start = now - span
    var posts: [WorldPost] = []
    for i in 0..<9 {
      let at = start + (Double(i + 1) / 10) * span + rand() * day
      let likes = floor(rand() * 14)
      posts.append(
        WorldPost(
          fixture: .quiet,
          rkey: tid(at, i),
          at: iso(at),
          text: labPostText[i % labPostText.count],
          likes: Int(likes),
          reposts: Int(floor(likes / 4)),
          replies: Int(floor(likes / 5)),
          quotes: 0
        ))
    }
    posts.reverse()
    let followers = cast.prefix(40).enumerated().map { i, p in
      WorldFollower(
        did: p.did, handle: p.handle, displayName: p.displayName, avatar: p.avatar,
        viewer: .init(
          followedBy: "at://\(p.did)/app.bsky.graph.follow/\(tid(now - (Double(i) * 3 + 2) * day, 700 + i))"))
    }
    let follows = cast.prefix(12).enumerated().map { i, person in
      followRow(account.did, person.did, start + Double(i + 1) * 9 * day, i)
    }.jsSorted { a, b in a.uri.jsLess(b.uri) ? 1 : -1 }
    var notifications: [WorldNotification] = []
    for i in 0..<120 {
      let at = now - JSMath.pow(rand(), 1.4) * span
      let who = cast[Int(floor(rand() * 40))]
      let reason = ["like", "like", "repost", "reply", "follow"][i % 5]
      notifications.append(
        WorldNotification(
          uri: "at://\(who.did)/app.bsky.harness.\(reason)/\(tid(at, i))",
          reason: reason,
          reasonSubject: nil,
          author: who,
          record: .init(createdAt: iso(at)),
          indexedAt: iso(at + 900)
        ))
    }
    notifications.jsSort { a, b in a.indexedAt.jsLess(b.indexedAt) ? 1 : -1 }
    func given(_ collection: String, _ count: Int) -> [WorldRecordRow] {
      var rows: [WorldRecordRow] = []
      for i in 0..<count {
        let at = now - rand() * span
        let who = cast[Int(floor(rand() * Double(cast.count)))]
        rows.append(givenRow(account.did, collection, who.did, at, i))
      }
      return rows.jsSorted { a, b in a.uri.jsLess(b.uri) ? 1 : -1 }
    }
    let profile = WorldProfile(
      did: account.did,
      handle: account.handle,
      displayName: account.displayName,
      avatar: account.avatar,
      followersCount: followers.count + 4,
      followsCount: follows.count,
      postsCount: posts.count,
      createdAt: iso(start)
    )
    let likes = given("app.bsky.feed.like", 150)
    let reposts = given("app.bsky.feed.repost", 12)
    var world = AccountWorld(
      me: account, now: now, start: start, profile: profile, cast: cast, followedOnly: [], posts: posts,
      followers: followers, follows: follows, notifications: notifications, likes: likes, reposts: reposts,
      blockers: [], lists: [], others: [], feeds: [], ownLists: [], preferences: [], drafts: [], bookmarks: [],
      written: JSOrderedMap(), removed: JSOrderedSet(), blobs: JSOrderedMap(), revision: 0)
    withPostingFixtures(&world, labPosting)
    return world
  }

  static let labPostText = [
    "Field Lab is open on Thursdays from four. Bring a sample, leave with a label.",
    "This week: soil pH kits, and a long table of jars nobody has claimed.",
    "We have a new microscope on loan. It is older than all of us and works better.",
    "Notes from the river survey are up. Fewer snails than last year, more mayflies.",
    "Thank you to everyone who came to the open evening.",
  ]

  /// One post as its repo record, the shape both the feed and the CAR carry.
  public static func postRecord(_ post: WorldPost) -> JSONValue {
    if let record = post.record, record.isTruthy { return record }
    // Tags and a link sit at the end of the text, each with the facet that
    // makes it one. Facets index the text in UTF-8 bytes.
    var text = post.text
    var facets: [JSONValue] = []
    func append(_ word: String, _ feature: JSONValue) {
      text = !text.isEmpty ? "\(text) " : text
      let byteStart = text.utf8.count
      text += word
      facets.append([
        "index": ["byteStart": .number(Double(byteStart)), "byteEnd": .number(Double(text.utf8.count))],
        "features": [feature],
      ])
    }
    if let link = post.link, !link.isEmpty {
      let shown =
        link.jsHasPrefix("https://www.") ? link.jsSlice(12) : link.jsHasPrefix("https://") ? link.jsSlice(8) : link
      append(shown, ["$type": "app.bsky.richtext.facet#link", "uri": .string(link)])
    }
    for tag in post.tags { append("#\(tag)", ["$type": "app.bsky.richtext.facet#tag", "tag": .string(tag)]) }
    var record: [String: JSONValue] = [
      "$type": "app.bsky.feed.post",
      "text": .string(text),
      "createdAt": .string(post.at),
      "langs": .array((post.langs ?? ["en"]).map(JSONValue.string)),
    ]
    if !facets.isEmpty { record["facets"] = .array(facets) }
    // `${post.replyTo}` writes "null" for a fixture's null, "undefined" for a missing key.
    let replyText = post.replyTo ?? (post.fixture != nil ? "null" : "undefined")
    if let thread = post.thread {
      func ref(_ rkey: String) -> JSONValue {
        ["uri": .string("at://\(replyText)/app.bsky.feed.post/\(rkey)"), "cid": "bafyharness"]
      }
      record["reply"] = ["parent": ref(thread.parent), "root": ref(thread.root)]
    } else if let replyTo = post.replyTo, !replyTo.isEmpty {
      let parent: JSONValue = ["uri": .string("at://\(replyTo)/app.bsky.feed.post/\(post.rkey)"), "cid": "bafyharness"]
      record["reply"] = ["parent": parent, "root": parent]
    }
    var quoted: JSONValue? = nil
    if let quoteOf = post.quoteOf, !quoteOf.isEmpty {
      quoted = [
        "$type": "app.bsky.embed.record",
        "record": ["uri": .string("at://\(quoteOf)/app.bsky.feed.post/\(post.rkey)"), "cid": "bafyharness"],
      ]
    }
    let describedCount = post.described ?? 1
    func alt(_ i: Int) -> String { i < describedCount ? "A photo" : "" }
    var media: JSONValue? = nil
    if post.media {
      if post.video {
        var video: [String: JSONValue] = ["$type": "app.bsky.embed.video", "video": [:]]
        if !alt(0).isEmpty { video["alt"] = .string(alt(0)) }
        media = .object(video)
      } else {
        let count = post.images != 0 ? Swift.max(0, post.images) : 1
        media = [
          "$type": "app.bsky.embed.images",
          "images": .array((0..<count).map { i in ["alt": .string(alt(i)), "image": [:]] }),
        ]
      }
    }
    var card: JSONValue? = nil
    if post.gif {
      card = [
        "$type": "app.bsky.embed.external",
        "external": ["uri": .string(postGif), "title": "A heron", "description": ""],
      ]
    } else if let link = post.link, !link.isEmpty {
      card = [
        "$type": "app.bsky.embed.external",
        "external": ["uri": .string(link), "title": "A page", "description": ""],
      ]
    }
    if let quoted, let media {
      record["embed"] = ["$type": "app.bsky.embed.recordWithMedia", "record": quoted, "media": media]
    } else if let quoted {
      record["embed"] = quoted
    } else if let media {
      record["embed"] = media
    } else if let card {
      record["embed"] = card
    }
    return .object(record)
  }

  /// Every record in the repo as `(key, value)`, key-sorted, which is the
  /// order a repo's tree holds them in. What the page wrote comes first, so
  /// it wins over a fixture at the same key.
  public static func repoRecords(_ world: AccountWorld) -> [(key: String, value: JSONValue)] {
    var rows: [(key: String, value: JSONValue)] = world.written.entries.map { ($0.key, $0.value.value) }
    rows.append(
      ("app.bsky.actor.profile/self", ["$type": "app.bsky.actor.profile", "displayName": .string(world.profile.displayName)]))
    for post in world.posts { rows.append(("app.bsky.feed.post/\(post.rkey)", postRecord(post))) }
    for row in world.likes + world.reposts + world.follows {
      rows.append((row.uri.jsSplit("/").dropFirst(3).joined(separator: "/"), row.value))
    }
    for other in world.others { rows.append(("\(other.collection)/\(other.rkey)", other.value)) }
    var seen = JSOrderedSet()
    var kept: [(key: String, value: JSONValue)] = []
    kept.reserveCapacity(rows.count)
    for row in rows where !world.removed.has(row.key) && !seen.has(row.key) {
      seen.add(row.key)
      kept.append(row)
    }
    return kept.jsSorted { a, b in a.key.jsLess(b.key) ? -1 : b.key.jsLess(a.key) ? 1 : 0 }
  }
}

/// An exception the web code throws, by its class and message (RangeError,
/// TypeError).
public struct HarnessJSError: Error, Hashable, Sendable, LocalizedError {
  public var name: String
  public var message: String

  public init(name: String, message: String) {
    self.name = name
    self.message = message
  }

  public static func rangeError(_ message: String) -> Self { .init(name: "RangeError", message: message) }
  public static func typeError(_ message: String) -> Self { .init(name: "TypeError", message: message) }

  public var errorDescription: String? { message }
}
