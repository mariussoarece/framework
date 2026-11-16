// Database access through PostgREST.
//   db.service   -> runs as service_role (bypasses row-level security; server only)
//   db.as(token) -> runs as the logged-in user (row-level security applies)

export class DbError extends Error {
  constructor(status, body) {
    super(body?.message || `database error ${status}`);
    this.status = status;
    this.code = body?.code;
    this.details = body;
  }
}

export const eq = (v) => `eq.${encodeURIComponent(v)}`;

export function createDb({ restUrl, serviceKey, fetchImpl = fetch }) {
  function client(token) {
    async function req(method, path, { body, prefer } = {}) {
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (prefer) headers.Prefer = prefer;
      const res = await fetchImpl(restUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = { message: text }; }
      }
      if (!res.ok) throw new DbError(res.status, data);
      return data;
    }

    return {
      select: (table, query = '') => req('GET', `/${table}${query ? `?${query}` : ''}`),
      one: async (table, query) => {
        const rows = await req('GET', `/${table}?${query}&limit=1`);
        return rows?.[0] ?? null;
      },
      insert: async (table, row) =>
        (await req('POST', `/${table}`, { body: row, prefer: 'return=representation' }))[0],
      update: (table, query, patch) =>
        req('PATCH', `/${table}?${query}`, { body: patch, prefer: 'return=representation' }),
      remove: (table, query) => req('DELETE', `/${table}?${query}`, { prefer: 'return=representation' }),
      rpc: (fn, args = {}) => req('POST', `/rpc/${fn}`, { body: args }),
    };
  }

  return { service: client(serviceKey), as: client };
}
