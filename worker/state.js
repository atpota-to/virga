// What the worker keeps between passes and restarts, in one JSON file in its
// data volume (WORKER_DATA_DIR, /data in the container): how far the
// moderator's chat log has been read, the moderator's session, and the
// questions the agent has put to owners and not had answered. No message
// text beyond a question's own description, and nothing about anyone's lists:
// those are Virga's, read through Vercel.
//
// Written whole to a temporary file and renamed over the old one, so a crash
// mid-write leaves the last good state. A lock file beside it, touched every
// pass, keeps a second copy of the worker on the same volume from reading
// the same log: two would answer every message twice.

import { mkdir, open, readFile, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FILE = 'moderator.json';
const LOCK = 'moderator.lock';
/** A lock not touched for this long belongs to a copy that has stopped. */
export const LOCK_STALE_MS = 3 * 60_000;
/** How long a question to an owner waits for a yes. */
export const PENDING_TTL_MS = 30 * 60_000;

const EMPTY = { cursor: null, seeded: false, session: null, pending: {} };

/** The worker's state in `dir`. Every method reads and writes the file itself, so nothing goes stale in memory. */
export function fileState(dir, { now = () => Date.now() } = {}) {
  const path = join(dir, FILE);
  const lockPath = join(dir, LOCK);

  async function read() {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'));
      return { ...EMPTY, ...parsed, pending: parsed?.pending && typeof parsed.pending === 'object' ? parsed.pending : {} };
    } catch {
      return { ...EMPTY, pending: {} };
    }
  }
  async function write(next) {
    await mkdir(dir, { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
    await rename(tmp, path);
  }
  async function update(fn) {
    const next = await fn(await read());
    await write(next);
    return next;
  }

  return {
    read,
    async setCursor(cursor) {
      await update((s) => ({ ...s, cursor: cursor ?? null, seeded: true }));
    },
    async setSession(session) {
      await update((s) => ({ ...s, session }));
    },
    /** The question waiting in a conversation, if it is still fresh. */
    async pending(convoId) {
      const p = (await read()).pending[convoId];
      return p && now() - p.at <= PENDING_TTL_MS ? p : null;
    },
    async setPending(convoId, question) {
      await update((s) => {
        const pending = Object.fromEntries(Object.entries(s.pending).filter(([, p]) => now() - p.at <= PENDING_TTL_MS));
        if (question) pending[convoId] = { ...question, at: now() };
        else delete pending[convoId];
        return { ...s, pending };
      });
    },

    /** Take the lock, or false when another live copy holds it. Touch it again each pass. */
    async lock() {
      await mkdir(dir, { recursive: true });
      try {
        const handle = await open(lockPath, 'wx');
        await handle.writeFile(`${process.pid}\n`);
        await handle.close();
        return true;
      } catch (err) {
        if (err?.code !== 'EEXIST') throw err;
        const info = await stat(lockPath).catch(() => null);
        if (info && now() - info.mtimeMs < LOCK_STALE_MS) return false;
        await unlink(lockPath).catch(() => {});
        return this.lock();
      }
    },
    async touch() {
      const t = new Date(now());
      await utimes(lockPath, t, t).catch(() => {});
    },
    async unlock() {
      await unlink(lockPath).catch(() => {});
    },
  };
}
