import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedgerClient } from '../ledger.js';

// NOTE: no real LEDGER_PASSWORD anywhere here — dummy only, no production writes.

function mockFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    for (const r of routes) {
      if (r.match(url, opts)) {
        const body = typeof r.json === 'function' ? r.json() : r.json;
        return {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          json: async () => body,
        };
      }
    }
    throw new Error('no mock route for ' + url);
  };
  fn.calls = calls;
  return fn;
}

const LOGIN = { status: 200, json: { ok: true, token: `${Date.now() + 3600000}.abc123` } };
const isLogin = (url, opts) => url.includes('/api/login') && opts.method === 'POST';

test('login caches token — second call makes no new login request', async () => {
  const f = mockFetch([{ match: isLogin, ...LOGIN }]);
  const c = createLedgerClient({ baseUrl: 'https://x.test', password: 'dummy', fetchImpl: f });
  const t1 = await c.ensureToken();
  const t2 = await c.ensureToken();
  assert.equal(t1, t2);
  assert.equal(f.calls.filter((x) => isLogin(x.url, x.opts)).length, 1);
});

test('expired token triggers re-login', async () => {
  const f = mockFetch([{
    match: isLogin,
    status: 200,
    json: { ok: true, token: `${Date.now() - 1000}.old` }, // already expired
  }]);
  const c = createLedgerClient({ baseUrl: 'https://x.test', password: 'dummy', fetchImpl: f });
  await c.ensureToken();
  await c.ensureToken();
  assert.equal(f.calls.filter((x) => isLogin(x.url, x.opts)).length, 2);
});

test('401 on parties triggers one re-login then retry', async () => {
  const parties = [{ id: 1, name: 'Ahmed Traders', balance: 30000 }];
  let loginCount = 0;
  const f = mockFetch([
    {
      match: (url, opts) => isLogin(url, opts),
      status: 200,
      json: () => ({ ok: true, token: `${Date.now() + 3600000}.tok${++loginCount}` }),
    },
    {
      match: (url) => url.includes('/api/parties') && url.includes('tok1'),
      status: 401, json: { error: 'Unauthorized' },
    },
    {
      match: (url) => url.includes('/api/parties') && url.includes('tok2'),
      status: 200, json: { parties },
    },
  ]);
  const c = createLedgerClient({ baseUrl: 'https://x.test', password: 'dummy', fetchImpl: f });
  const got = await c.getParties();
  assert.deepEqual(got, parties);
  assert.equal(loginCount, 2);
});

test('findParty is case-insensitive exact match; not-found returns null', () => {
  const c = createLedgerClient({ baseUrl: 'https://x.test', password: 'dummy' });
  const parties = [
    { id: 1, name: 'Ahmed Traders' },
    { id: 2, name: 'ABC Co' },
  ];
  assert.deepEqual(c.findParty(parties, 'ahmed traders'), parties[0]);
  assert.deepEqual(c.findParty(parties, '  ABC CO  '), parties[1]);
  assert.equal(c.findParty(parties, 'Ahmed'), null); // partial != exact
  assert.equal(c.findParty(parties, 'Nobody Here'), null);
  assert.equal(c.findParty([], 'Ahmed Traders'), null);
});

test('createSale sends multipart FormData with photo', async () => {
  let seen = null;
  const f = mockFetch([
    { match: isLogin, ...LOGIN },
    {
      match: (url, opts) => {
        if (url.includes('/api/sales') && opts.method === 'POST') { seen = opts.body; return true; }
        return false;
      },
      status: 200, json: { ok: true, id: 7, photo_url: 'https://cdn/x.jpg' },
    },
  ]);
  const c = createLedgerClient({ baseUrl: 'https://x.test', password: 'dummy', fetchImpl: f });
  const res = await c.createSale({
    partyId: 1, amount: 50000, date: '2026-09-30',
    description: 'Added via WhatsApp',
    photoBuffer: Buffer.from([1, 2, 3]), filename: 'bill.jpg',
  });
  assert.equal(res.ok, true);
  assert.ok(seen instanceof FormData, 'body must be FormData');
  assert.equal(seen.get('party_id'), '1');
  assert.equal(seen.get('amount'), '50000');
  assert.equal(seen.get('date'), '2026-09-30');
  const photo = seen.get('photo');
  assert.equal(photo.name, 'bill.jpg');
});

test('createReceipt sends JSON without photo field', async () => {
  let seenBody = null;
  const f = mockFetch([
    { match: isLogin, ...LOGIN },
    {
      match: (url, opts) => {
        if (url.includes('/api/receipts') && opts.method === 'POST') {
          seenBody = JSON.parse(opts.body); return true;
        }
        return false;
      },
      status: 200, json: { ok: true, id: 3 },
    },
  ]);
  const c = createLedgerClient({ baseUrl: 'https://x.test', password: 'dummy', fetchImpl: f });
  await c.createReceipt({ partyId: 2, amount: 20000, date: '2026-09-30', description: 'Added via WhatsApp | Photo: https://cdn/r.jpg' });
  assert.equal(seenBody.party_id, 2);
  assert.equal(seenBody.amount, 20000);
  assert.ok(!('photo' in seenBody), 'receipts must not carry a photo field');
  assert.ok(seenBody.description.includes('https://cdn/r.jpg'));
});

test('getBalance returns totals.balance', async () => {
  const f = mockFetch([
    { match: isLogin, ...LOGIN },
    {
      match: (url) => url.includes('/api/ledger'),
      status: 200, json: { totals: { sales: 50000, receipts: 20000, balance: 30000 } },
    },
  ]);
  const c = createLedgerClient({ baseUrl: 'https://x.test', password: 'dummy', fetchImpl: f });
  assert.equal(await c.getBalance(1), 30000);
});

test('login failure throws', async () => {
  const f = mockFetch([{ match: isLogin, status: 401, json: { error: 'Wrong password' } }]);
  const c = createLedgerClient({ baseUrl: 'https://x.test', password: 'wrong', fetchImpl: f });
  await assert.rejects(() => c.ensureToken(), /ledger login failed/);
});
