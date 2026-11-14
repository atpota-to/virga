import { describe, it, expect } from 'vitest';
import { createFakeSupabase, createFakeStorage, parseFilterExpression } from './fakeSupabase.js';

describe('createFakeSupabase tables', () => {
  it('inserts, selects with filters and records every op', async () => {
    const sb = createFakeSupabase();
    await sb.from('t').insert([{ id: 1, s: 'a', n: 5 }, { id: 2, s: 'b', n: 10 }, { id: 3, s: 'c', n: null }]);
    expect((await sb.from('t').select('*').eq('s', 'a')).data).toEqual([{ id: 1, s: 'a', n: 5 }]);
    expect((await sb.from('t').select('id').in('s', ['a', 'c'])).data).toEqual([{ id: 1 }, { id: 3 }]);
    expect((await sb.from('t').select('id').gte('n', 5).lt('n', 10)).data).toEqual([{ id: 1 }]);
    expect((await sb.from('t').select('id').neq('s', 'a')).data).toEqual([{ id: 2 }, { id: 3 }]);
    expect((await sb.from('t').select('id').is('n', null)).data).toEqual([{ id: 3 }]);
    expect((await sb.from('t').select('id').not('s', 'in', '(a,b)')).data).toEqual([{ id: 3 }]);
    expect(sb.ops[1]).toEqual({ table: 't', verb: 'select', filters: ['s eq a'] });
  });

  it('matches a jsonb value against a JSON literal, as Postgres does', async () => {
    const db = createFakeSupabase();
    await db.from('t').insert([{ id: 1, progress: [] }, { id: 2, progress: [{ i: 0 }] }]);
    const { data } = await db.from('t').select('*').eq('progress', '[]');
    expect(data.map((r) => r.id)).toEqual([1]);
  });

  it('orders, limits and ranges', async () => {
    const sb = createFakeSupabase();
    await sb.from('t').insert([{ id: 1, at: '2026-01-02' }, { id: 2, at: '2026-01-01' }, { id: 3, at: null }]);
    expect((await sb.from('t').select('id').order('at')).data.map((r) => r.id)).toEqual([2, 1, 3]);
    expect((await sb.from('t').select('id').order('at', { ascending: false })).data.map((r) => r.id)).toEqual([3, 1, 2]);
    expect((await sb.from('t').select('id').order('at').limit(1)).data).toEqual([{ id: 2 }]);
    expect((await sb.from('t').select('id').order('id').range(1, 2)).data).toEqual([{ id: 2 }, { id: 3 }]);
  });

  it('answers single and maybeSingle the way PostgREST does', async () => {
    const sb = createFakeSupabase();
    await sb.from('t').insert({ id: 1 });
    expect((await sb.from('t').select('*').eq('id', 1).single()).data).toEqual({ id: 1 });
    expect((await sb.from('t').select('*').eq('id', 2).single()).error.code).toBe('PGRST116');
    expect(await sb.from('t').select('*').eq('id', 2).maybeSingle()).toEqual({ data: null, error: null });
  });

  it('counts with head, and alongside rows', async () => {
    const sb = createFakeSupabase();
    await sb.from('t').insert([{ u: 'a' }, { u: 'a' }, { u: 'b' }]);
    expect(await sb.from('t').select('id', { count: 'exact', head: true }).eq('u', 'a')).toEqual({ data: null, error: null, count: 2 });
    expect((await sb.from('t').select('*', { count: 'exact' }).limit(1)).count).toBe(3);
  });

  it('upserts on a conflict key, updates and deletes with returning', async () => {
    const sb = createFakeSupabase();
    await sb.from('t').upsert({ k: 'a', v: 1 }, { onConflict: 'k' });
    await sb.from('t').upsert({ k: 'a', v: 2 }, { onConflict: 'k' });
    await sb.from('t').upsert({ k: 'a', v: 3 }, { onConflict: 'k', ignoreDuplicates: true });
    expect(sb.rowsOf('t')).toEqual([{ k: 'a', v: 2 }]);
    expect((await sb.from('t').update({ v: 4 }).eq('k', 'a').select()).data).toEqual([{ k: 'a', v: 4 }]);
    expect((await sb.from('t').insert({ k: 'b' }).select().single()).data).toEqual({ k: 'b' });
    expect((await sb.from('t').delete().eq('k', 'a').select()).data).toEqual([{ k: 'a', v: 4 }]);
    expect(sb.rowsOf('t')).toEqual([{ k: 'b' }]);
  });

  it('fills per-table defaults on insert', async () => {
    let n = 0;
    const sb = createFakeSupabase({ defaults: { t: () => ({ id: `id-${++n}`, status: 'pending' }) } });
    const { data } = await sb.from('t').insert({ status: 'armed' }).select().single();
    expect(data).toEqual({ id: 'id-1', status: 'armed' });
  });

  it('applies an .or() filter, nested and() included', async () => {
    const sb = createFakeSupabase();
    await sb.from('p').insert([
      { id: 1, status: 'pending', code: null },
      { id: 2, status: 'published', code: 'TIMER_NOT_ARMED' },
      { id: 3, status: 'published', code: null },
      { id: 4, status: 'failed', code: 'X' },
    ]);
    const { data } = await sb
      .from('p')
      .select('id')
      .or('status.in.(pending,failed,publishing),and(status.eq.published,code.eq.TIMER_NOT_ARMED)');
    expect(data.map((r) => r.id)).toEqual([1, 2, 4]);
  });

  it('fails a verb until cleared, or once', async () => {
    const sb = createFakeSupabase();
    sb.failNext('t', 'select');
    expect((await sb.from('t').select()).error.message).toBe('boom');
    expect((await sb.from('t').select()).error.message).toBe('boom');
    sb.clearFailures();
    expect((await sb.from('t').select()).error).toBeNull();
    sb.failOnce('t', 'insert', { code: '23505', message: 'dup' });
    expect((await sb.from('t').insert({})).error.code).toBe('23505');
    expect((await sb.from('t').insert({})).error).toBeNull();
  });

  it('records rpc calls and answers them', async () => {
    const sb = createFakeSupabase({ rpcAnswer: async (name) => ({ data: name === 'acquire' ? true : null, error: null }) });
    expect(await sb.rpc('acquire', { p_key: 'k' })).toEqual({ data: true, error: null });
    expect(sb.rpcs).toEqual([{ name: 'acquire', args: { p_key: 'k' } }]);
    sb.reset();
    expect(sb.rpcs).toEqual([]);
  });
});

