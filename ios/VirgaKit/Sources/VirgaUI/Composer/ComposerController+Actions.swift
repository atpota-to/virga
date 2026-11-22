// Ports src/posting/composer/Composer.jsx (media, links found in the text, sending, splitting, starting over)

#if canImport(UIKit)
import AVFoundation
import Foundation
import VirgaCore
import VirgaNetwork
import VirgaPosting
import VirgaSession

/// Why a way of sending can be off for the moment: it still gets its button
/// at the foot, greyed (Composer.jsx's PASSING_BLOCKS).
let composerPassingBlocks = [
  ComposerActions.emptyHint, ComposerActions.overLimitHint, ComposerActions.mediaMissingHint,
  ComposerActions.videoPendingHint,
]

extension ComposerController {
  // MARK: Asking

  func askUser(_ question: ComposerAsk) async -> String? {
    await withCheckedContinuation { continuation in
      askResolve?.resume(returning: nil)
      askResolve = continuation
      ask = question
    }
  }

  func answer(_ value: String?) {
    let resolve = askResolve
    askResolve = nil
    ask = nil
    resolve?.resume(returning: value)
  }

  // MARK: Media

  func bump(_ postId: String, _ by: Int) {
    processing[postId] = max(0, (processing[postId] ?? 0) + by)
  }

  /// Files picked, pasted or dropped for a post.
  func addFiles(_ postId: String, _ files: [ComposerFile], allowVideo: Bool = true) async {
    let index = indexOfPost(postId)
    guard index >= 0 else { return }
    let post = state.posts[index]
    let sorted = ComposerMedia.sortIncomingFiles(
      files, imageCount: post.images.count + (processing[postId] ?? 0), hasVideo: post.video != nil,
      allowVideo: allowVideo)
    var notes = sorted.notes
    if let video = sorted.videoFile { await addVideo(postId, video, notes: &notes) }
    let images = sorted.imageFiles
    if !images.isEmpty {
      bump(postId, images.count)
      for file in images {
        do {
          let prepared = try await Images.prepareImage(file, encoder: ImageIOEncoder())
          let at = indexOfPost(postId)
          if at >= 0 { dispatch(.addImages(index: at, images: [Self.image(prepared, alt: "")])) }
        } catch {
          notes.append(Self.optionalMessage(error) ?? "An image couldn’t be added.")
        }
        bump(postId, -1)
      }
    }
    mediaNote = notes.joined(separator: " ")
  }

  /// Pictures that arrive with their alt text already written (an intent's).
  func addDescribedImages(_ postId: String, _ images: [JSONValue]) async {
    bump(postId, images.count)
    var notes: [String] = []
    for item in images {
      defer { bump(postId, -1) }
      guard let file = ComposerFile(json: item["file"]) else {
        notes.append("A picture couldn’t be added.")
        continue
      }
      do {
        let prepared = try await Images.prepareImage(file, encoder: ImageIOEncoder())
        let at = indexOfPost(postId)
        if at < 0 { break }
        dispatch(.addImages(index: at, images: [Self.image(prepared, alt: item["alt"]?.stringValue ?? "")]))
      } catch {
        notes.append(Self.optionalMessage(error) ?? "A picture couldn’t be added.")
      }
    }
    if !notes.isEmpty { mediaNote = notes.joined(separator: " ") }
  }

  static func optionalMessage(_ error: any Error) -> String? {
    let text = message(error)
    return text.isEmpty ? nil : text
  }

  /// `{ ...prepared, previewUrl, alt }`: the preview is the file itself.
  static func image(_ prepared: PreparedImage, alt: String) -> ComposerImage {
    var json = (try? JSONValue(encoding: prepared))?.objectValue ?? [:]
    json["file"] = prepared.file.json
    if let ref = prepared.file.ref { json["previewUrl"] = .string(URL(fileURLWithPath: ref).absoluteString) }
    json["alt"] = .string(alt)
    return ComposerImage(json: .object(json))
  }

