// The transport the app sends real requests with: URLSession, on Apple
// platforms and on Linux (FoundationNetworking).
//
// A request's `timeoutMs` is a deadline on the whole exchange, as the web's
// `AbortSignal.timeout(ms)` is (URLRequest's own timeoutInterval only limits
// the wait between packets). The address is the string the web code built,
// read with the URL Standard's parser (WebURL) as `fetch` reads it, so an
// address the web sends (a space in a query, a non-ASCII host) is sent the
// same way and not refused by Foundation's stricter parser.

import Foundation
#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

public struct URLSessionTransport: HTTPTransport {
  public let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
    guard let parsed = try? WebURL(request.url), let url = URL(string: parsed.href) else {
      throw HTTPTransportError.invalidURL(request.url)
    }
    var urlRequest = URLRequest(url: url)
    urlRequest.httpMethod = request.method
    for field in request.headers {
      urlRequest.addValue(field.value, forHTTPHeaderField: field.name)
    }
    urlRequest.httpBody = request.body
    if let ms = request.timeoutMs, ms.isFinite, ms > 0 {
      urlRequest.timeoutInterval = ms / 1000
    }
    let session = self.session
    let sent = urlRequest
    return try await withDeadline(ms: request.timeoutMs) {
      try await Self.perform(sent, on: session)
    }
  }

  static func perform(_ request: URLRequest, on session: URLSession) async throws -> HTTPResponse {
    let (data, response): (Data, URLResponse)
    do {
      (data, response) = try await dataTask(request, on: session)
    } catch let error as URLError where error.code == .cancelled {
      throw CancellationError()
    } catch let error as URLError where error.code == .timedOut {
      throw HTTPTransportError.timedOut
    } catch is CancellationError {
      throw CancellationError()
    } catch {
      throw HTTPTransportError.network("fetch failed")
    }
    guard let http = response as? HTTPURLResponse else {
      throw HTTPTransportError.network("fetch failed")
    }
    var headers = HTTPHeaders()
    for (key, value) in http.allHeaderFields {
      headers.append(String(describing: key), String(describing: value))
    }
    return HTTPResponse(
      status: http.statusCode,
      statusText: "",
      headers: headers,
      body: data,
      url: http.url?.absoluteString ?? request.url?.absoluteString ?? ""
    )
  }

  /// The request as a data task that is cancelled with the Swift task.
  static func dataTask(_ request: URLRequest, on session: URLSession) async throws -> (Data, URLResponse) {
    let box = TaskBox()
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<(Data, URLResponse), any Error>) in
        let task = session.dataTask(with: request) { data, response, error in
          if let error {
            continuation.resume(throwing: error)
          } else if let response {
            continuation.resume(returning: (data ?? Data(), response))
          } else {
            continuation.resume(throwing: URLError(.badServerResponse))
          }
        }
        box.set(task)
        task.resume()
      }
    } onCancel: {
      box.cancel()
    }
  }

  /// Holds the data task so a cancellation that arrives from another thread
  /// can reach it.
  final class TaskBox: @unchecked Sendable {
    private let lock = NSLock()
    private var task: URLSessionDataTask?
    private var cancelled = false

    func set(_ task: URLSessionDataTask) {
      lock.lock()
      self.task = task
      let cancel = cancelled
      lock.unlock()
      if cancel { task.cancel() }
    }

    func cancel() {
      lock.lock()
      cancelled = true
      let task = self.task
      lock.unlock()
      task?.cancel()
    }
  }
}
