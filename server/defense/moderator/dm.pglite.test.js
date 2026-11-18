// The moderator end to end: the worker's DM loop (worker/dmLoop.js) against
// a fake chat service, calling Vercel's moderator route in-process, signed,
// over the real store on PGlite, with two owners and a stranger. What it
// holds to is docs/DEFENSE.md ("The moderator's conversations, kept apart")
// and the phase 4 rules in docs/DEFENSE-THREATS.md: the sender is who the
// chat service says, everything runs as them on their own rows, someone
// unlinked learns nothing, each message is answered at most once, and the
// agent's writes go past the write check and the same store.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../../test/pglite.js';
import { createReq, createRes } from '../../test/http.js';
import { resetSupabaseClientForTests, setSupabaseClientForTests } from '../../supabase.js';
import { storeFor } from '../store.js';
import { hashLinkCode } from '../linking.js';
import moderatorRoute from '../handlers/moderator.js';
import { runDmPass } from '../../../worker/dmLoop.js';
import { fileState } from '../../../worker/state.js';
import { virgaClient } from '../../../worker/virga.js';
import { LINK_FAILED, NOT_A_COMMAND, STRANGER, WRITES_OFF } from './answer.js';

const MOD = 'did:plc:moderator';
const MIRA = 'did:plc:mira';
const LAB = 'did:plc:lab';
const STRANGER_DID = 'did:plc:stranger';
const TROLL = 'did:plc:troll';
const SECRET = 'w'.repeat(64);
const ENV = { DEFENSE_WRITES: 'on', OAUTH_PUBLIC_URL: 'https://virga.example', DEFENSE_WORKER_SECRET: SECRET };
const CREATE = 'chat.bsky.convo.defs#logCreateMessage';
const REACTION = 'chat.bsky.convo.defs#logAddReaction';
const HANDLES = { 'troll.example.com': TROLL, 'mira.example.com': MIRA, 'friend.example.com': 'did:plc:friend' };

let t;
beforeAll(async () => {
  t = await createTestDatabase();
  setSupabaseClientForTests(t.supabase);
});
afterAll(async () => {
  resetSupabaseClientForTests();
  await t?.close?.();
});

/** A chat service: a log of messages and reactions, the conversations they're in, and what the moderator sent. */
function fakeChat() {
  const logs = [];
  const convos = new Map();
  const sent = [];
  let rev = 0;
  let id = 0;
  const nextRev = () => `2222${String((rev += 1)).padStart(9, '0')}`;
  const push = (convoId, sender, message) => {
    const entry = { $type: CREATE, rev: nextRev(), convoId, message: { id: `m${(id += 1)}`, sentAt: new Date().toISOString(), sender: { did: sender }, ...message } };
    logs.push(entry);
    return entry;
  };
  const chat = {
    chat: {
      bsky: {
        convo: {
          getLog: async ({ cursor } = {}) => {
            const from = cursor ? logs.findIndex((l) => l.rev === cursor) + 1 : 0;
            const page = logs.slice(from, from + 50);
            return { data: { logs: page, cursor: page.at(-1)?.rev ?? cursor } };
          },
          getConvo: async ({ convoId }) => {
            if (!convos.has(convoId)) throw new Error('no such convo');
            return { data: { convo: convos.get(convoId) } };
          },
          getMessages: async ({ convoId, limit = 30 }) => ({
            data: {
              messages: logs
                .filter((l) => l.$type === CREATE && l.convoId === convoId)
                .map((l) => l.message)
                .reverse()
                .slice(0, limit),
            },
          }),
          sendMessage: async ({ convoId, message }) => {
            sent.push({ convoId, text: message.text });
            return { data: push(convoId, MOD, { text: message.text }).message };
          },
        },
      },
    },
  };
  return {
    chat,
    sent,
    logs,
    /** `from` DMs the moderator, in their one-to-one conversation (or `convo`). */
    dm(from, text, { convo = `convo-${from}`, group = false, ...rest } = {}) {
      if (!convos.has(convo)) convos.set(convo, { id: convo, members: group ? [{ did: from }, { did: MOD }, { did: 'did:plc:other' }] : [{ did: from }, { did: MOD }] });
      return push(convo, from, { text, ...rest });
    },
    /** `from` reacts to a message of the moderator's. */
    react(from, messageId, value) {
      logs.push({ $type: REACTION, rev: nextRev(), convoId: `convo-${from}`, message: { id: messageId, sender: { did: MOD } }, reaction: { value, sender: { did: from } } });
    },
    repliesTo: (from) => sent.filter((s) => s.convoId === `convo-${from}`).map((s) => s.text),
    lastIdTo: (from) => logs.filter((l) => l.convoId === `convo-${from}` && l.message?.sender?.did === MOD).at(-1)?.message.id,
  };
}