  func addVideo(_ postId: String, _ file: ComposerFile, notes: inout [String]) async {
    let check = Video.validateVideoFile(file.json)
    if !check.ok {
      notes.append(check.message ?? "")
      return
    }
    var duration: Double?
    var aspectRatio: JSONValue?
    if let ref = file.ref {
      let asset = AVURLAsset(url: URL(fileURLWithPath: ref))
      if let time = try? await asset.load(.duration), time.seconds.isFinite { duration = time.seconds }
      aspectRatio = await Self.videoAspectRatio(asset)
    }
    if let duration, duration > Double(Video.videoMaxDurationSeconds) {
      let minutes = (Double(Video.videoMaxDurationSeconds) / 60).jsRounded
      notes.append("Videos can be up to \(JSNumber.format(minutes)) minutes long.")
      return
    }
    let index = indexOfPost(postId)
    guard index >= 0 else { return }
    var video: [String: JSONValue] = [
      "file": file.json, "mime": .string(file.type), "size": .number(file.size), "alt": "", "status": "idle",
      "duration": duration.map(JSONValue.number) ?? .null,
    ]
    // `videoSize`'s `{ width: videoWidth, height: videoHeight }`, which the
    // posted embed carries, so readers draw it in its own shape.
    if let aspectRatio { video["aspectRatio"] = aspectRatio }
    if let ref = file.ref { video["previewUrl"] = .string(URL(fileURLWithPath: ref).absoluteString) }
    dispatch(.setVideo(index: index, video: ComposerVideo(json: .object(video))))
    startVideoUploads()
  }

  /// The video's size as it's shown (its first video track, turned as it
  /// plays), in whole pixels as a video element's videoWidth and
  /// videoHeight are; nil when it can't be read.
  static func videoAspectRatio(_ asset: AVURLAsset) async -> JSONValue? {
    guard let track = try? await asset.loadTracks(withMediaType: .video).first,
      let natural = try? await track.load(.naturalSize)
    else { return nil }
    let transform = (try? await track.load(.preferredTransform)) ?? .identity
    let shown = CGRect(origin: .zero, size: natural).applying(transform)
    let width = abs(shown.width).rounded()
    let height = abs(shown.height).rounded()
    guard width > 0, height > 0 else { return nil }
    return ["width": .number(Double(width)), "height": .number(Double(height))]
  }

  func patchVideo(_ postId: String, _ file: ComposerFile, _ patch: [String: JSONValue], did: String? = nil) {
    let index = indexOfPost(postId)
    guard index >= 0, let video = state.posts[index].video, video.file == file else { return }
    if let did, !state.asDid.jsEquals(did) { return }
    var json = video.json.objectValue ?? [:]
    for (key, value) in patch { json[key] = value }
    dispatch(.setVideo(index: index, video: ComposerVideo(json: .object(json))))
  }

  /// What the web's upload effect hangs on ([open, state.posts,
  /// state.asDid]): each post's video, its status and its file, and the
  /// account. ComposerBody runs startVideoUploads whenever it changes while
  /// the sheet is up, so a video that arrives with a loaded post (a draft, a
  /// kept post's media, a scheduled post) starts uploading too.
  var videoUploadKey: String {
    let posts = state.posts.map { (post: PostDraft) -> String in
      guard let video = post.video else { return "\(post.id):-" }
      let file = video.file?.ref ?? video.file?.name ?? ""
      return "\(post.id):\(video.status):\(file)"
    }
    return state.asDid + "|" + posts.joined(separator: ",")
  }

  /// A video uploads as soon as it's added, as the account the post goes
  /// out as; changing that account starts it again.
  func startVideoUploads() {
    let did = state.asDid
    guard !did.isEmpty else { return }
    for post in state.posts {
      guard let video = post.video, let file = video.file, video.status == "idle" else { continue }
      if let job = videoJobs[post.id], job.file == file, job.did.jsEquals(did) { continue }
      videoJobs[post.id]?.task.cancel()
      startVideoUpload(post.id, file, did: did)
    }
  }

