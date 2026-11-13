// Every /api/schedule/* route, in one function. `run` is the cron worker.

import { createRouter } from '../../server/route.js';
import create from '../../server/schedule/handlers/create.js';
import list from '../../server/schedule/handlers/list.js';
import get from '../../server/schedule/handlers/get.js';
import media from '../../server/schedule/handlers/media.js';
import update from '../../server/schedule/handlers/update.js';
import reorder from '../../server/schedule/handlers/reorder.js';
import cancel from '../../server/schedule/handlers/cancel.js';
import run from '../../server/schedule/handlers/run.js';

export default createRouter({ create, list, get, media, update, reorder, cancel, run }, { name: 'schedule' });
