// convo.js — step-by-step conversational bill entry sessions for the Market Ledger bot.
//
// New flow: user sends a bill photo/PDF (no caption needed) → bot asks for
// party (numbered list) → bot asks type (1=Sales, 2=Receipt, 3=Purchase, 4=Payment) → bot asks amount
// → bot asks description (separate step, optional — "skip" to skip) → bot asks
// date → entry is created. One active session per sender; sessions expire after TTL.

export const CONVO_TTL_MS = 10 * 60 * 1000; // 10 minutes to finish the steps

export const STEPS = {
  PARTY: 'party',
  TYPE: 'type',
  AMOUNT: 'amount',
  METHOD: 'method',
  DESCRIPTION: 'description',
  DATE: 'date',
  CONFIRM: 'confirm',
};

export function createConvoStore(ttlMs = CONVO_TTL_MS) {
  const map = new Map(); // sessionKey -> { step, media, partyId, partyName, entryType, amount, description, entryDate, at }

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
    /** Start a new session for a sender (replaces any older one). */
    start(key, media) {
      const s = {
        step: STEPS.PARTY,
        media, // { buffer, mimetype, filename, kind: 'image'|'pdf' }
        partyId: null,
        partyName: null,
        entryType: null,
        at: Date.now(),
      };
      map.set(key, s);
      return s;
    },

    /** Get the live session for a sender (null when none/expired). */
    get,

    /** Refresh the expiry timer (call on every valid step). */
    touch(key) {
      const s = get(key);
      if (s) s.at = Date.now();
      return s;
    },

    /** Move to the next step and merge extra fields. */
    setStep(key, step, patch = {}) {
      const s = get(key);
      if (!s) return null;
      s.step = step;
      Object.assign(s, patch);
      s.at = Date.now();
      return s;
    },

    /** End the session (done or cancelled). */
    clear(key) {
      map.delete(key);
    },

    size() {
      return map.size;
    },
  };
}

// Opening balance can be negative (purchaser ko dena hai). "skip"/"0" -> 0.
export function parseOpeningBalance(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t || ['skip', '-', 'nahi', 'nahin', 'no', '0'].includes(t)) return 0;
  const negative = t.startsWith('-');
  const v = parseAmount(negative ? t.slice(1) : t);
  if (v === null) return null;
  return negative ? -v : v;
}

// "50,000" / "Rs 50000.50" / "50000" -> 50000 ; null when not a positive amount
export function parseAmount(text) {
  const raw = String(text || '');
  if (/-/.test(raw)) return null; // negatives are never valid here
  const cleaned = raw
    .replace(/[^0-9.,]/g, '')
    .replace(/,/g, '')
    .trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const v = parseFloat(cleaned);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 100) / 100;
}

// Strict amount check for the first line: "50000", "50,000", "50000.50",
// "Rs 50000", "5000/-" are ok; "5000 Inv#0988" is not (that's a description).
function parseAmountLine(line) {
  if (!/^\s*(rs\.?\s*)?[\d,]+(\.\d+)?\s*(\/-)?\s*$/i.test(String(line || ''))) return null;
  return parseAmount(line);
}

// "5000\nInv#0988" -> { amount: 5000, description: "Inv#0988" }
// "50000"          -> { amount: 50000, description: "" }
// "abc" / ""       -> { amount: null, description: "" }
export function parseAmountAndDescription(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { amount: null, description: '' };
  const amount = parseAmountLine(lines[0]);
  if (amount === null) return { amount: null, description: '' };
  return { amount, description: lines.slice(1).join(' ').trim() };
}

// Parse a bill date from user text. todayISO = 'YYYY-MM-DD' reference (caller's timezone).
// Accepts: "aaj"/"today" -> today, "kal"/"yesterday" -> yesterday,
// "2026-09-28", "28-09-2026", "28/09/2026", "28.09.2026".
// Returns 'YYYY-MM-DD' or null (invalid, or a future date).
export function parseDateInput(text, todayISO) {
  const t = String(text || '').trim().toLowerCase();
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(String(todayISO || ''))) return null;

  const shiftDays = (iso, days) => {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  if (['aaj', 'aj', 'today'].includes(t)) return todayISO;
  if (['kal', 'yesterday'].includes(t)) return shiftDays(todayISO, -1);

  let y, m, d;
  let mch = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mch) {
    [, y, m, d] = mch;
  } else {
    mch = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (!mch) return null;
    [, d, m, y] = mch;
  }
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // Real calendar date? (rejects 31-02-2026 etc.)
  const dt = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.toISOString().slice(0, 10) !== iso) return null;
  if (iso > todayISO) return null; // no future bills
  return iso;
}

// "2" with max 5 -> 2 ; "0"/"9"/"abc" -> null
export function parseSelection(text, max) {
  const n = parseInt(String(text || '').trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

// ["Ahmed","Bilal"] -> "1. Ahmed\n2. Bilal"
export function formatPartyList(parties) {
  return (parties || []).map((p, i) => `${i + 1}. ${p.name}`).join('\n');
}

export const CANCEL_WORDS = new Set(['cancel', '❌', 'cancelled']);