  func startVideoUpload(_ postId: String, _ file: ComposerFile, did: String) {
    let session = self.session
    let transport = self.transport
    patchVideo(postId, file, ["status": "uploading", "progress": 0, "error": .null])
    let task = Task {
      do {
        guard let ref = file.ref else { throw VideoError("The video needs to be added again.", code: "VIDEO_FAILED") }
        let data = try Data(contentsOf: URL(fileURLWithPath: ref))
        let target = try await session.targetFor(did)
        let result = try await Video.uploadVideo(
          VideoTarget(did: did, pdsUrl: target.pdsUrl, agent: target.agent), VideoFile(type: file.type, data: data),
          onProgress: { [weak self] progress in
            Task { @MainActor in
              let patch: [String: JSONValue] =
                progress.phase == "processing"
                ? ["status": "processing", "progress": .number(progress.progress?.doubleValue ?? 0)] : ["status": "uploading"]
              self?.patchVideo(postId, file, patch, did: did)
            }
          }, transport: transport)
        if Task.isCancelled { return }
        var ready: [String: JSONValue] = [
          "status": "ready", "blob": result.blob, "blobDid": .string(did), "progress": 100,
        ]
        if let jobId = result.jobId { ready["jobId"] = .string(jobId) }
        patchVideo(postId, file, ready, did: did)
      } catch {
        if Task.isCancelled { return }
        patchVideo(postId, file, ["status": "error", "error": .string(Self.optionalMessage(error) ?? "The video couldn’t be uploaded.")])
      }
      if videoJobs[postId]?.file == file { videoJobs[postId] = nil }
    }
    videoJobs[postId] = (file: file, did: did, task: task)
  }

  func removeVideo(_ index: Int) {
    guard state.posts.indices.contains(index) else { return }
    let post = state.posts[index]
    videoJobs[post.id]?.task.cancel()
    videoJobs[post.id] = nil
    dispatch(.setVideo(index: index, video: nil))
  }

  func retryVideo(_ index: Int) {
    guard state.posts.indices.contains(index), let video = state.posts[index].video else { return }
    var json = video.json.objectValue ?? [:]
    json["status"] = "idle"
    json["error"] = nil
    dispatch(.setVideo(index: index, video: ComposerVideo(json: .object(json))))
    startVideoUploads()
  }

  /// A paste of pictures (PostEditor's onPasteFiles): true when it took them.
  func pasteFiles(_ index: Int, _ items: [PastedItem], text: String?) -> Bool {
    let files = ComposerMedia.pastedImageFiles(items, text: text)
    guard !files.isEmpty, state.posts.indices.contains(index) else { return false }
    let postId = state.posts[index].id
    Task { await addFiles(postId, files, allowVideo: false) }
    return true
  }

  // MARK: Links found in the text: quotes and cards

  func dismissLink(_ postId: String, _ url: String?) {
    guard let url, !url.isEmpty else { return }
    dismissedLinks[postId, default: []].insert(JSKey(url))
  }

