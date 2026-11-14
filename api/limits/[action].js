// /api/limits/status, behind the same router as the other areas so it answers
// CORS, 404 and 500 the same way.

import { createRouter } from '../../server/route.js';
import status from '../../server/limits/handlers/status.js';

export default createRouter({ status }, { name: 'limits' });
