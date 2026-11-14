// An in-process Postgres (PGlite) with Virga's migrations applied, so SQL is
// tested for behaviour rather than read as text.
//
// Before the migrations run, the database is made to look like a Supabase
// project in the ways they depend on: the anon / authenticated / service_role
// roles, Supabase's default privileges (new tables and functions in public are
// granted to all three, which is exactly why every migration has to REVOKE;
// defaultGrants: false leaves them out, as on newer projects), and a `storage`
// schema with the `buckets` and `objects` tables. PGlite has
// no pg_cron, so a migration that schedules a job must guard on it.
//
// supabaseAdapter(db) is a small stand-in for the supabase-js client over the
// same database: rpc() calls a public function by named arguments and answers
// the way PostgREST does (a set as an array of rows, a scalar as itself, JSON
// types throughout), and from() covers the builder calls the server makes.
// Missing objects come back with PostgREST's codes (PGRST202, PGRST204,
// PGRST205), so code that branches on them is tested on the real answer.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeStorage, parseFilterExpression } from './fakeSupabase.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));

export const ROLES_SQL = `
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END
$$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
`;

// The automatic grants older Supabase projects have. Projects made after
// Supabase retires them have none, not even for service_role, so a migration
// must GRANT service_role what it uses; createTestDatabase({ defaultGrants:
// false }) builds that kind of project.
export const DEFAULT_GRANTS_SQL = `
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`;

// The parts of Supabase Storage's schema a migration may write to (a bucket
// row) or read (objects).
export const STORAGE_SQL = `
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE,
  owner              UUID,
  owner_id           TEXT,
  public             BOOLEAN DEFAULT FALSE,
  avif_autodetection BOOLEAN DEFAULT FALSE,
  file_size_limit    BIGINT,
  allowed_mime_types TEXT[],
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id        TEXT REFERENCES storage.buckets (id),
  name             TEXT,
  owner            UUID,
  owner_id         TEXT,
  metadata         JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ DEFAULT NOW()
);
`;

/** The migration file names in `dir`, in the order `supabase db push` applies them. */
export function listMigrations(dir = MIGRATIONS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

export function readMigration(name, dir = MIGRATIONS_DIR) {
  return readFileSync(join(dir, name), 'utf8');
}

export async function applyMigration(db, name, dir = MIGRATIONS_DIR) {
  await db.exec(readMigration(name, dir));
}

/** The migrations to apply: all of them, or those up to and including the one `upTo` names. */
export function selectMigrations({ upTo, dir = MIGRATIONS_DIR } = {}) {
  const all = listMigrations(dir);
  if (!upTo) return all;
  const last = all.findLastIndex((name) => name === upTo || name.startsWith(upTo));
  if (last < 0) throw new Error(`No migration in ${dir} matches "${upTo}"`);
  return all.slice(0, last + 1);
}

/**
 * A fresh database with the Supabase shims and the migrations applied in order.
 * Takes a second or two; create one per test file (in beforeAll).
 *
 * @param {object} [options]
 * @param {string} [options.upTo]  the last migration to apply: a file name or its version prefix
 * @param {string[]} [options.files]  exactly these migration file names instead
 * @param {string} [options.dir]  the migrations folder (supabase/migrations by default)
 * @param {boolean} [options.storage]  false leaves the storage schema out, to test a migration's guard
 * @param {boolean} [options.defaultGrants]  false leaves out Supabase's automatic grants on new objects
 * @param {object} [options.extensions]  PGlite extensions to load
 * @returns {Promise<{ db, query, exec, close, supabase, applied: string[] }>}
 */
export async function createTestDatabase({
  upTo,
  files,
  dir = MIGRATIONS_DIR,
  storage = true,
  defaultGrants = true,
  extensions,
} = {}) {
  const applied = files ? [...files] : selectMigrations({ upTo, dir });
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create(extensions ? { extensions } : undefined);
  await db.exec(ROLES_SQL);
  if (defaultGrants) await db.exec(DEFAULT_GRANTS_SQL);
  if (storage) await db.exec(STORAGE_SQL);
  for (const name of applied) {
    try {
      await applyMigration(db, name, dir);
    } catch (err) {
      await db.close().catch(() => {});
      err.message = `${name}: ${err.message}`;
      throw err;
    }
  }
  return {
    db,
    applied,
    query: (sql, params) => db.query(sql, params),
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
    supabase: supabaseAdapter(db),
  };
}

// ─── The supabase-js stand-in ───────────────────────────────────────────────

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

// A table request PostgREST refuses from its schema cache (PGRST204/205); an
// error raised while a function runs comes through with the Postgres code.
export function postgrestError(err, { table = false } = {}) {
  const code = err?.code;
  const message = err?.message || String(err);
  if (table && code === '42703') {
    const m = /column "([^"]+)" of relation "([^"]+)" does not exist/.exec(message);
    if (m) {
      return { code: 'PGRST204', message: `Could not find the '${m[1]}' column of '${m[2]}' in the schema cache`, details: null, hint: null };
    }
  }
  if (table && code === '42P01') {
    const m = /relation "([^"]+)" does not exist/.exec(message);
    const name = m ? (m[1].includes('.') ? m[1] : `public.${m[1]}`) : 'unknown';
    return { code: 'PGRST205', message: `Could not find the table '${name}' in the schema cache`, details: null, hint: null };
  }
  return { code: code || null, message, details: err?.detail || null, hint: err?.hint || null };
}