  func detected(_ postId: String, text: String, postEmbeds: [PostEmbedCandidate], externalLinks: [ExternalLinkCandidate]) {
    guard let post = state.posts.first(where: { $0.id.jsEquals(postId) }), post.text.jsEquals(text) else { return }
    let dismissed = dismissedLinks[postId] ?? []

    if post.record == nil, !recordLoading.contains(postId),
      let embed = postEmbeds.first(where: { !dismissed.contains(JSKey(text.jsSlice($0.charStart, $0.charEnd))) })
    {
      let span = text.jsSlice(embed.charStart, embed.charEnd)
      let lower = span.jsLowercased()
      let ref = ComposerIntent.readTargetRef(lower.hasPrefix("http://") || lower.hasPrefix("https://") ? span : "https://\(span)")
      dismissLink(postId, span)
      if let ref {
        recordLoading.insert(postId)
        let reads = ComposerReads.network(transport: transport)
        Task {
          defer { self.recordLoading.remove(postId) }
          guard let record = try? await ComposerLoaders.loadRecordTarget(ref.json, reads: reads) else { return }
          let at = self.indexOfPost(postId)
          guard at >= 0, self.state.posts[at].record == nil else { return }
          var json = record.objectValue ?? [:]
          json["sourceUrl"] = .string(span)
          self.dispatch(.setRecord(index: at, record: ComposerRecord(json: .object(json))))
          let now = self.state.posts[at].text
          let stripped = ComposerEditing.removeLinkFromText(now, charStart: embed.charStart, charEnd: embed.charEnd, expect: span)
          if !stripped.jsEquals(now) { self.dispatch(.setText(index: at, text: stripped)) }
        }
      }
    }

    let hasMedia = !post.images.isEmpty || post.video != nil
    if post.card == nil, !hasMedia, !cardLoading.contains(postId),
      let link = externalLinks.first(where: { !dismissed.contains(JSKey($0.url)) })
    {
      dismissLink(postId, link.url)
      cardLoading.insert(postId)
      let transport = self.transport
      Task {
        defer { self.cardLoading.remove(postId) }
        guard let card = await ComposerLinkCards.fetchLinkCard(link.url, transport: transport) else { return }
        let at = self.indexOfPost(postId)
        guard at >= 0 else { return }
        let now = self.state.posts[at]
        guard now.card == nil, now.images.isEmpty, now.video == nil else { return }
        self.dispatch(.setCard(index: at, card: card))
      }
    }
  }

  func removeCard(_ index: Int) {
    guard state.posts.indices.contains(index) else { return }
    let post = state.posts[index]
    dismissLink(post.id, post.card?.url)
    dispatch(.setCard(index: index, card: nil))
  }

  func removeRecord(_ index: Int) {
    guard state.posts.indices.contains(index) else { return }
    let post = state.posts[index]
    dismissLink(post.id, post.record?.json["sourceUrl"]?.stringValue)
    dispatch(.setRecord(index: index, record: nil))
  }

  // MARK: The post block's handlers

  func removePost(_ index: Int) async {
    guard state.posts.indices.contains(index) else { return }
    let post = state.posts[index]
    if !post.text.jsTrimmed().isEmpty || !post.images.isEmpty || post.video != nil || post.record != nil || post.card != nil {
      let ok = await askUser(
        ComposerAsk(
          title: "Remove post \(index + 1)?", body: "What’s written in it, and what it holds, goes too.",
          choices: [.init(value: "keep", label: "Keep it"), .init(value: "remove", label: "Remove it", danger: true)]))
      guard ok == "remove" else { return }
    }
    if post.video != nil { videoJobs[post.id]?.task.cancel() }
    dispatch(.removePost(index: index))
  }

  func addPost() {
    dispatch(.addPost(after: state.posts.count - 1))
    focusPostId = state.posts.last?.id
  }

  func dismissSplit() {
    splitDismissed = true
  }

  // MARK: Splitting and renumbering, and the step back

  func applyThreadEdit(_ plan: ThreadPlan?, focus: String?) {
    guard let plan else { return }
    dispatch(plan.action)
    threadUndo = plan.undo
    // The button pressed goes away with the offer, so the caret goes back
    // to the post (not on a phone, where it would raise the keys).
    if !narrow { focusPostId = focus }
  }

  var undoable: Bool { threadUndo.map { ThreadEdits.undoStands(state.posts, $0) } ?? false }

  func undoThreadEdit() {
    guard let undo = threadUndo, ThreadEdits.undoStands(state.posts, undo), let action = ThreadEdits.undoAction(undo)
    else { return }
    dispatch(action)
    threadUndo = nil
    if !narrow { focusPostId = undo["made"]?[0]?["id"]?.stringValue }
  }

  func split(_ postId: String, numbered: Bool) {
    applyThreadEdit(ThreadEdits.planSplit(state.posts, postId, numbering: numbered ? .counter : .off), focus: postId)
  }

  func renumber() {
    applyThreadEdit(ThreadEdits.planRenumber(state.posts), focus: state.posts.first?.id)
  }

