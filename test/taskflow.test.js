import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskStore, TASK_STEPS, expenseCategoryLabel } from '../taskflow.js';

test('party and expense tasks start on separate first steps', () => {
  const store = createTaskStore();
  const party = store.start('a', 'party');
  assert.equal(party.step, TASK_STEPS.NAME);
  const expense = store.start('b', 'expense');
  assert.equal(expense.step, TASK_STEPS.CATEGORY);
});

test('task setStep stores fields without touching another sender', () => {
  const store = createTaskStore();
  store.start('a', 'party');
  store.start('b', 'expense');
  store.setStep('a', TASK_STEPS.PHONE, { partyName: 'Ahmed Store' });
  assert.equal(store.get('a').partyName, 'Ahmed Store');
  assert.equal(store.get('b').partyName, undefined);
  store.clear('a');
  assert.equal(store.get('a'), null);
  assert.ok(store.get('b'));
});

test('expense category labels are professional English', () => {
  assert.equal(expenseCategoryLabel('rent'), 'Rent');
  assert.equal(expenseCategoryLabel('electricity'), 'Electricity');
  assert.equal(expenseCategoryLabel('unknown'), 'Other');
});
