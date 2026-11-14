// An in-memory stand-in for the supabase-js calls the server makes, for tests.
//
// from(table) covers select / insert / upsert / update / delete with the
// filters eq, neq, gt, gte, lt, lte, in, is, like, ilike, not and or(), plus
// order, limit, range, single, maybeSingle and select(cols, { count, head }).
// Every call is recorded in `ops` as { table, verb, filters }, so a test can
// say which tables a request touched and how many reads it made. rpc() records
// its name and arguments and answers `rpcAnswer(name, args)`. `.storage` is an
// in-memory bucket store (upload / download / remove / list).

// ─── PostgREST filter expressions (the argument of .or()) ───────────────────

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '(') depth += 1;
    if (!quoted && ch === ')') depth -= 1;
    if (!quoted && depth === 0 && ch === ',') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const unquote = (v) => (v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);

/**
 * Parse a PostgREST logical filter such as
 * `status.in.(pending,failed),and(status.eq.published,last_error_code.eq.X)`
 * into `{ kind: 'or'|'and', items }` / `{ kind: 'cond', column, op, value, negate }`.
 * The top level of an .or() argument is an OR of its items.
 */
export function parseFilterExpression(expr, kind = 'or') {
  return { kind, items: splitTopLevel(String(expr)).map(parseItem) };
}

function parseItem(item) {
  const group = /^(not\.)?(and|or)\((.*)\)$/s.exec(item);
  if (group) {
    const node = parseFilterExpression(group[3], group[2]);
    return group[1] ? { kind: 'not', item: node } : node;
  }
  const first = item.indexOf('.');
  if (first < 0) throw new Error(`Unparseable filter: ${item}`);
  const column = item.slice(0, first);
  let rest = item.slice(first + 1);
  let negate = false;
  if (rest.startsWith('not.')) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf('.');
  if (dot < 0) throw new Error(`Unparseable filter: ${item}`);
  const op = rest.slice(0, dot);
  const raw = rest.slice(dot + 1);
  let value;
  if (op === 'in') {
    const inner = /^\((.*)\)$/s.exec(raw);
    value = inner ? splitTopLevel(inner[1]).map(unquote) : [unquote(raw)];
  } else if (op === 'is') {
    value = raw === 'null' ? null : raw === 'true' ? true : raw === 'false' ? false : raw;
  } else {
    value = unquote(raw);
  }
  return { kind: 'cond', column, op, value, negate };
}

// ─── Comparisons ────────────────────────────────────────────────────────────

const comparable = (v) => (v instanceof Date ? v.toISOString() : v);

function sameValue(a, b) {
  a = comparable(a);
  b = comparable(b);
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  // A jsonb column compared with a JSON literal (.eq('progress', '[]')): Postgres
  // compares values, so compare the object's JSON with the string as written.
  if (typeof a === 'object' && typeof b === 'string') return JSON.stringify(a) === b;
  if (typeof b === 'object' && typeof a === 'string') return JSON.stringify(b) === a;
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return String(a) === String(b);
}

function order(a, b) {
  a = comparable(a);
  b = comparable(b);
  const na = typeof a === 'number' ? a : Number(a);
  const nb = typeof b === 'number' ? b : Number(b);
  if (typeof a !== 'string' || typeof b !== 'string') {
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  }
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function likeToRegExp(pattern, flags) {
  const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, flags);
}

function test(op, actual, expected) {
  switch (op) {
    case 'eq': return sameValue(actual, expected);
    case 'neq': return actual !== null && actual !== undefined && !sameValue(actual, expected);
    case 'gt': return actual !== null && actual !== undefined && order(actual, expected) > 0;
    case 'gte': return actual !== null && actual !== undefined && order(actual, expected) >= 0;
    case 'lt': return actual !== null && actual !== undefined && order(actual, expected) < 0;
    case 'lte': return actual !== null && actual !== undefined && order(actual, expected) <= 0;
    case 'in': return [].concat(expected).some((v) => sameValue(actual, v));
    case 'is': return expected === null ? actual === null || actual === undefined : actual === expected;
    case 'like': return typeof actual === 'string' && likeToRegExp(expected, '').test(actual);
    case 'ilike': return typeof actual === 'string' && likeToRegExp(expected, 'i').test(actual);
    default: throw new Error(`The fake Supabase has no filter "${op}"`);
  }
}

