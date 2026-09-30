// Tests for the conversational bill-entry flow (convo.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createConvoStore,
  STEPS,
  parseAmount,
  parseSelection,
  formatPartyList,
  CANCEL_WORDS,
  CONVO_TTL_MS,
} from '../convo.js';

test('convo store: start → get → setStep → clear', () => {
  const store = createConvoStore();
  const media = { buffer: Buffer.from('x'), mimetype: 'image/jpeg', filename: 'bill.jpg', kind: 'image' };
  assert.equal(store.get('u1'), null);

  const s = store.start('u1', media);
  assert.equal(s.step, STEPS.PARTY);
  assert.equal(store.get('u1').media.kind, 'image');

  store.setStep('u1', STEPS.TYPE, { partyId: 'p1', partyName: 'Ahmed' });
  const s2 = store.get('u1');
  assert.equal(s2.step, STEPS.TYPE);
  assert.equal(s2.partyName, 'Ahmed');

  store.setStep('u1', STEPS.AMOUNT, { entryType: 'sale' });
  assert.equal(store.get('u1').entryType, 'sale');

  store.clear('u1');
  assert.equal(store.get('u1'), null);
});

test('convo store: sessions are per-sender', () => {
  const store = createConvoStore();
  store.start('alice', { kind: 'image' });
  store.start('bob', { kind: 'pdf' });
  assert.equal(store.get('alice').media.kind, 'image');
  assert.equal(store.get('bob').media.kind, 'pdf');
  assert.equal(store.size(), 2);
  store.clear('alice');
  assert.equal(store.get('bob').media.kind, 'pdf');
});

test('convo store: sessions expire after TTL', async () => {
  const store = createConvoStore(30); // 30ms TTL for the test
  store.start('u1', { kind: 'image' });
  assert.ok(store.get('u1'));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(store.get('u1'), null);
});

test('convo store: touch refreshes expiry', async () => {
  const store = createConvoStore(60);
  store.start('u1', { kind: 'image' });
  await new Promise((r) => setTimeout(r, 30));
  store.touch('u1');
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(store.get('u1'), 'touched session should still be alive');
});

test('parseAmount: plain, commas, decimals, Rs prefix', () => {
  assert.equal(parseAmount('50000'), 50000);
  assert.equal(parseAmount('50,000'), 50000);
  assert.equal(parseAmount('12,500.50'), 12500.5);
  assert.equal(parseAmount('Rs 50000'), 50000);
  assert.equal(parseAmount('rs 1,25,000'), 125000);
  assert.equal(parseAmount('  7500  '), 7500);
});

test('parseAmount: rejects garbage', () => {
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('-500'), null);
  assert.equal(parseAmount('12.34.56'), null);
  assert.equal(parseAmount(null), null);
});

test('parseSelection: valid and out-of-range', () => {
  assert.equal(parseSelection('2', 5), 2);
  assert.equal(parseSelection('1', 1), 1);
  assert.equal(parseSelection(' 3 ', 5), 3);
  assert.equal(parseSelection('0', 5), null);
  assert.equal(parseSelection('6', 5), null);
  assert.equal(parseSelection('abc', 5), null);
  assert.equal(parseSelection('', 5), null);
  assert.equal(parseSelection('2.5', 5), 2); // parseInt semantics
});

test('formatPartyList: numbered list', () => {
  const out = formatPartyList([{ name: 'Ahmed Traders' }, { name: 'Bilal Store' }]);
  assert.equal(out, '1. Ahmed Traders\n2. Bilal Store');
  assert.equal(formatPartyList([]), '');
});

test('CANCEL_WORDS contains cancel variants', () => {
  assert.ok(CANCEL_WORDS.has('cancel'));
  assert.ok(!CANCEL_WORDS.has('hello'));
});

test('CONVO_TTL_MS is 10 minutes', () => {
  assert.equal(CONVO_TTL_MS, 10 * 60 * 1000);
});
