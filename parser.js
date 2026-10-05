// Caption parser for the Market Ledger WhatsApp bot.
// Caption format: "<party name> <type> <amount>"
// Examples: "Ahmed Traders sales 50000", "ABC Co receipt 12,500.50", "Steel Co purchase 80000"

const SALE_KEYS = new Set(['sale', 'sales']);
const RECEIPT_KEYS = new Set(['receipt', 'receipts', 'received', 'wasooli']);
const PURCHASE_KEYS = new Set(['purchase', 'purchases', 'kharid']);
const PAYMENT_KEYS = new Set(['payment', 'payments', 'paid', 'adaigi']);

export function parseCaption(caption) {
  const fail = (reason) => ({ ok: false, reason });
  const tokens = String(caption || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return fail('too_few_tokens');

  const amountRaw = tokens[tokens.length - 1].replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(amountRaw)) return fail('bad_amount');
  const amount = parseFloat(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) return fail('bad_amount');

  const typeRaw = tokens[tokens.length - 2].toLowerCase();
  let type = null;
  if (SALE_KEYS.has(typeRaw)) type = 'sale';
  else if (RECEIPT_KEYS.has(typeRaw)) type = 'receipt';
  else if (PURCHASE_KEYS.has(typeRaw)) type = 'purchase';
  else if (PAYMENT_KEYS.has(typeRaw)) type = 'payment';
  else return fail('bad_type');

  const partyName = tokens.slice(0, -2).join(' ').trim();
  if (!partyName) return fail('no_party');

  return { ok: true, partyName, type, amount };
}

// "Rs 50,000" / "Rs 12,500.50"
export function formatRs(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const str = Number.isInteger(v)
    ? v.toLocaleString('en-US')
    : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Rs ${str}`;
}

export const USAGE_TEXT =
  '📸 Bill ki *photo ya PDF* bhejo — phir main khud poochhunga:\n' +
  '1️⃣ Party ka number\n2️⃣ Sales ya Receipt\n3️⃣ Amount\n\n' +
  'Shortcut: photo ke saath caption "<party name> sales|receipt|purchase|payment <amount>" bhi chalega.';