const as = (did) => storeFor(did, { client: t.supabase });
const names = () => ({
  resolve: async (actor) => (actor?.startsWith('did:') ? actor : HANDLES[actor] || null),
  handles: async () => new Map(Object.entries(HANDLES).map(([h, d]) => [d, h])),
});

let chat;
let made;
let scanned;
let dataDir;
/** What a scan by DM finds: `rows` as [did, band], everyone else protected. */
const scanOf = (rows, { protectedCount = 1, vouchCheck = 'canary' } = {}) => {
  const byBand = { PROTECTED: protectedCount, CONNECTED: 0, PERIPHERAL: 0, NOTABLE: 0, UNKNOWN: 0 };
  for (const [, band] of rows) byBand[band] += 1;
  return {
    post: { uri: `at://${TROLL}/app.bsky.feed.post/3abc` },
    vouchCheck,
    truncated: false,
    totals: { participants: rows.length + protectedCount, byBand },
    rows: rows.map(([did, band], i) => ({ did, band, trust: i })),
  };
};
let scanResult;
const scan = async (input) => {
  scanned.push(input);
  if (scanResult instanceof Error) throw scanResult;
  return scanResult;
};

/** Vercel's moderator route, in-process: what the worker's signed fetch reaches. */
function route({ env = ENV, fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    if (fail) return new Response(JSON.stringify({ success: false, error: 'down' }), { status: 500 });
    const req = createReq({ method: init.method, url: new URL(url).pathname, headers: init.headers, body: Buffer.from(init.body) });
    const res = createRes();
    await moderatorRoute(req, res, {
      env,
      deps: {
        answer: {
          names: names(),
          scan,
          createList: async ({ ownerDid, name, purpose }) => {
            made.push(name);
            return as(ownerDid).addList({ holderDid: ownerDid, mode: 'own', uri: `at://${ownerDid}/app.bsky.graph.list/${name.toLowerCase().replace(/\W/g, '')}`, name, purpose });
          },
        },
        ops: { names: names(), scan, lookUp: async () => ({ band: 'UNKNOWN', vouches: 0 }) },
      },
    });
    return new Response(JSON.stringify(res.body), { status: res.statusCode });
  };
  return { calls, virga: virgaClient({ base: 'https://virga.example', secret: SECRET, fetchImpl }) };
}

/** One pass of the worker's DM loop, typed commands only unless a model is given. */
function pass({ env, fail, model = null, modelFetch } = {}) {
  const { virga } = route({ env, fail });
  return runDmPass({ moderator: { did: MOD, chat: chat.chat }, state: fileState(dataDir), virga, model, fetchImpl: modelFetch });
}

async function linked(did, { lists = ['Pile-on'] } = {}) {
  const out = [];
  for (const name of lists) out.push(await as(did).addList({ holderDid: did, mode: 'own', uri: `at://${did}/app.bsky.graph.list/${name.toLowerCase().replace(/\W/g, '')}`, name, purpose: 'block' }));
  await as(did).linkCode(hashLinkCode(did, 'ABCDEFGH'), new Date(Date.now() + 60_000));
  await as(did).claimLink(hashLinkCode(did, 'ABCDEFGH'));
  return out;
}

/** Seed the log as a first pass would, so what follows is answered. */
async function seeded() {
  await pass();
}