  // MARK: Sending

  var actionSet: ComposerActionSet {
    let settings = self.settings
    var set = model.actions(
      defaultAction: settings.defaultAction, queue: settings.queue.json,
      caps: ComposerCaps(canPost: caps.canPost, canSchedule: caps.canSchedule), signedOut: signedOut,
      missingMedia: !DraftMedia.missingDraftMedia(state.json).isEmpty, postNow: postNow && state.schedule == nil,
      authMode: session.authMode)
    let replyBlocks: Bool
    switch loads["reply"] {
    case .loading?: replyBlocks = true
    case .failed(_, let soft)?: replyBlocks = !soft
    default: replyBlocks = false
    }
    applyScheduleRoom(&set)  // SCHEDULE: a full allowance is said before anyone tries.
    let blockedByLoad = loads["scheduled"] == .loading || loads["draft"] == .loading || loads["media"] == .loading || replyBlocks
    if blockedByLoad {
      var failed = false
      if case .failed? = loads["reply"] { failed = true }
      let reason =
        replyBlocks && failed ? "The post you’re replying to couldn’t be read." : "Still reading what this post needs."
      let off = ComposerActionState(disabled: true, reason: reason)
      set.actions.post = off
      set.actions.schedule = off
      set.actions.queue = off
      set.actions.draft = off
    }
    return set
  }

  /// The ways of sending with a button of their own beside the main one.
  var also: [String] {
    let set = actionSet
    return [PublishActions.draft, PublishActions.schedule].filter { action in
      let a = set.actions[action]
      return action != set.primary && (!a.disabled || composerPassingBlocks.contains(a.reason ?? ""))
    }
  }

  // ADVISER: a read holds the post still too.
  var disabled: Bool { busy != nil || adviserReading || loads["scheduled"] == .loading || loads["draft"] == .loading }

  func runAction(_ action: String) {
    guard busy == nil, !adviserReading else { return }  // ADVISER
    // A tag still being typed is part of what goes out (the web commits it
    // as the field loses focus to the button).
    commitTagDraft()
    switch action {
    case PublishActions.post:
      publishTask = Task { await submitPost() }
    case PublishActions.schedule, PublishActions.queue:
      runSchedule(action)  // SCHEDULE (ComposerController+Schedule.swift)
    case PublishActions.draft:
      publishTask = Task { await saveDraft() }
    default:
      break
    }
  }

  /// Sending the primary way from the keyboard (⌘↩).
  func sendFromKeyboard() {
    commitTagDraft()
    let set = actionSet
    guard !disabled else { return }
    let a = set.actions[set.primary]
    if !a.disabled {
      runAction(set.primary)
    } else {
      error = ComposerErrorLine(text: a.reason ?? "")
    }
  }

  func startBusy(_ action: String, _ line: String) -> Int {
    attempt += 1
    busy = ComposerBusy(action: action, line: line)
    return attempt
  }

  func endBusy(_ attempt: Int) {
    guard self.attempt == attempt else { return }
    busy = nil
  }

