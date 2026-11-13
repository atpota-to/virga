// Every /api/self-destruct/* route, in one function. `run` is the cron worker.

import { createRouter } from '../../server/route.js';
import create from '../../server/timers/handlers/create.js';
import list from '../../server/timers/handlers/list.js';
import cancel from '../../server/timers/handlers/cancel.js';
import run from '../../server/timers/handlers/run.js';

export default createRouter({ create, list, cancel, run }, { name: 'self-destruct' });
