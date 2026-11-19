// Test-only stand-in for PostgREST: same interface as src/db.js, but runs the
// queries through psql against a real PostgreSQL with the real migrations,
// switching role exactly like PostgREST does (service_role / authenticated + token claims).
// Supports only the query forms the server uses.
import { execFile } from 'node:child_process';
import { DbError } from '../../src/db.js';

const lit = (v) => (v === null || v === undefined ? 'null'
  : Array.isArray(v) ? `'{${v.join(',')}}'`
    : `'${String(v).replace(/'/g, "''")}'`);
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`);
  return s;
};

function psql(url, sql) {
  return new Promise((resolve, reject) => {
    const p = execFile('psql', [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
      { maxBuffer: 50e6 }, (err, stdout, stderr) => {
        if (err) {
          const msg = (/ERROR:\s+(.*)/.exec(stderr) || [])[1] || stderr;
          return reject(new DbError(400, { message: msg.trim() }));
        }
        const out = stdout.trim();
        resolve(out ? JSON.parse(out) : null);
      });
    p.stdin.end(sql);
  });
}

function parseQuery(query, prefix = '') {
  const where = [];
  let cols = '*';
  let limit = '';
  for (const [k, raw] of new URLSearchParams(query)) {
    if (k === 'select') { cols = raw.split(',').map(ident).join(','); continue; }
    if (k === 'limit') { limit = ` limit ${Number(raw)}`; continue; }
    const i = raw.indexOf('.');
    const op = raw.slice(0, i);
    const v = raw.slice(i + 1);
    const col = prefix + ident(k);
    if (op === 'eq') where.push(`${col} = ${lit(v)}`);
    else if (op === 'gt') where.push(`${col} > ${lit(v)}`);
    else if (op === 'is') where.push(`${col} is ${v === 'null' ? 'null' : v === 'true' ? 'true' : 'false'}`);
    else if (op === 'in') where.push(`${col} in (${v.replace(/^\(|\)$/g, '').split(',').map(lit).join(',')})`);
    else throw new Error(`unsupported operator ${op}`);
  }
  return { cols, limit, where: where.length ? ` where ${where.join(' and ')}` : '' };
}

export function createPsqlDb(url) {
  function client(token) {
    const claims = token === 'service'
      ? null
      : JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    const prelude = claims
      ? `set role authenticated; set request.jwt.claims = ${lit(JSON.stringify(claims))};\n`
      : 'set role service_role;\n';
    const run = (sql) => psql(url, prelude + sql);

    return {
      select: (table, query = '') => {
        const q = parseQuery(query);
        return run(`select coalesce(json_agg(t), '[]') from (select ${q.cols} from public.${ident(table)}${q.where}${q.limit}) t;`);
      },
      one: async (table, query) => {
        const q = parseQuery(query);
        const rows = await run(`select coalesce(json_agg(t), '[]') from (select ${q.cols} from public.${ident(table)}${q.where} limit 1) t;`);
        return rows[0] ?? null;
      },
      insert: async (table, row) => {
        const cols = Object.keys(row).map(ident).join(',');
        const rows = await run(`with r as (insert into public.${ident(table)} (${cols})
          select ${cols} from json_populate_record(null::public.${ident(table)}, ${lit(JSON.stringify(row))}) returning *)
          select coalesce(json_agg(r), '[]') from r;`);
        return rows[0];
      },
      update: (table, query, patch) => {
        const q = parseQuery(query, 't.');
        const sets = Object.keys(patch).map((c) => `${ident(c)} = j.${ident(c)}`).join(', ');
        return run(`with r as (update public.${ident(table)} t set ${sets}
          from json_populate_record(null::public.${ident(table)}, ${lit(JSON.stringify(patch))}) j
          ${q.where} returning t.*)
          select coalesce(json_agg(r), '[]') from r;`);
      },
      remove: (table, query) => {
        const q = parseQuery(query);
        return run(`with r as (delete from public.${ident(table)}${q.where} returning *)
          select coalesce(json_agg(r), '[]') from r;`);
      },
      rpc: async (fn, args = {}) => {
        const argSql = Object.entries(args).map(([k, v]) => `${ident(k)} => ${lit(v)}`).join(', ');
        const info = await psql(url, `select json_build_object('set', p.proretset, 'type', p.prorettype::regtype::text)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = ${lit(fn)} limit 1;`);
        if (info.set) return run(`select coalesce(json_agg(r), '[]') from public.${ident(fn)}(${argSql}) r;`);
        if (info.type === 'void') { await run(`select public.${ident(fn)}(${argSql}); select 'null';`); return null; }
        return run(`select to_json(public.${ident(fn)}(${argSql}));`);
      },
    };
  }
  return { service: client('service'), as: client };
}
