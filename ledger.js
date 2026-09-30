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

  // Sales need the bill photo (backend uploads it to Cloudinary).
  async function createSale({ partyId, amount, date, description, photoBuffer, filename }) {
    const t = await ensureToken();
    const form = new FormData();
    form.append('password', t);
    form.append('party_id', String(partyId));
    form.append('amount', String(amount));
    form.append('date', date);
    if (description) form.append('description', description);
    form.append('photo', new Blob([photoBuffer], { type: 'image/jpeg' }), filename || 'bill.jpg');
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

  return {
    login,
    ensureToken,
    getParties,
    findParty,
    getBalance,
    createSale,
    createReceipt,
  };
}
