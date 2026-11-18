// Every /api/defense/* route, in one function. `run` is the list writer,
// called by Vercel Cron or by the worker; `moderator` is the worker's calls
// for the moderator it runs on the droplet (server/defense/handlers/run.js,
// moderator.js).

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
import moderator from '../../server/defense/handlers/moderator.js';
import link from '../../server/defense/handlers/link.js';
import linkCode from '../../server/defense/handlers/linkCode.js';
import unlink from '../../server/defense/handlers/unlink.js';
import linkList from '../../server/defense/handlers/linkList.js';

export default createRouter(
  { lists, 'list-create': listCreate, keep, unkeep, plan, approve, history, undo, run, moderator, link, 'link-code': linkCode, unlink, 'link-list': linkList },
  { name: 'defense' },
);