function matchNode(node, row) {
  if (node.kind === 'cond') {
    const hit = test(node.op, row[node.column], node.value);
    return node.negate ? !hit : hit;
  }
  if (node.kind === 'not') return !matchNode(node.item, row);
  if (node.kind === 'and') return node.items.every((n) => matchNode(n, row));
  return node.items.some((n) => matchNode(n, row));
}

function project(row, columns) {
  const text = String(columns || '*').trim();
  if (!text || text === '*' || text.includes('(')) return { ...row };
  const out = {};
  for (const col of text.split(',').map((c) => c.trim()).filter(Boolean)) {
    const [alias, source] = col.includes(':') ? col.split(':').map((s) => s.trim()) : [col, col];
    out[alias] = row[source];
  }
  return out;
}

// ─── Storage ────────────────────────────────────────────────────────────────

/** An in-memory supabase-js `.storage`. Objects are kept as `${bucket}/${path}` → { bytes, contentType }. */
export function createFakeStorage() {
  const objects = new Map();
  const ops = [];
  const failures = new Map(); // `${bucket}:${verb}` -> error

  const toBuffer = (body) => {
    if (Buffer.isBuffer(body)) return Buffer.from(body);
    if (body instanceof Uint8Array || body instanceof ArrayBuffer) return Buffer.from(body);
    if (typeof body === 'string') return Buffer.from(body, 'utf8');
    throw new Error('The fake storage takes a Buffer, Uint8Array, ArrayBuffer or string body');
  };

  function bucket(name) {
    const fail = (verb) => failures.get(`${name}:${verb}`) || null;
    const record = (verb, paths) => ops.push({ bucket: name, verb, paths: [].concat(paths) });
    return {
      async upload(path, body, { contentType = 'application/octet-stream', upsert = false } = {}) {
        record('upload', path);
        const error = fail('upload');
        if (error) return { data: null, error };
        const key = `${name}/${path}`;
        if (objects.has(key) && !upsert) {
          return { data: null, error: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' } };
        }
        objects.set(key, { bytes: toBuffer(body), contentType });
        return { data: { path, id: key, fullPath: key }, error: null };
      },
      async download(path) {
        record('download', path);
        const error = fail('download');
        if (error) return { data: null, error };
        const hit = objects.get(`${name}/${path}`);
        if (!hit) return { data: null, error: { statusCode: '404', error: 'not_found', message: 'Object not found' } };
        return { data: new Blob([hit.bytes], { type: hit.contentType }), error: null };
      },
      async remove(paths) {
        record('remove', paths);
        const error = fail('remove');
        if (error) return { data: null, error };
        const removed = [];
        for (const path of [].concat(paths)) {
          if (objects.delete(`${name}/${path}`)) removed.push({ name: path, bucket_id: name });
        }
        return { data: removed, error: null };
      },
      async list(prefix = '') {
        record('list', prefix);
        const error = fail('list');
        if (error) return { data: null, error };
        const start = `${name}/${prefix ? `${String(prefix).replace(/\/$/, '')}/` : ''}`;
        const data = [...objects.keys()]
          .filter((k) => k.startsWith(start))
          .map((k) => ({ name: k.slice(start.length) }));
        return { data, error: null };
      },
    };
  }

  return {
    from: bucket,
    objects,
    ops,
    /** The stored bytes at bucket/path, or undefined. */
    read(name, path) {
      return objects.get(`${name}/${path}`)?.bytes;
    },
    failNext(name, verb, error = { statusCode: '500', message: 'storage boom' }) {
      failures.set(`${name}:${verb}`, error);
    },
    clearFailures() {
      failures.clear();
    },
    reset() {
      objects.clear();
      ops.length = 0;
      failures.clear();
    },
  };
}

// ─── The client ─────────────────────────────────────────────────────────────

/**
 * @param {object} [options]
 * @param {(name: string, args: object) => any} [options.rpcAnswer]  what rpc() resolves to (may be async)
 * @param {Record<string, (row: object) => object>} [options.defaults]  per-table column defaults for inserts
 */
export function createFakeSupabase({ rpcAnswer = () => ({ data: true, error: null }), defaults = {} } = {}) {
  const tables = new Map();
  const ops = [];
  const rpcs = [];
  const failures = new Map(); // `${table}:${verb}` -> { error, once }
  const storage = createFakeStorage();

  const rowsOf = (table) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
  };

  const withDefaults = (table, row) => {
    const make = defaults[table];
    return make ? { ...make(row), ...row } : { ...row };
  };

  function from(table) {
    const q = {
      verb: 'select',
      columns: '*',
      returningColumns: '*',
      filters: [],
      order: [],
      limit: null,
      range: null,
      patch: null,
      rows: null,
      opts: {},
      single: null,
      returning: false,
      onConflict: null,
      ignoreDuplicates: false,
    };
    const matches = (row) => q.filters.every((node) => matchNode(node, row));

    function takeFailure() {
      const key = `${table}:${q.verb}`;
      const failure = failures.get(key);
      if (!failure) return null;
      if (failure.once) failures.delete(key);
      return failure.error;
    }

    function shape(rows, columns) {
      const out = rows.map((r) => project(r, columns));
      if (q.single) {
        if (out.length === 1) return { data: out[0], error: null };
        if (out.length === 0 && q.single === 'maybe') return { data: null, error: null };
        return {
          data: null,
          error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null },
        };
      }
      return { data: out, error: null };
    }

    function run() {
      ops.push({ table, verb: q.verb, filters: q.filters.map(describe) });
      const failure = takeFailure();
      if (failure) return { data: null, error: failure, count: null };
      const rows = rowsOf(table);
      if (q.verb === 'insert') {
        const added = [].concat(q.rows).map((row) => withDefaults(table, row));
        rows.push(...added);
        return q.returning ? shape(added, q.returningColumns) : { data: null, error: null };
      }
      if (q.verb === 'upsert') {
        const keys = String(q.onConflict || 'id').split(',').map((s) => s.trim());
        const touched = [];
        for (const row of [].concat(q.rows)) {
          const at = rows.findIndex((r) => keys.every((k) => sameValue(r[k], row[k])));
          if (at === -1) {
            const added = withDefaults(table, row);
            rows.push(added);
            touched.push(added);
          } else if (!q.ignoreDuplicates) {
            rows[at] = { ...rows[at], ...row };
            touched.push(rows[at]);
          }
        }
        return q.returning ? shape(touched, q.returningColumns) : { data: null, error: null };
      }
      let hit = rows.filter(matches);
      if (q.verb === 'update') {
        for (const row of hit) Object.assign(row, q.patch);
        return q.returning ? shape(hit, q.returningColumns) : { data: null, error: null };
      }
      if (q.verb === 'delete') {
        tables.set(table, rows.filter((r) => !matches(r)));
        return q.returning ? shape(hit, q.returningColumns) : { data: null, error: null };
      }
      const count = q.opts.count ? hit.length : undefined;
      if (q.opts.head) return { data: null, error: null, count: hit.length };
      if (q.order.length) {
        hit = [...hit].sort((a, b) => {
          for (const [column, ascending, nullsFirst] of q.order) {
            const x = a[column];
            const y = b[column];
            if (x === y) continue;
            const xNull = x === null || x === undefined;
            const yNull = y === null || y === undefined;
            if (xNull && yNull) continue;
            if (xNull || yNull) return (xNull ? -1 : 1) * (nullsFirst ? 1 : -1);
            const c = order(x, y);
            if (c !== 0) return ascending ? c : -c;
          }
          return 0;
        });
      }
      if (q.range) hit = hit.slice(q.range[0], q.range[1] + 1);
      if (q.limit !== null) hit = hit.slice(0, q.limit);
      const result = shape(hit, q.columns);
      return count === undefined ? result : { ...result, count };
    }

    const filter = (op) => (column, value) => {
      q.filters.push({ kind: 'cond', column, op, value, negate: false });
      return builder;
    };

    const builder = {
      select(columns = '*', opts = {}) {
        if (q.verb === 'select') {
          q.columns = columns;
          q.opts = opts || {};
        } else {
          q.returning = true;
          q.returningColumns = columns;
        }
        return builder;
      },
      insert(rows) { q.verb = 'insert'; q.rows = rows; return builder; },
      upsert(rows, { onConflict, ignoreDuplicates = false } = {}) {
        q.verb = 'upsert';
        q.rows = rows;
        q.onConflict = onConflict;
        q.ignoreDuplicates = ignoreDuplicates;
        return builder;
      },
      update(patch) { q.verb = 'update'; q.patch = patch; return builder; },
      delete() { q.verb = 'delete'; return builder; },
      eq: filter('eq'),
      neq: filter('neq'),
      gt: filter('gt'),
      gte: filter('gte'),
      lt: filter('lt'),
      lte: filter('lte'),
      in: filter('in'),
      is: filter('is'),
      like: filter('like'),
      ilike: filter('ilike'),
      not(column, op, value) {
        const parsed = op === 'in' && typeof value === 'string' ? parseItem(`${column}.in.${value}`).value : value;
        q.filters.push({ kind: 'cond', column, op, value: parsed, negate: true });
        return builder;
      },
      or(expr) { q.filters.push(parseFilterExpression(expr, 'or')); return builder; },
      match(obj) {
        for (const [column, value] of Object.entries(obj)) filter('eq')(column, value);
        return builder;
      },
      order(column, { ascending = true, nullsFirst } = {}) {
        q.order.push([column, ascending, nullsFirst ?? !ascending]);
        return builder;
      },
      limit(n) { q.limit = n; return builder; },
      range(fromIndex, toIndex) { q.range = [fromIndex, toIndex]; return builder; },
      single() { q.single = 'single'; return builder; },
      maybeSingle() { q.single = 'maybe'; return builder; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    return builder;
  }

  return {
    from,
    async rpc(name, args) {
      rpcs.push({ name, args });
      return rpcAnswer(name, args);
    },
    storage,
    tables,
    rowsOf,
    ops,
    rpcs,
    /** Every later `verb` on `table` fails with `error` until clearFailures(). */
    failNext(table, verb, error = { code: 'XX000', message: 'boom' }) {
      failures.set(`${table}:${verb}`, { error, once: false });
    },
    /** Only the next `verb` on `table` fails. */
    failOnce(table, verb, error = { code: 'XX000', message: 'boom' }) {
      failures.set(`${table}:${verb}`, { error, once: true });
    },
    clearFailures() {
      failures.clear();
    },
    reset() {
      tables.clear();
      ops.length = 0;
      rpcs.length = 0;
      failures.clear();
      storage.reset();
    },
  };
}

function describe(node) {
  if (node.kind === 'cond') {
    const value = Array.isArray(node.value) ? `(${node.value.join(',')})` : node.value;
    return `${node.column} ${node.negate ? 'not ' : ''}${node.op} ${value}`;
  }
  if (node.kind === 'not') return `not ${describe(node.item)}`;
  return `${node.kind}(${node.items.map(describe).join(', ')})`;
}
