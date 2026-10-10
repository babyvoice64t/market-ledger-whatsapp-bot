// Market Ledger API client (talks to the Pages Functions backend).
// Auth (shared/admin): POST /api/login {password} -> {ok:true, token}; token is
// cached and refreshed when expired or when the API answers 401.
// Auth (per-user): POST /api/auth/login {username, password} -> {ok:true, token} —
// see createUserLedgerClient below.

function parseTokenExp(token) {
  const exp = parseInt(String(token).split('.')[0], 10);
  return Number.isFinite(exp) ? exp : Date.now() + 12 * 3600 * 1000;
}

function loginError(r, j, fallback) {
  const err = new Error((j && j.error) || fallback);
  err.status = r.status;
  err.body = j;
  return err;
}

export function createLedgerClient({ baseUrl, password, fetchImpl = fetch, loginFn = null }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  let token = null;
  let tokenExp = 0;

  const doLogin = loginFn || (async () => {
    const r = await fetchImpl(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok || !j.token) throw loginError(r, j, 'ledger login failed');
    return j.token;
  });

  async function login() {
    token = await doLogin();
    tokenExp = parseTokenExp(token);
    return token;
  }

  async function ensureToken() {
    if (token && Date.now() < tokenExp - 60000) return token;
    return login();
  }

  function withToken(path, t) {
    return `${base}${path}${path.includes('?') ? '&' : '?'}password=${encodeURIComponent(t)}`;
  }

  async function authedGet(path, retried = false) {
    const t = await ensureToken();
    const r = await fetchImpl(withToken(path, t));
    if (r.status === 401 && !retried) {
      token = null; // force re-login once
      return authedGet(path, true);
    }
    return r;
  }

  async function getParties() {
    const r = await authedGet('/api/parties');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'parties request failed');
    return j.parties || [];
  }

  // Case-insensitive exact match on the portal's saved party name.
  function findParty(parties, name) {
    const want = String(name || '').trim().toLowerCase();
    if (!want) return null;
    return (parties || []).find((p) => String(p.name || '').trim().toLowerCase() === want) || null;
  }

  async function getBalance(partyId) {
    const r = await authedGet(`/api/ledger?party_id=${encodeURIComponent(partyId)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'ledger request failed');
    return j.totals && typeof j.totals.balance === 'number' ? j.totals.balance : 0;
  }

  // Sale: photo ke saath multipart, baghair photo JSON (photo optional hai).
  async function createSale({ partyId, amount, date, description, photoBuffer, filename, mimetype }) {
    const t = await ensureToken();
    if (!photoBuffer) {
      const r = await fetchImpl(base + '/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: t, party_id: partyId, amount, date, description }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'sale request failed');
      return j;
    }
    const form = new FormData();
    form.append('password', t);
    form.append('party_id', String(partyId));
    form.append('amount', String(amount));
    form.append('date', date);
    if (description) form.append('description', description);
    form.append('photo', new Blob([photoBuffer], { type: mimetype || 'image/jpeg' }), filename || 'bill.jpg');
    const r = await fetchImpl(`${base}/api/sales`, { method: 'POST', body: form });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'sale request failed');
    return j;
  }

  // Purchase: photo ke saath multipart, baghair photo JSON (photo optional hai).
  async function createPurchase({ partyId, amount, date, description, photoBuffer, filename, mimetype }) {
    const t = await ensureToken();
    if (!photoBuffer) {
      const r = await fetchImpl(base + '/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: t, party_id: partyId, amount, date, description }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'purchase request failed');
      return j;
    }
    const form = new FormData();
    form.append('password', t);
    form.append('party_id', String(partyId));
    form.append('amount', String(amount));
    form.append('date', date);
    if (description) form.append('description', description);
    form.append('photo', new Blob([photoBuffer], { type: mimetype || 'image/jpeg' }), filename || 'bill.jpg');
    const r = await fetchImpl(base + '/api/purchases', { method: 'POST', body: form });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'purchase request failed');
    return j;
  }

  async function createPayment({ partyId, amount, date, description, photoBuffer, filename, mimetype, method = 'cash' }) {
    const t = await ensureToken();
    // photo optional: agar hai to pehle Cloudinary pe upload karo (receipt wala flow)
    let photoUrl = '';
    if (photoBuffer) {
      const form = new FormData();
      form.append('password', t);
      form.append('party_id', String(partyId));
      form.append('amount', String(amount));
      form.append('date', date);
      form.append('method', method || 'cash');
      if (description) form.append('description', description);
      form.append('photo', new Blob([photoBuffer], { type: mimetype || 'image/jpeg' }), filename || 'payment.jpg');
      const r = await fetchImpl(base + '/api/payments', { method: 'POST', body: form });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'payment request failed');
      return j;
    }
    const r = await fetchImpl(base + '/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: t, party_id: partyId, amount, date, description, method: method || 'cash' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'payment request failed');
    return j;
  }

  async function createReceipt({ partyId, amount, date, description, method = 'cash' }) {
    const t = await ensureToken();
    const r = await fetchImpl(`${base}/api/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: t, party_id: partyId, amount, date, description, method: method || 'cash' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'receipt request failed');
    return j;
  }

  async function createParty({ name, phone = '', address = '', opening_balance = 0, party_type = 'customer' }) {
    const t = await ensureToken();
    const r = await fetchImpl(`${base}/api/parties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: t, name, phone, address, opening_balance, party_type }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'party request failed');
    return j;
  }

  async function createExpense({ amount, date, category, description, method = 'cash' }) {
    const t = await ensureToken();
    const r = await fetchImpl(`${base}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: t, amount, date, category, description, method }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'expense request failed');
    return j;
  }

  async function getToday(date) {
    const r = await authedGet(`/api/today?date=${encodeURIComponent(date)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'today request failed');
    return j;
  }

  // Entries created in the last `minutes` for a party (for duplicate detection).
  // /api/entries/recent only covers sales + receipts, so purchase/payment
  // entries are merged in from /api/ledger (duplicate match is on date+amount).
  // -> [{type:'sale'|'receipt'|'purchase'|'payment', id, amount, description, date, created_at}]
  async function getRecentEntries(partyId, minutes = 120) {
    const r = await authedGet(
      `/api/entries/recent?party_id=${encodeURIComponent(partyId)}&minutes=${encodeURIComponent(minutes)}`
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'recent entries request failed');
    const entries = j.entries || [];
    try {
      const lr = await authedGet(`/api/ledger?party_id=${encodeURIComponent(partyId)}`);
      const lj = await lr.json().catch(() => ({}));
      if (lr.ok && Array.isArray(lj.entries)) {
        const have = new Set(entries.map((e) => `${e.type}:${e.id}`));
        for (const e of lj.entries) {
          if (e.type !== 'purchase' && e.type !== 'payment') continue;
          const key = `${e.type}:${e.id}`;
          if (have.has(key)) continue;
          have.add(key);
          entries.push({
            type: e.type, id: e.id, amount: e.amount,
            description: e.description || '', date: e.date, created_at: '',
          });
        }
      }
    } catch { /* duplicate detection just falls back to sales + receipts */ }
    return entries;
  }

  async function deleteEntry(entryType, id) {
    const t = await ensureToken();
    const endpointByType = {
      sale: 'sales',
      purchase: 'purchases',
      receipt: 'receipts',
      payment: 'payments',
      expense: 'expenses',
      party: 'parties',
    };
    const endpoint = endpointByType[entryType];
    if (!endpoint) throw new Error(`unknown entry type: ${entryType}`);
    const path = `/api/${endpoint}/${id}`;
    const r = await fetchImpl(withToken(path, t), { method: 'DELETE' });
    if (r.status === 401) {
      token = null;
      const t2 = await ensureToken();
      const r2 = await fetchImpl(withToken(path, t2), { method: 'DELETE' });
      const j2 = await r2.json().catch(() => ({}));
      if (!r2.ok || !j2.ok) throw new Error(j2.error || 'delete request failed');
      return j2;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'delete request failed');
    return j;
  }

  return {
    login,
    ensureToken,
    getParties,
    findParty,
    getBalance,
    createSale,
    createPurchase,
    createPayment,
    createReceipt,
    createParty,
    createExpense,
    getToday,
    getRecentEntries,
    deleteEntry,
  };
}

// Per-user client: logs in via POST /api/auth/login {username, password}.
// The token is scoped to that user (per-user isolation): parties, entries,
// balances — everything done with this client lands in the user's own ledger.
// The token auto-refreshes using the stored credentials (kept in memory only,
// never logged). If the password changes server-side, login fails with 401 and
// the caller should ask the user to log in again.
export function createUserLedgerClient({ baseUrl, username, password, fetchImpl = fetch }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return createLedgerClient({
    baseUrl: base,
    fetchImpl,
    loginFn: async () => {
      const r = await fetchImpl(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok || !j.token) throw loginError(r, j, 'login failed');
      return j.token;
    },
  });
}
