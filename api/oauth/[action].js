// Every /api/oauth/* route, in one function. The client metadata and JWKS are
// published as /api/oauth/client-metadata.json and /api/oauth/jwks.json. A
// rewrite in vercel.json strips the extension, but the dynamic segment may
// match the request before the rewrite does, so both spellings are answered.

import { createRouter } from '../../server/route.js';
import clientMetadata from '../../server/oauth/handlers/clientMetadata.js';
import jwks from '../../server/oauth/handlers/jwks.js';
import login from '../../server/oauth/handlers/login.js';
import callback from '../../server/oauth/handlers/callback.js';
import session from '../../server/oauth/handlers/session.js';
import proxy from '../../server/oauth/handlers/proxy.js';
import uploadBlob from '../../server/oauth/handlers/uploadBlob.js';
import logout from '../../server/oauth/handlers/logout.js';

export default createRouter(
  {
    'client-metadata': clientMetadata,
    'client-metadata.json': clientMetadata,
    jwks,
    'jwks.json': jwks,
    login,
    callback,
    session,
    proxy,
    'upload-blob': uploadBlob,
    logout,
  },
  { name: 'oauth' },
);
