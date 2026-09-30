// Market Ledger API client (talks to the Pages Functions backend).
// Auth: POST /api/login {password} -> {ok:true, token}; token is cached and
// refreshed when expired or when the API answers 401.

export function createLedgerClient({ baseUrl, password, fetchImpl = fetch }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  let token = null;
  let tokenExp = 0;

  async function login() {
    const r = await fetchImpl(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok || !j.token) throw new Error('ledger login failed');
    token = j.token;
    const exp = parseInt(String(j.token).split('.')[0], 10);
    tokenExp = Number.isFinite(exp) ? exp : Date.now() + 12 * 3600 * 1000;
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

  // Sales need the bill file (backend uploads it to Cloudinary).
  async function createSale({ partyId, amount, date, description, photoBuffer, filename, mimetype }) {
    const t = await ensureToken();
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

  async function createReceipt({ partyId, amount, date, description }) {
    const t = await ensureToken();
    const r = await fetchImpl(`${base}/api/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: t, party_id: partyId, amount, date, description }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'receipt request failed');
    return j;
  }

  // Entries created in the last `minutes` for a party (for duplicate detection).
  // -> [{type:'sale'|'receipt', id, amount, description, date, created_at}]
  async function getRecentEntries(partyId, minutes = 120) {
    const r = await authedGet(
      `/api/entries/recent?party_id=${encodeURIComponent(partyId)}&minutes=${encodeURIComponent(minutes)}`
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'recent entries request failed');
    return j.entries || [];
  }

  async function deleteEntry(entryType, id) {
    const t = await ensureToken();
    const path = entryType === 'sale' ? `/api/sales/${id}` : `/api/receipts/${id}`;
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
    createReceipt,
    getRecentEntries,
    deleteEntry,
  };
}