beforeEach(async () => {
  await t.query(`TRUNCATE defense_link, defense_dm_stranger, defense_agent_usage, defense_decision, defense_job, defense_pace, defense_plan_row, defense_plan, defense_protected, defense_list CASCADE`);
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = await mkdtemp(join(tmpdir(), 'virga-dm-'));
  chat = fakeChat();
  made = [];
  scanned = [];
  scanResult = scanOf([]);
});

describe('a pass', () => {
  it('starts at the end of the log: what was sent before it ran is history', async () => {
    await linked(MIRA);
    chat.dm(MIRA, 'help');
    expect(await pass()).toMatchObject({ seeded: true, answered: 0 });
    expect(chat.sent).toEqual([]);
    chat.dm(MIRA, 'lists');
    expect(await pass()).toMatchObject({ answered: 1 });
    expect(chat.repliesTo(MIRA)).toHaveLength(1);
  });

  it('answers each message once, and never its own', async () => {
    await linked(MIRA);
    await seeded();
    chat.dm(MIRA, 'help');
    await pass();
    await pass();
    await pass();
    expect(chat.repliesTo(MIRA)).toHaveLength(1);
  });

  it('moves past a message before answering it, so one that fails isn’t answered again and again', async () => {
    await linked(MIRA);
    await seeded();
    chat.dm(MIRA, 'lists');
    const out = await pass({ fail: true });
    expect(out.errors).toHaveLength(1);
    expect(chat.repliesTo(MIRA)).toEqual(['Something went wrong on my side, and nothing was changed. Try again in a minute.']);
    await pass();
    expect(chat.repliesTo(MIRA)).toHaveLength(1);
  });

  it('is refused by Vercel when it isn’t signed, or signed for another body', async () => {
    await linked(MIRA);
    const body = Buffer.from(JSON.stringify({ op: 'message', owner: MIRA, message: { text: 'lists' } }));
    const { signWorkerRequest } = await import('../workerAuth.js');
    const call = async (headers) => {
      const res = createRes();
      await moderatorRoute(createReq({ method: 'POST', url: '/api/defense/moderator', headers, body }), res, { env: ENV });
      return res.statusCode;
    };
    expect(await call({})).toBe(401);
    expect(await call({ 'x-virga-worker': signWorkerRequest({ secret: SECRET, path: '/api/defense/moderator', body: '{"op":"message","owner":"did:plc:lab"}' }) })).toBe(401);
    expect(await call({ 'x-virga-worker': signWorkerRequest({ secret: SECRET, path: '/api/defense/run', body }) })).toBe(401);
    expect(await call({ 'x-virga-worker': signWorkerRequest({ secret: SECRET, path: '/api/defense/moderator', body }) })).toBe(200);
  });

  it('runs an agent’s tools only for a linked owner', async () => {
    const { virga } = route();
    await expect(virga.call('tool', { owner: LAB, name: 'lists', args: {} })).rejects.toMatchObject({ status: 403, code: 'NOT_LINKED' });
    await expect(virga.call('turn', { owner: STRANGER_DID })).rejects.toMatchObject({ code: 'NOT_LINKED' });
  });

  it('doesn’t answer in a group, where everyone would read it', async () => {
    await linked(MIRA);
    await seeded();
    chat.dm(MIRA, 'lists', { convo: 'group-1', group: true });
    expect(await pass()).toMatchObject({ answered: 0, skipped: 1 });
    expect(chat.sent).toEqual([]);
  });

  it('says once that it missed what was sent more than an hour ago', async () => {
    await linked(MIRA);
    await seeded();
    const old = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    chat.dm(MIRA, 'block @troll.example.com', { sentAt: old });
    chat.dm(MIRA, 'lists', { sentAt: old });
    await pass();
    expect(chat.repliesTo(MIRA)).toEqual([expect.stringMatching(/^I was away/)]);
    expect(await as(MIRA).history()).toEqual([]);
  });

  it('cuts a long reply into messages the chat service takes', async () => {
    await linked(MIRA, { lists: Array.from({ length: 30 }, (_, i) => `A list with a long name, number ${i}`) });
    await seeded();
    chat.dm(MIRA, 'lists');
    await pass();
    expect(chat.repliesTo(MIRA).length).toBeGreaterThan(1);
    expect(chat.repliesTo(MIRA).every((m) => m.length <= 950)).toBe(true);
  });
});

