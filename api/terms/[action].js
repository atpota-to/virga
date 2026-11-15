// /api/terms/{status,accept}: who has agreed to the Terms of Service and
// Privacy Policy. Behind the same router as the other areas, so it answers
// CORS, 404 and 500 the same way.

import { createRouter } from '../../server/route.js';
import status from '../../server/terms/handlers/status.js';
import accept from '../../server/terms/handlers/accept.js';

export default createRouter({ status, accept }, { name: 'terms' });
