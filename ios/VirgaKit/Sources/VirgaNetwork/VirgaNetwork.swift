// VirgaNetwork
//
// The networking layer every later target uses: HTTP, XRPC, the public
// AppView, PDS and PLC resolution, Constellation, blobs, and Virga's own
// server (/api/*). See ios/PORTING.md for the conventions every file follows.
//
//   HTTP/      HTTPRequest/HTTPResponse/HTTPHeaders, the HTTPTransport
//              protocol, URLSessionTransport, MockTransport (tests and the
//              demo), NetworkClock and HTTP (the app's default transport and
//              clock, as the web's global fetch and setTimeout), withDeadline
//   XRPC/      XRPCAgent (the web's @atproto/api Agent: calls, params,
//              labelers, proxy), XRPCFetchHandler (how a call is sent),
//              ServiceFetchHandler, XRPCError, XRPCParams, Pagination
//   Session/   BackendClient (src/session/backendClient.js: addresses,
//              sign-in, session checks, sign-out, requestError),
//              BackendFetchHandler (signed-in XRPC through Virga's server),
//              VirgaBackend (/api/<area>/<action>), APISurface (every server
//              route, classified), PDS (src/session/pds.js)
//   Lib/       Atproto, Constellation, Activity (src/lib/*.js)
//   Posting/   Blobs, AsyncPool (src/posting/lib), PublicAppView (the
//              public reads of src/posting/library/sources.js)
//   Support/   WebURL (the URL Standard's `new URL`), OrderedJSON (JSON with
//              Object.entries order), JSSort (V8's sort), JSONStringify,
//              PromiseCache, JSTruthy (`value || fallback` on JSONValue)

import Foundation

/// The module's namespace, for version and identity.
public enum VirgaNetworkModule {
  public static let name = "VirgaNetwork"
}