describe('someone who hasn’t linked', () => {
  it('gets one line, the same whoever they are, at most once a day', async () => {
    await as(LAB).addList({ holderDid: LAB, mode: 'own', uri: `at://${LAB}/app.bsky.graph.list/x`, name: 'X', purpose: 'block' });
    await seeded();
    // A stranger, and a Virga user who never linked: the same answer.
    chat.dm(STRANGER_DID, 'block @troll.example.com');
    chat.dm(LAB, 'lists');
    chat.dm(STRANGER_DID, 'help');
    await pass();
    expect(chat.repliesTo(STRANGER_DID)).toEqual([STRANGER]);
    expect(chat.repliesTo(LAB)).toEqual([STRANGER]);
    expect(await as(LAB).history()).toEqual([]);
  });

  it('can’t link with another account’s code', async () => {
    await as(MIRA).linkCode(hashLinkCode(MIRA, 'ABCDEFGH'), new Date(Date.now() + 60_000));
    await seeded();
    chat.dm(TROLL, 'link ABCD-EFGH');
    await pass();
    expect(chat.repliesTo(TROLL)).toEqual([LINK_FAILED]);
    expect(await as(TROLL).link()).toBeNull();
    // Mira's code still works, from Mira.
    chat.dm(MIRA, 'link abcd-efgh');
    await pass();
    expect(chat.repliesTo(MIRA)[0]).toMatch(/^Linked\./);
    expect((await as(MIRA).link()).linked_at).not.toBeNull();
  });
});