  func submitPost(skipAdviser: Bool = false) async {  // ADVISER: skipAdviser
    var s = state
    let did = s.asDid
    error = nil
    let a = actionSet.actions.post
    if a.disabled {
      error = ComposerErrorLine(text: a.reason ?? "", permission: !(a.reason ?? "").isEmpty && caps.canPost == false)
      return
    }
    let settings = self.settings
    // TIMER: a set time already passed is a problem only where a timer can be set.
    let fit = timerFit
    let at = now
    let problems = model.problems(
      now: Date(), requireAltText: settings.requireAltText,
      lifespanProblem: { rule in fit.available ? SelfDestruct.immediateTimerProblem(rule, at) : "" })
    if let first = problems.first {
      error = ComposerErrorLine(text: first.message)
      if let index = first.postIndex, state.posts.indices.contains(index) { focusPostId = state.posts[index].id }
      return
    }
    let attempt = startBusy(PublishActions.post, "Getting it ready")
    defer { endBusy(attempt) }
    var late = false
    do {
      // The same post twice within a couple of minutes is refused before
      // anything is asked (publish.js's guard, which publish remembers).
      if Publish.defaultDuplicateGuard.isDuplicate(Publish.publishSignature(s, did)) {
        throw PublishError("DUPLICATE", "This was just posted. Change something to post it again.")
      }
      // TIMER: no free timer of its kind is asked about before anything goes
      // (ComposerController+Timer.swift).
      guard let roomed = await askNoFreeTimer(s, fit: fit) else { return }
      s = roomed
      // ADVISER: the check before sending (ComposerController+Adviser.swift).
      if !skipAdviser {
        guard let checked = await adviserGate(s, attempt: attempt) else { return }
        s = checked
      }
      // TIMER: a set time that has passed stops it here; with no server to
      // arm it, the post goes out without its timer.
      s = try timerChecked(s, fit: fit)
      s = await ensureGates(s)
      let target = try await session.targetFor(did)
      busy?.cancellable = true
      let watch = ComposerSubmit.createPublishWatch(
        onSlow: { [weak self] in
          Task { @MainActor in
            guard let self, self.attempt == attempt else { return }
            self.busy?.slow = true
          }
        },
        onHard: { [weak self] in
          Task { @MainActor in
            guard let self else { return }
            self.endBusy(attempt)
            self.error = ComposerErrorLine(text: ComposerSubmit.hardPublishError)
          }
        })
      let snapshot = s
      let result: ComposerPublishResult
      do {
        result = try await publisher.publish(
          s, target: target, requireAltText: settings.requireAltText,
          onProgress: { [weak self] event in
            Task { @MainActor in self?.onPublishProgress(event, snapshot, attempt) }
          })
      } catch {
        late = watch.stop()
        throw error
      }
      late = watch.stop()
      // Awaited: the composer stays busy (and its buttons off) until the
      // post's source, a scheduled copy or a draft, is settled. The post is
      // out, so a Cancel tapped while it was written (it still shows while
      // the mentions resolve) doesn't reach these steps: they run in a task
      // of their own, as the web's afterPublished takes no signal, so the
      // draft is deleted and the scheduled copy cancelled all the same.
      let sent = s
      let wasLate = late
      await Task { await self.afterPublished(sent, result, late: wasLate) }.value
    } catch {
      if late { return }
      let view = ComposerSubmit.publishErrorView(error)
      if view.permission { permissionForced = true }
      if !view.silent { self.error = ComposerErrorLine(text: view.message, permission: view.permission, reauth: view.reauth) }
    }
  }

  /// The busy line's Cancel: only while it's offered (the web takes it away
  /// with the 'writing' event; a tap the sheet hasn't redrawn for since is
  /// too late).
  func cancelPublish() {
    guard busy?.cancellable == true else { return }
    publishTask?.cancel()
  }

  func ensureGates(_ s: ComposerState) async -> ComposerState {
    if s.reply != nil || s.gates.custom { return s }
    let agent = try? await session.agentFor(s.asDid)
    let r = await PostingSettingsStore.resolveDefaultGates(settingsFor(s.asDid), agent: agent?.gatesAgent)
    if state.asDid.jsEquals(s.asDid), !state.gates.custom { dispatch(.setDefaultGates(r.gates)) }
    var out = s
    out.json["gates"] = r.gates
    return out
  }

