// VirgaNetwork
//
// HTTP transport, the XRPC client, the public AppView, PDS and PLC resolution, Constellation, and Virga's own server API (/api/*). Ports src/lib/atproto.js, src/lib/constellation.js, src/session/pds.js, src/session/backendClient.js and the network helpers of src/posting/library/sources.js.
//
// See ios/PORTING.md for the conventions every file here follows.

import Foundation

/// The module's namespace, for version and identity.
public enum VirgaNetworkModule {
  public static let name = "VirgaNetwork"
}