describe('a linked owner', () => {
  it('is told what isn’t a command, and what is', async () => {
    await linked(MIRA);
    await seeded();
    chat.dm(MIRA, 'hello there');
    chat.dm(MIRA, 'block them');
    await pass();
    expect(chat.repliesTo(MIRA)[0]).toBe(NOT_A_COMMAND);
    expect(chat.repliesTo(MIRA)[1]).toMatch(/^Who\?/);
  });

  it('blocks someone named, on their own list, and takes them back', async () => {
    const [list] = await linked(MIRA);
    await linked(LAB, { lists: ['Lab list'] });
    await seeded();
    chat.dm(MIRA, 'block @troll.example.com');
    await pass();
    expect(chat.repliesTo(MIRA)[0]).toMatch(/^Adding @troll\.example\.com to “Pile-on”/);
    const [d] = await as(MIRA).history();
    expect(d).toMatchObject({ subject_did: TROLL, list_id: list.id, via: 'dm', state: 'queued', note: 'block @troll.example.com' });
    expect(await as(LAB).history()).toEqual([]);

    chat.dm(MIRA, 'block @troll.example.com');
    chat.dm(MIRA, 'undo');
    await pass();
    expect(chat.repliesTo(MIRA)[1]).toMatch(/on “Pile-on” already/);
    expect(chat.repliesTo(MIRA)[2]).toMatch(/^Taking back the last account added: 1 not written yet, cancelled/);
    expect(await as(MIRA).liveAdds(TROLL)).toEqual([]);
  });

  it('asks which list when there is more than one and none is chosen', async () => {
    const [, second] = await linked(MIRA, { lists: ['One', 'Two'] });
    await seeded();
    chat.dm(MIRA, 'block @troll.example.com');
    await pass();
    expect(chat.repliesTo(MIRA)[0]).toMatch(/more than one list/);
    await as(MIRA).setLinkList(second.id);
    chat.dm(MIRA, 'block @troll.example.com');
    await pass();
    expect(chat.repliesTo(MIRA)[1]).toMatch(/to “Two”/);
  });

  it('keeps someone by hand, and then won’t block them', async () => {
    await linked(MIRA);
    await seeded();
    chat.dm(MIRA, 'keep @friend.example.com because we go back');
    chat.dm(MIRA, 'block @friend.example.com');
    chat.dm(MIRA, 'unkeep @friend.example.com');
    await pass();
    const replies = chat.repliesTo(MIRA);
    expect(replies[0]).toMatch(/^Kept @friend\.example\.com/);
    expect(replies[1]).toMatch(/keep @friend\.example\.com by hand/);
    expect(replies[2]).toMatch(/isn’t kept by hand any more/);
    expect(await as(MIRA).kept()).toEqual([]);
  });

  it('blocks the author of a shared post, and asks when the words might mean someone else', async () => {
    await linked(MIRA);
    await seeded();
    const embed = { $type: 'app.bsky.embed.record#view', record: { uri: `at://${TROLL}/app.bsky.feed.post/3abc` } };
    chat.dm(MIRA, 'block whoever is in the replies', { embed });
    chat.dm(MIRA, 'block this guy', { embed });
    await pass();
    expect(chat.repliesTo(MIRA)[0]).toMatch(/^Do you mean @troll\.example\.com/);
    expect(chat.repliesTo(MIRA)[1]).toMatch(/^Adding @troll\.example\.com/);
    expect((await as(MIRA).history()).map((d) => d.subject_did)).toEqual([TROLL]);
  });

  it('approves, reviews and cancels plans by their code, and only their own', async () => {
    const [list] = await linked(MIRA);
    const [labList] = await linked(LAB, { lists: ['Lab'] });
    const planId = await as(MIRA).createPlan({
      listId: list.id,
      rows: [
        { did: 'did:plc:u1', band: 'UNKNOWN', trust: 1 },
        { did: 'did:plc:u2', band: 'UNKNOWN', trust: 2 },
        { did: 'did:plc:near', band: 'CONNECTED', trust: 80 },
      ],
    });
    const other = await as(MIRA).createPlan({ listId: list.id, rows: [{ did: 'did:plc:x', band: 'UNKNOWN', trust: 1 }] });
    const labPlan = await as(LAB).createPlan({ listId: labList.id, rows: [{ did: 'did:plc:y', band: 'UNKNOWN', trust: 1 }] });
    const code = (id) => id.replace(/-/g, '').slice(0, 8);
    await seeded();
    chat.dm(MIRA, `review ${code(planId)}`);
    chat.dm(MIRA, `approve ${code(planId)} UNKNOWN`);
    chat.dm(MIRA, `cancel ${code(other)}`);
    chat.dm(MIRA, `approve ${code(labPlan)} UNKNOWN`);
    chat.dm(MIRA, `approve ${code(planId)} UNKNOWN except @friend.example.com`);
    await pass();
    const replies = chat.repliesTo(MIRA);
    expect(replies[0]).toMatch(/: 2 with no connection, 1 connected\./);
    expect(replies[0]).toMatch(/Not approved yet/);
    expect(replies[1]).toMatch(new RegExp(`^Approved ${code(planId)}: 2 queued for “Pile-on”`));
    expect(replies[2]).toMatch(/^Dropped plan/);
    expect(replies[3]).toBe(`You have no plan ${code(labPlan)}.`);
    expect(replies[4]).toMatch(/I haven’t added anyone/);
    expect(await as(MIRA).plan(other)).toBeNull();
    expect(await as(LAB).plan(labPlan)).not.toBeNull();
    expect((await as(LAB).history()).length).toBe(0);
    expect((await as(MIRA).liveAdds('did:plc:near')).length).toBe(0);
  });

  it('says what it can’t do while writes are off, and still undoes', async () => {
    await linked(MIRA);
    await seeded();
    chat.dm(MIRA, 'block @troll.example.com');
    await pass({ env: { ...ENV, DEFENSE_WRITES: 'off' } });
    expect(chat.repliesTo(MIRA)).toEqual([WRITES_OFF]);
  });

  it('reads the history, all of it or one account’s', async () => {
    const [list] = await linked(MIRA);
    await as(MIRA).addNamed(list.id, TROLL, { note: 'block @troll.example.com', via: 'dm' });
    await as(MIRA).addNamed(list.id, 'did:plc:other', { via: 'dm' });
    await seeded();
    chat.dm(MIRA, 'history @troll.example.com');
    chat.dm(MIRA, 'history');
    await pass();
    const [one, all] = chat.repliesTo(MIRA);
    expect(one).toMatch(/^• @troll\.example\.com: Waiting to be added · “Pile-on”/);
    expect(one.split('\n')).toHaveLength(1);
    expect(all.split('\n')).toHaveLength(2);
  });

  it('makes a list in their repo and adds to it from then on', async () => {
    await as(MIRA).linkCode(hashLinkCode(MIRA, 'ABCDEFGH'), new Date(Date.now() + 60_000));
    await as(MIRA).claimLink(hashLinkCode(MIRA, 'ABCDEFGH'));
    await seeded();
    chat.dm(MIRA, 'new list called Pile-ons');
    chat.dm(MIRA, 'block @troll.example.com');
    await pass();
    expect(made).toEqual(['Pile-ons']);
    expect(chat.repliesTo(MIRA)[0]).toMatch(/^Made “Pile-ons” in your repo/);
    expect(chat.repliesTo(MIRA)[1]).toMatch(/to “Pile-ons”/);
  });

  it('acts only on their own rows, whatever another owner sends', async () => {
    const [list] = await linked(MIRA);
    await linked(LAB, { lists: ['Lab'] });
    await as(MIRA).addNamed(list.id, TROLL, { via: 'web' });
    await seeded();
    chat.dm(LAB, 'undo');
    chat.dm(LAB, `unblock @troll.example.com`);
    chat.dm(LAB, 'history @troll.example.com');
    chat.dm(LAB, 'lists');
    await pass();
    expect(await as(MIRA).liveAdds(TROLL)).toHaveLength(1);
    const replies = chat.repliesTo(LAB).join('\n');
    expect(replies).not.toMatch(/Pile-on/);
    expect(chat.repliesTo(LAB)[0]).toMatch(/^Nothing is on your lists/);
  });
});

