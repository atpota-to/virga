// POST /api/defense/unkeep { did }: stop keeping an account off every list.

import { keeper } from '../keeping.js';

export default keeper(true);
