// convo.js — step-by-step conversational bill entry sessions for the Market Ledger bot.
//
// New flow: user sends a bill photo/PDF (no caption needed) → bot asks for
// party (numbered list) → bot asks type (1=Sales, 2=Receipt) → bot asks amount
// → entry is created. One active session per sender; sessions expire after TTL.

export const CONVO_TTL_MS = 10 * 60 * 1000; // 10 minutes to finish the steps

export const STEPS = {
  PARTY: 'party',
  TYPE: 'type',
  AMOUNT: 'amount',
};

export function createConvoStore(ttlMs = CONVO_TTL_MS) {
  const map = new Map(); // sessionKey -> { step, media, partyId, partyName, entryType, at }

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

// "5000\nInv#0988 imran ali" -> { amount: 5000, description: "Inv#0988 imran ali" }
// "50000"                   -> { amount: 50000, description: "" }
// "abc" / ""                -> { amount: null, description: "" }
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