describe('a post sent to the moderator', () => {
  const POST = 'https://bsky.app/profile/troll.example.com/post/3abc';

  it('is scanned, kept as a plan, and added only when approved', async () => {
    const [list] = await linked(MIRA);
    scanResult = scanOf([
      ['did:plc:u1', 'UNKNOWN'],
      ['did:plc:u2', 'UNKNOWN'],
      ['did:plc:n1', 'NOTABLE'],
      ['did:plc:c1', 'CONNECTED'],
    ]);
    await seeded();
    chat.dm(MIRA, POST);
    await pass();
    const [reply] = chat.repliesTo(MIRA);
    expect(reply).toMatch(/^Scanned 5 who engaged: 2 with no connection, 1 notable, 1 connected, 1 protected, never added\./);
    const code = /Plan ([0-9a-f]{8}), for “Pile-on”/.exec(reply)[1];
    expect(reply).toContain(`“approve ${code} UNKNOWN” adds the 2 with no connection.`);
    // Nothing added yet: a scan is read-only until approved.
    expect(await as(MIRA).history()).toEqual([]);
    const [plan] = await as(MIRA).plansByCode(code);
    expect(plan).toMatchObject({ list_id: list.id, post_uri: `at://${TROLL}/app.bsky.feed.post/3abc`, approved_at: null });
    // The scan was asked for the post in the owner's own message, as the owner.
    expect(scanned[0]).toMatchObject({ ownerDid: MIRA, input: POST, only: null });

    chat.dm(MIRA, `approve ${code} UNKNOWN`);
    await pass();
    expect(chat.repliesTo(MIRA)[1]).toMatch(new RegExp(`^Approved ${code}: 2 queued`));
    expect((await as(MIRA).history()).map((d) => d.subject_did).sort()).toEqual(['did:plc:u1', 'did:plc:u2']);
  });

  it('reads only the engagement asked for, from a shared post too', async () => {
    await linked(MIRA);
    scanResult = scanOf([['did:plc:u1', 'UNKNOWN']]);
    await seeded();
    chat.dm(MIRA, 'add repliers', { embed: { $type: 'app.bsky.embed.record#view', record: { uri: `at://${TROLL}/app.bsky.feed.post/3abc` } } });
    await pass();
    expect(scanned[0]).toMatchObject({ input: `at://${TROLL}/app.bsky.feed.post/3abc`, only: ['reply', 'threadReply'] });
    expect(chat.repliesTo(MIRA)[0]).toMatch(/^Scanned 2 repliers:/);
  });

  it('offers nothing to approve when the vouches couldn’t be counted', async () => {
    await linked(MIRA);
    scanResult = scanOf([['did:plc:u1', 'UNKNOWN']], { vouchCheck: 'none' });
    await seeded();
    chat.dm(MIRA, POST);
    await pass();
    expect(chat.repliesTo(MIRA)[0]).toMatch(/nothing from this scan can be approved/);
    expect(await as(MIRA).plans()).toEqual([]);
  });

  it('points a post too big for a DM at the web, and says what else went wrong', async () => {
    await linked(MIRA);
    const { DmScanError } = await import('./scan.js');
    await seeded();
    scanResult = new DmScanError('That post has more engagement than I can read in a DM.', 'TOO_BIG');
    chat.dm(MIRA, POST);
    await pass();
    expect(chat.repliesTo(MIRA)[0]).toMatch(/Scan it on the web, where there’s no time limit: https:\/\/virga\.example\/defense$/);
    scanResult = new DmScanError('Scanning by DM needs your long session on Virga’s server.', 'SIGNED_OUT');
    chat.dm(MIRA, POST);
    await pass();
    expect(chat.repliesTo(MIRA)[1]).toMatch(/long session/);
  });

  it('isn’t scanned for someone who hasn’t linked', async () => {
    await seeded();
    chat.dm(STRANGER_DID, POST);
    await pass();
    expect(scanned).toEqual([]);
    expect(chat.repliesTo(STRANGER_DID)).toEqual([STRANGER]);
  });
});