describe('createFakeStorage', () => {
  it('uploads, downloads as a Blob, lists and removes', async () => {
    const storage = createFakeStorage();
    const bucket = storage.from('scheduled-media');
    expect((await bucket.upload('did/a.png', Buffer.from([1, 2]), { contentType: 'image/png' })).error).toBeNull();
    expect((await bucket.upload('did/a.png', Buffer.from([3]))).error.statusCode).toBe('409');
    expect((await bucket.upload('did/a.png', Buffer.from([3]), { upsert: true })).error).toBeNull();
    const { data } = await bucket.download('did/a.png');
    expect([...new Uint8Array(await data.arrayBuffer())]).toEqual([3]);
    expect((await bucket.list('did')).data).toEqual([{ name: 'a.png' }]);
    expect((await bucket.remove(['did/a.png', 'did/missing.png'])).data).toEqual([{ name: 'did/a.png', bucket_id: 'scheduled-media' }]);
    expect((await bucket.download('did/a.png')).error.statusCode).toBe('404');
    expect(storage.ops.map((o) => o.verb)).toEqual(['upload', 'upload', 'upload', 'download', 'list', 'remove', 'download']);
  });

  it('fails a verb on a bucket on request', async () => {
    const sb = createFakeSupabase();
    sb.storage.failNext('b', 'download');
    expect((await sb.storage.from('b').download('x')).error.message).toBe('storage boom');
    sb.storage.clearFailures();
    await sb.storage.from('b').upload('x', 'hi');
    expect(sb.storage.read('b', 'x').toString()).toBe('hi');
  });
});

describe('parseFilterExpression', () => {
  it('parses conditions, lists, negation and groups', () => {
    expect(parseFilterExpression('a.eq.1,b.not.is.null,and(c.in.("x,y",z),d.gt.2)')).toEqual({
      kind: 'or',
      items: [
        { kind: 'cond', column: 'a', op: 'eq', value: '1', negate: false },
        { kind: 'cond', column: 'b', op: 'is', value: null, negate: true },
        {
          kind: 'and',
          items: [
            { kind: 'cond', column: 'c', op: 'in', value: ['x,y', 'z'], negate: false },
            { kind: 'cond', column: 'd', op: 'gt', value: '2', negate: false },
          ],
        },
      ],
    });
  });
});