// Every argument goes over as text and is cast in SQL, so nothing depends on
// how the driver would guess a type.
function argSql(index, type) {
  const p = `$${index}`;
  if (type.endsWith('[]')) return `ARRAY(SELECT jsonb_array_elements_text(${p}::text::jsonb))::${type}`;
  return `${p}::text::${type}`;
}

function argValue(value, type) {
  if (value === null || value === undefined) return null;
  if (type === 'jsonb' || type === 'json' || type.endsWith('[]')) return JSON.stringify(value);
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function functionsNamed(db, name) {
  const { rows } = await db.query(
    `SELECT p.proargnames AS names,
            ARRAY(SELECT format_type(t, NULL) FROM unnest(p.proargtypes::oid[]) AS t) AS types,
            p.pronargdefaults AS defaults,
            p.proretset AS returns_set,
            format_type(p.prorettype, NULL) AS returns
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`,
    [name],
  );
  return rows;
}

function pickOverload(candidates, keys) {
  return candidates.find((fn) => {
    const names = (fn.names || []).slice(0, fn.types.length);
    if (!keys.every((k) => names.includes(k))) return false;
    const required = names.slice(0, names.length - fn.defaults);
    return required.every((k) => keys.includes(k));
  });
}

async function rpc(db, name, params = {}) {
  const keys = Object.keys(params || {}).filter((k) => params[k] !== undefined);
  try {
    const fn = pickOverload(await functionsNamed(db, name), keys);
    if (!fn) {
      const signature = [...keys].sort().join(', ');
      return {
        data: null,
        error: { code: 'PGRST202', message: `Could not find the function public.${name}(${signature}) in the schema cache`, details: null, hint: null },
      };
    }
    const values = [];
    const args = keys.map((key) => {
      const type = fn.types[fn.names.indexOf(key)];
      values.push(argValue(params[key], type));
      return `${ident(key)} => ${argSql(values.length, type)}`;
    });
    const callSql = `public.${ident(name)}(${args.join(', ')})`;
    if (fn.returns === 'void') {
      await db.query(`SELECT ${callSql}`, values);
      return { data: null, error: null };
    }
    if (fn.returns_set || fn.returns === 'record') {
      const { rows } = await db.query(`SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) AS data FROM ${callSql} AS r`, values);
      return { data: rows[0].data, error: null };
    }
    const { rows } = await db.query(`SELECT to_jsonb(${callSql}) AS data`, values);
    return { data: rows[0].data, error: null };
  } catch (err) {
    return { data: null, error: postgrestError(err) };
  }
}

const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

function tableBuilder(db, table) {
  const state = {
    verb: 'select',
    columns: '*',
    rows: null,
    patch: null,
    onConflict: null,
    ignoreDuplicates: false,
    filters: [],
    order: [],
    limit: null,
    offset: null,
    single: null,
    returning: false,
    count: null,
    head: false,
  };
  // Each statement is built afresh, so its parameter list starts empty.
  let values = [];
  const raw = (v) => {
    values.push(v);
    return `$${values.length}`;
  };
  // A plain object or array bound for a json column goes over as its JSON text.
  const param = (v) => raw(v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);

  function condSql({ column, op, value, negate }) {
    let text;
    if (op === 'in') text = `${ident(column)}::text = ANY(${raw([].concat(value).map(String))}::text[])`;
    else if (op === 'is') text = `${ident(column)} IS ${value === null ? 'NULL' : value ? 'TRUE' : 'FALSE'}`;
    else if (op === 'like' || op === 'ilike') {
      text = `${ident(column)}::text ${op === 'like' ? 'LIKE' : 'ILIKE'} ${raw(String(value).replace(/\*/g, '%'))}`;
    } else if (OPS[op]) text = `${ident(column)} ${OPS[op]} ${param(value)}`;
    else throw new Error(`The PGlite adapter has no filter "${op}"`);
    return negate ? `NOT (${text})` : text;
  }

  function nodeSql(node) {
    if (node.kind === 'cond') return condSql(node);
    if (node.kind === 'not') return `NOT (${nodeSql(node.item)})`;
    const joiner = node.kind === 'and' ? ' AND ' : ' OR ';
    return `(${node.items.map(nodeSql).join(joiner)})`;
  }

  function where() {
    if (!state.filters.length) return '';
    return ' WHERE ' + state.filters.map(nodeSql).join(' AND ');
  }

  function selectShape() {
    const columns = String(state.columns).split(',').map((c) => c.trim()).filter(Boolean);
    if (columns.includes('*') || !columns.length) return 'to_jsonb(t)';
    return `jsonb_build_object(${columns
      .map((c) => {
        const [alias, source] = c.includes(':') ? c.split(':').map((s) => s.trim()) : [c, c];
        return `'${alias.replace(/'/g, "''")}', t.${ident(source)}`;
      })
      .join(', ')})`;
  }

  function sql() {
    const target = `public.${ident(table)}`;
    if (state.verb === 'select') {
      let text = `SELECT ${selectShape()} AS row FROM ${target} t${where()}`;
      if (state.order.length) {
        text += ' ORDER BY ' + state.order
          .map(([c, asc, nullsFirst]) => `${ident(c)} ${asc ? 'ASC' : 'DESC'}${nullsFirst === undefined ? '' : nullsFirst ? ' NULLS FIRST' : ' NULLS LAST'}`)
          .join(', ');
      }
      if (state.limit != null) text += ` LIMIT ${Number(state.limit)}`;
      if (state.offset != null) text += ` OFFSET ${Number(state.offset)}`;
      return text;
    }
    const returning = state.returning ? ' RETURNING to_jsonb(t) AS row' : '';
    if (state.verb === 'delete') return `DELETE FROM ${target} t${where()}${returning}`;
    if (state.verb === 'update') {
      const sets = Object.entries(state.patch).map(([c, v]) => `${ident(c)} = ${param(v)}`);
      return `UPDATE ${target} t SET ${sets.join(', ')}${where()}${returning}`;
    }
    const rows = Array.isArray(state.rows) ? state.rows : [state.rows];
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const tuples = rows.map((r) => `(${cols.map((c) => (c in r ? param(r[c]) : 'DEFAULT')).join(', ')})`);
    let text = `INSERT INTO ${target} AS t (${cols.map(ident).join(', ')}) VALUES ${tuples.join(', ')}`;
    if (state.verb === 'upsert') {
      const keys = String(state.onConflict || 'id').split(',').map((s) => s.trim());
      const sets = cols.filter((c) => !keys.includes(c)).map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`);
      text += ` ON CONFLICT (${keys.map(ident).join(', ')}) `
        + (sets.length && !state.ignoreDuplicates ? `DO UPDATE SET ${sets.join(', ')}` : 'DO NOTHING');
    }
    return text + returning;
  }

  async function countRows() {
    values = [];
    const text = `SELECT count(*)::int AS n FROM public.${ident(table)} t${where()}`;
    const { rows } = await db.query(text, values);
    return rows[0].n;
  }

  async function run() {
    try {
      if (state.verb === 'select' && state.head) {
        return { data: null, error: null, count: await countRows() };
      }
      const count = state.verb === 'select' && state.count ? await countRows() : undefined;
      values = [];
      const text = sql();
      const { rows } = await db.query(text, values);
      const data = rows.map((r) => r.row);
      if (state.verb !== 'select' && !state.returning) return { data: null, error: null };
      let result;
      if (state.single) {
        if (data.length > 1 || (state.single === 'single' && data.length === 0)) {
          return {
            data: null,
            error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null },
          };
        }
        result = { data: data[0] || null, error: null };
      } else {
        result = { data, error: null };
      }
      return count === undefined ? result : { ...result, count };
    } catch (err) {
      return { data: null, error: postgrestError(err, { table: true }) };
    }
  }

  const builder = {
    select(columns = '*', { count = null, head = false } = {}) {
      if (state.verb === 'select') {
        state.columns = columns;
        state.count = count;
        state.head = head;
      } else {
        state.returning = true;
      }
      return builder;
    },
    insert(rows) { state.verb = 'insert'; state.rows = rows; return builder; },
    upsert(rows, { onConflict, ignoreDuplicates = false } = {}) {
      state.verb = 'upsert';
      state.rows = rows;
      state.onConflict = onConflict;
      state.ignoreDuplicates = ignoreDuplicates;
      return builder;
    },
    update(patch) { state.verb = 'update'; state.patch = patch; return builder; },
    delete() { state.verb = 'delete'; return builder; },
    not(column, op, value) {
      const parsed = op === 'in' && typeof value === 'string'
        ? parseFilterExpression(`${column}.in.${value}`).items[0].value
        : value;
      state.filters.push({ kind: 'cond', column, op, value: parsed, negate: true });
      return builder;
    },
    or(expr) { state.filters.push(parseFilterExpression(expr, 'or')); return builder; },
    match(obj) {
      for (const [column, value] of Object.entries(obj)) state.filters.push({ kind: 'cond', column, op: 'eq', value, negate: false });
      return builder;
    },
    order(column, { ascending = true, nullsFirst } = {}) { state.order.push([column, ascending, nullsFirst]); return builder; },
    limit(n) { state.limit = n; return builder; },
    range(from, to) { state.offset = from; state.limit = to - from + 1; return builder; },
    single() { state.single = 'single'; return builder; },
    maybeSingle() { state.single = 'maybe'; return builder; },
    then(resolve, reject) { return run().then(resolve, reject); },
  };
  for (const op of [...Object.keys(OPS), 'in', 'is', 'like', 'ilike']) {
    builder[op] = (column, value) => {
      state.filters.push({ kind: 'cond', column, op, value, negate: false });
      return builder;
    };
  }
  return builder;
}

/**
 * The supabase-js calls the server makes, over a PGlite database. Storage is
 * the in-memory fake (Storage isn't Postgres).
 */
export function supabaseAdapter(db) {
  return {
    rpc: (name, params) => rpc(db, name, params),
    from: (table) => tableBuilder(db, table),
    storage: createFakeStorage(),
  };
}
