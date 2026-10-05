import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCaption, formatRs } from '../parser.js';

test('basic sale', () => {
  assert.deepEqual(parseCaption('Ahmed Traders sales 50000'),
    { ok: true, partyName: 'Ahmed Traders', type: 'sale', amount: 50000 });
});

test('singular sale + comma amount + case-insensitive type', () => {
  assert.deepEqual(parseCaption('Ahmed Traders SALE 50,000'),
    { ok: true, partyName: 'Ahmed Traders', type: 'sale', amount: 50000 });
});

test('receipt with decimal amount', () => {
  assert.deepEqual(parseCaption('ABC Co receipt 12500.50'),
    { ok: true, partyName: 'ABC Co', type: 'receipt', amount: 12500.5 });
});

test('single-word party name', () => {
  assert.deepEqual(parseCaption('Ahmed sales 100'),
    { ok: true, partyName: 'Ahmed', type: 'sale', amount: 100 });
});

test('paid/payment map to payment, received/receipts map to receipt', () => {
  assert.equal(parseCaption('Ahmed Traders paid 20000').type, 'payment');
  assert.equal(parseCaption('Ahmed Traders payment 20000').type, 'payment');
  assert.equal(parseCaption('Ahmed Traders adaigi 20000').type, 'payment');
  assert.equal(parseCaption('Ahmed Traders received 20000').type, 'receipt');
  assert.equal(parseCaption('Ahmed Traders receipts 20000').type, 'receipt');
  assert.equal(parseCaption('Ahmed Traders wasooli 20000').type, 'receipt');
});

test('purchase/kharid map to purchase', () => {
  assert.equal(parseCaption('Steel Co purchase 80000').type, 'purchase');
  assert.equal(parseCaption('Steel Co kharid 80000').type, 'purchase');
});

test('extra whitespace tolerated', () => {
  assert.deepEqual(parseCaption('  Ahmed Traders   Sales   5,000  '),
    { ok: true, partyName: 'Ahmed Traders', type: 'sale', amount: 5000 });
});

test('party name with slash and dots kept', () => {
  assert.deepEqual(parseCaption('M/S Ahmed Traders sales 50000'),
    { ok: true, partyName: 'M/S Ahmed Traders', type: 'sale', amount: 50000 });
});

test('missing type is invalid', () => {
  assert.equal(parseCaption('Ahmed Traders 50000').ok, false);
});

test('missing amount is invalid', () => {
  assert.equal(parseCaption('Ahmed Traders sales').ok, false);
});

test('missing party name is invalid', () => {
  assert.equal(parseCaption('sales 50000').ok, false);
});

test('unknown type keyword is invalid', () => {
  assert.equal(parseCaption('Ahmed Traders xyz 50000').ok, false);
});

test('non-numeric amount is invalid', () => {
  assert.equal(parseCaption('Ahmed Traders sales abc').ok, false);
});

test('zero and negative amounts are invalid', () => {
  assert.equal(parseCaption('Ahmed Traders sales 0').ok, false);
  assert.equal(parseCaption('Ahmed Traders sales -500').ok, false);
});

test('empty caption is invalid', () => {
  assert.equal(parseCaption('').ok, false);
  assert.equal(parseCaption('   ').ok, false);
});

test('formatRs', () => {
  assert.equal(formatRs(50000), 'Rs 50,000');
  assert.equal(formatRs(12500.5), 'Rs 12,500.50');
  assert.equal(formatRs(0), 'Rs 0');
});
