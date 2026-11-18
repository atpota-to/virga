// Every /api/defense/* route, in one function. `run` is the list writer,
// called by Vercel Cron or by the worker (server/defense/handlers/run.js).

import { createRouter } from '../../server/route.js';
import lists from '../../server/defense/handlers/lists.js';
import listCreate from '../../server/defense/handlers/listCreate.js';
import keep from '../../server/defense/handlers/keep.js';
import unkeep from '../../server/defense/handlers/unkeep.js';
import plan from '../../server/defense/handlers/plan.js';
import approve from '../../server/defense/handlers/approve.js';
import history from '../../server/defense/handlers/history.js';
import undo from '../../server/defense/handlers/undo.js';
import run from '../../server/defense/handlers/run.js';

export default createRouter({ lists, 'list-create': listCreate, keep, unkeep, plan, approve, history, undo, run }, { name: 'defense' });
