// taskflow.js — separate guided workflows for the WhatsApp bot.
// Kept apart from convo.js (bill entries) so a new-party or expense flow can
// never mix with a bill photo flow. One active task per sender.

export const TASK_TTL_MS = 10 * 60 * 1000;

export const TASK_STEPS = {
  NAME: 'name',
  PARTY_TYPE: 'party_type',
  PHONE: 'phone',
  OPENING: 'opening',
  CATEGORY: 'category',
  AMOUNT: 'amount',
  METHOD: 'method',
  DATE: 'date',
  DESCRIPTION: 'description',
  CONFIRM: 'confirm',
};

export const EXPENSE_CATEGORY_OPTIONS = [
  { v: 'rent', label: 'Rent' },
  { v: 'salary', label: 'Salary' },
  { v: 'electricity', label: 'Electricity' },
  { v: 'delivery', label: 'Delivery' },
  { v: 'fuel', label: 'Fuel' },
  { v: 'shop', label: 'Shop Expense' },
  { v: 'other', label: 'Other' },
];

export function expenseCategoryLabel(v) {
  return (EXPENSE_CATEGORY_OPTIONS.find((c) => c.v === v) || EXPENSE_CATEGORY_OPTIONS[EXPENSE_CATEGORY_OPTIONS.length - 1]).label;
}

export function createTaskStore(ttlMs = TASK_TTL_MS) {
  const map = new Map();

  function get(key) {
    const s = map.get(key);
    if (!s) return null;
    if (Date.now() - s.at > ttlMs) {
      map.delete(key);
      return null;
    }
    return s;
  }

  return {
    start(key, flow) {
      const s = {
        flow, // 'party' | 'expense'
        step: flow === 'party' ? TASK_STEPS.NAME : TASK_STEPS.CATEGORY,
        at: Date.now(),
      };
      map.set(key, s);
      return s;
    },
    get,
    setStep(key, step, patch = {}) {
      const s = get(key);
      if (!s) return null;
      s.step = step;
      Object.assign(s, patch);
      s.at = Date.now();
      return s;
    },
    clear(key) {
      map.delete(key);
    },
    size() {
      return map.size;
    },
  };
}