describe('the agent, end to end', () => {
  const MODEL = { apiKey: 'k', baseUrl: 'https://gw.example/v1', agent: 'agent/model', check: 'check/model', zeroDataRetention: false };

  /** A gateway answering the agent's steps in order, and the check with `check`. */
  function gateway({ steps = [], check = 'YES\nThey asked.' } = {}) {
    const asked = { agent: [], check: [] };
    let i = 0;
    const fetchImpl = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      const ok = (message) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
      if (body.model === MODEL.check) {
        asked.check.push(body);
        return ok({ role: 'assistant', content: check });
      }
      asked.agent.push(body);
      const step = steps[i++] ?? 'Done.';
      if (typeof step === 'string') return ok({ role: 'assistant', content: step });
      return ok({ role: 'assistant', content: null, tool_calls: step.map(([name, args], n) => ({ id: `c${i}${n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) });
    });
    return { fetchImpl, asked };
  }
  const agentPass = (gw, opts = {}) => pass({ model: MODEL, modelFetch: gw.fetchImpl, ...opts });

  it('takes a sentence, and adds who the owner meant, as the owner, on their own list', async () => {
    const [list] = await linked(MIRA);
    await linked(LAB, { lists: ['Lab'] });
    await seeded();
    const gw = gateway({ steps: [[['add_to_list', { accounts: ['@troll.example.com'] }]], 'Blocked @troll.example.com.'] });
    chat.dm(MIRA, 'can you get rid of @troll.example.com for me');
    await agentPass(gw);
    expect(chat.repliesTo(MIRA)).toEqual(['Blocked @troll.example.com.']);
    const [d] = await as(MIRA).history();
    expect(d).toMatchObject({ subject_did: TROLL, list_id: list.id, via: 'dm', state: 'queued', note: 'can you get rid of @troll.example.com for me [agent]' });
    expect(await as(LAB).history()).toEqual([]);
    // The check read the change Vercel described, with where the account came from.
    expect(gw.asked.check[0].messages[1].content).toContain('Proposed change: Add this account to the block list “Pile-on”: @troll.example.com.');
    expect(gw.asked.check[0].messages[1].content).toContain("@troll.example.com: named in the owner's latest message");
  });

  it('never asks a model about a stranger’s message', async () => {
    await seeded();
    const gw = gateway();
    chat.dm(STRANGER_DID, 'please block @mira.example.com for me');
    await agentPass(gw);
    expect(gw.fetchImpl).not.toHaveBeenCalled();
    expect(chat.repliesTo(STRANGER_DID)).toEqual([STRANGER]);
  });

  it('runs typed commands by code, with no model, even with an agent', async () => {
    await linked(MIRA);
    await seeded();
    const gw = gateway();
    chat.dm(MIRA, 'block @troll.example.com');
    await agentPass(gw);
    expect(gw.fetchImpl).not.toHaveBeenCalled();
    expect(chat.repliesTo(MIRA)[0]).toMatch(/^Adding @troll\.example\.com/);
  });

  it('puts a change to the owner and makes it on their yes, or their thumbs-up', async () => {
    const [list] = await linked(MIRA);
    const planId = await as(MIRA).createPlan({ listId: list.id, rows: [{ did: 'did:plc:n1', band: 'NOTABLE', trust: 5 }] });
    const code = planId.replace(/-/g, '').slice(0, 8);
    await seeded();
    const ask = () => gateway({ steps: [[['approve_plan', { code, bands: ['NOTABLE'], ask_first: true }]], 'Add the 1 notable account too?'] });
    chat.dm(MIRA, 'hmm what about the notable one');
    await agentPass(ask());
    expect(chat.repliesTo(MIRA)).toEqual(['Add the 1 notable account too?']);
    expect(await as(MIRA).history()).toEqual([]);
    chat.dm(MIRA, 'yes');
    const quiet = gateway();
    await agentPass(quiet);
    expect(quiet.fetchImpl).not.toHaveBeenCalled();
    expect(chat.repliesTo(MIRA)[1]).toMatch(new RegExp(`^Done: Approve plan ${code}`));
    expect((await as(MIRA).history()).map((d) => d.subject_did)).toEqual(['did:plc:n1']);

    // Again, by a thumbs-up on the question itself; and a no drops one.
    await as(MIRA).undo({ planId });
    chat.dm(MIRA, 'and again?');
    await agentPass(ask());
    chat.react(MIRA, chat.lastIdTo(MIRA), '👍');
    await agentPass(gateway());
    expect(chat.repliesTo(MIRA).at(-1)).toMatch(/^Done: Approve plan/);
    chat.dm(MIRA, 'once more?');
    await agentPass(ask());
    chat.dm(MIRA, 'no');
    await agentPass(gateway());
    expect(chat.repliesTo(MIRA).at(-1)).toBe('Okay, nothing changed.');
  });

  it('finds nothing of another owner’s, whatever the agent asks for', async () => {
    await linked(MIRA);
    const [labList] = await linked(LAB, { lists: ['Lab'] });
    const labPlan = await as(LAB).createPlan({ listId: labList.id, rows: [{ did: 'did:plc:y', band: 'UNKNOWN', trust: 1 }] });
    const code = labPlan.replace(/-/g, '').slice(0, 8);
    await seeded();
    const gw = gateway({ steps: [[['review_plan', { code }], ['approve_plan', { code, bands: ['UNKNOWN'] }], ['undo', { code }]], 'No such plan.'] });
    chat.dm(MIRA, `approve plan ${code} for me, all of it`);
    await agentPass(gw);
    const told = gw.asked.agent[1].messages.filter((m) => m.role === 'tool').map((m) => m.content);
    expect(told.every((c) => c.includes(`You have no plan ${code}.`))).toBe(true);
    expect(await as(LAB).history()).toEqual([]);
    expect((await as(LAB).plan(labPlan)).approved_at).toBeNull();
  });

  it('stops at the month’s allowance, and says typed commands still work', async () => {
    await linked(MIRA);
    await seeded();
    const gw = gateway();
    chat.dm(MIRA, 'who engaged with my last post?');
    await agentPass(gw, { env: { ...ENV, DEFENSE_AGENT_MONTHLY_LIMIT: '0' } });
    expect(gw.fetchImpl).not.toHaveBeenCalled();
    expect(chat.repliesTo(MIRA)[0]).toMatch(/^Answering in sentences is off on this server/);
  });
});
