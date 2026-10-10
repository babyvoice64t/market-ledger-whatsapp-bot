// Tests for the conversational bill-entry flow (convo.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createConvoStore,
  STEPS,
  parseAmount,
  parseAmountAndDescription,
  parseOpeningBalance,
  parseDateInput,
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

test('parseAmountAndDescription: amount + description on next lines', () => {
  assert.deepEqual(parseAmountAndDescription('5000\nInv#0988'), {
    amount: 5000,
    description: 'Inv#0988',
  });
  assert.deepEqual(parseAmountAndDescription('50000'), { amount: 50000, description: '' });
  assert.deepEqual(parseAmountAndDescription('Rs 12,500.50\nnote here'), {
    amount: 12500.5,
    description: 'note here',
  });
  assert.deepEqual(parseAmountAndDescription('5000\nline one\nline two'), {
    amount: 5000,
    description: 'line one line two',
  });
});

test('parseAmountAndDescription: rejects bad amount, same-line mixing', () => {
  assert.deepEqual(parseAmountAndDescription(''), { amount: null, description: '' });
  assert.deepEqual(parseAmountAndDescription('abc'), { amount: null, description: '' });
  assert.deepEqual(parseAmountAndDescription('5000 Inv#0988'), { amount: null, description: '' });
  assert.deepEqual(parseAmountAndDescription('-500\nnote'), { amount: null, description: '' });
});

test('parseDateInput: aaj/kal/formats', () => {
  assert.equal(parseDateInput('aaj', '2026-10-01'), '2026-10-01');
  assert.equal(parseDateInput('AAJ', '2026-10-01'), '2026-10-01');
  assert.equal(parseDateInput('today', '2026-10-01'), '2026-10-01');
  assert.equal(parseDateInput('kal', '2026-10-01'), '2026-09-30');
  assert.equal(parseDateInput('yesterday', '2026-10-01'), '2026-09-30');
  assert.equal(parseDateInput('kal', '2026-03-01'), '2026-02-28'); // month boundary
  assert.equal(parseDateInput('2026-09-28', '2026-10-01'), '2026-09-28');
  assert.equal(parseDateInput('28-09-2026', '2026-10-01'), '2026-09-28');
  assert.equal(parseDateInput('28/09/2026', '2026-10-01'), '2026-09-28');
  assert.equal(parseDateInput('1-9-2026', '2026-10-01'), '2026-09-01');
});

test('parseDateInput: rejects invalid and future dates', () => {
  assert.equal(parseDateInput('', '2026-10-01'), null);
  assert.equal(parseDateInput('abc', '2026-10-01'), null);
  assert.equal(parseDateInput('31-02-2026', '2026-10-01'), null); // not a real date
  assert.equal(parseDateInput('2026-13-01', '2026-10-01'), null);
  assert.equal(parseDateInput('2026-10-05', '2026-10-01'), null); // future
  assert.equal(parseDateInput('05-10-2026', '2026-10-01'), null); // future
  assert.equal(parseDateInput('aaj', 'not-a-date'), null);
});

test('STEPS has description, date and confirm steps', () => {
  assert.equal(STEPS.DESCRIPTION, 'description');
  assert.equal(STEPS.DATE, 'date');
  assert.equal(STEPS.CONFIRM, 'confirm');
});

test('CANCEL_WORDS contains cancel variants', () => {
  assert.ok(CANCEL_WORDS.has('cancel'));
  assert.ok(!CANCEL_WORDS.has('hello'));
});

test('CONVO_TTL_MS is 10 minutes', () => {
  assert.equal(CONVO_TTL_MS, 10 * 60 * 1000);
});

test('parseOpeningBalance accepts signed and skipped balances', () => {
  assert.equal(parseOpeningBalance('5000'), 5000);
  assert.equal(parseOpeningBalance('-5000'), -5000);
  assert.equal(parseOpeningBalance('Rs 12,500'), 12500);
  assert.equal(parseOpeningBalance('skip'), 0);
  assert.equal(parseOpeningBalance('0'), 0);
  assert.equal(parseOpeningBalance('abc'), null);
});