  func onPublishProgress(_ event: JSONValue, _ snapshot: ComposerState, _ attempt: Int) {
    if event["phase"] == "uploaded" {
      let at = event["postIndex"]?.intValue ?? -1
      guard snapshot.posts.indices.contains(at) else { return }
      let index = indexOfPost(snapshot.posts[at].id)
      guard index >= 0 else { return }
      let post = state.posts[index]
      let blob = event["blob"] ?? .null
      let blobDid = event["blobDid"] ?? .null
      if event["kind"] == "image", let id = event["id"]?.stringValue {
        dispatch(.updateImage(index: index, id: id, patch: ["blob": blob, "blobDid": blobDid]))
      } else if event["kind"] == "video", let video = post.video {
        var json = video.json.objectValue ?? [:]
        json["blob"] = blob
        json["blobDid"] = blobDid
        json["jobId"] = event["jobId"] ?? .null
        json["status"] = "ready"
        dispatch(.setVideo(index: index, video: ComposerVideo(json: .object(json))))
      } else if event["kind"] == "cardThumb", let card = post.card {
        var json = card.json.objectValue ?? [:]
        json["thumbBlob"] = blob
        json["thumbBlobDid"] = blobDid
        dispatch(.setCard(index: index, card: ComposerCard(json: .object(json))))
      }
      return
    }
    let line = ComposerSubmit.progressLine(event, posts: Double(snapshot.posts.count))
    guard self.attempt == attempt, busy != nil else { return }
    if event["phase"] == "writing" {
      busy?.line = line
      busy?.cancellable = false
    } else if let line {
      busy?.line = line
    }
  }

  func afterPublished(_ s: ComposerState, _ result: ComposerPublishResult, late: Bool) async {
    let did = s.asDid
    _ = try? PostingEvents.emitPostsChanged(did, added: result.written)
    let posted = ComposerSubmit.postedToast(account: accountJSON(did), did: did, root: result.root)
    let link = posted.href.flatMap { URL(string: $0) }.map { ToastLink("View it on Bluesky", url: $0) }
    toasts.push(posted.text, seconds: 9, link: link)
    for warning in result.warnings {
      if let text = warning["message"]?.stringValue { toasts.push(text, seconds: 7) }
    }
    // TIMER: the post's timer, armed on what was written (not waited for).
    armAfterPublish(s, result)
    // SCHEDULE: a post that came from a scheduled row takes the row off
    // (finishSource's scheduled half); if it can't, the post stays to try again.
    if s.source?.kind == "scheduled" {
      guard await finishScheduledSource(s) else { return }
    } else {
      // A post that came from a draft: the draft goes (ComposerSubmit's finishSource).
      await finishDraftSource(s)
    }
    // A post that landed after the composer gave up waiting: only clear
    // what the writer hasn't changed since.
    if late && changedSince(s) { return }
    resetAfterSend(did)
  }

  /// Whether the writer has changed the posts' words since `s` was sent.
  func changedSince(_ s: ComposerState) -> Bool {
    let now = state.posts
    return now.indices.contains { i in
      !(s.posts.indices.contains(i) && now[i].text.jsEquals(s.posts[i].text))
    }
  }

  func resetAfterSend(_ did: String) {
    let old = state
    autosaver.cancel()
    ComposerRestore.clearKept(did, store: store, now: now)
    if !old.asDid.jsEquals(did) { ComposerRestore.clearKept(old.asDid, store: store, now: now) }
    let home = activeDid.isEmpty ? did : activeDid
    loadState(baseState(home))
    scheduling.forget()  // SCHEDULE
    notices = []
    showTags = false
    tagDraft = ""
    error = nil
    closeSheet()
  }

  // MARK: Starting over, and closing

  func startOver(confirm: Bool = true) {
    Task {
      if confirm && !ComposerModel.isEmptyComposer(state) {
        let ok = await askUser(
          ComposerAsk(
            title: "Start over?", body: "What’s written here is cleared. Saved drafts and scheduled posts aren’t touched.",
            choices: [.init(value: "keep", label: "Keep it"), .init(value: "clear", label: "Clear it", danger: true)]))
        guard ok == "clear" else { return }
      }
      let did = state.asDid.isEmpty ? activeDid : state.asDid
      loadToken += 1
      autosaver.cancel()
      for job in videoJobs.values { job.task.cancel() }
      videoJobs = [:]
      ComposerRestore.clearKept(did, store: store, now: now)
      loadState(baseState(did))
      scheduling.forget()  // SCHEDULE
      loads = [:]
      notices = []
      error = nil
    }
  }

  func closeComposer() {
    autosaver.flush()
    closeSheet()
  }
}
#endif
