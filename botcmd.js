// Parses the group activation command:
//   activate <user-id> <password>  -> { username, password }
//   activate (bare)                 -> { usage: true }
// Anything else -> null.
// The guided entry flow can also start without a photo: typing just "bill"
// in a bound group opens the same party → type → amount → description → date
// steps. Anything else is not a bill command.
export function isBillCommand(text) {
  return /^bill$/i.test(String(text || '').trim());
}

const BOT_COMMANDS = new Map([
  ['bill', 'bill'],
  ['newparty', 'newparty'],
  ['new party', 'newparty'],
  ['addparty', 'newparty'],
  ['add party', 'newparty'],
  ['expense', 'expense'],
  ['kharcha', 'expense'],
  ['add expense', 'expense'],
  ['today', 'today'],
  ['aaj', 'today'],
  ['daily closing', 'today'],
  ['closing', 'today'],
  ['dues', 'dues'],
  ['udhar', 'dues'],
  ['pending', 'dues'],
  ['help', 'help'],
  ['menu', 'help'],
  ['commands', 'help'],
  ['undo', 'undo'],
  ['undo karo', 'undo'],
]);

// Exact commands only — normal chat text must never trigger a workflow by accident.
export function parseBotCommand(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return BOT_COMMANDS.get(t) || null;
}

export const METHOD_OPTIONS = [
  { v: 'cash', label: 'Cash' },
  { v: 'jazzcash', label: 'JazzCash' },
  { v: 'easypaisa', label: 'EasyPaisa' },
  { v: 'bank', label: 'Bank' },
];

export function parseMethodSelection(text) {
  const t = String(text || '').trim().toLowerCase();
  if (t === '1' || t === 'cash') return 'cash';
  if (t === '2' || t === 'jazzcash' || t === 'jazz cash') return 'jazzcash';
  if (t === '3' || t === 'easypaisa' || t === 'easy paisa') return 'easypaisa';
  if (t === '4' || t === 'bank' || t === 'bank transfer') return 'bank';
  return null;
}

export function methodLabel(v) {
  return (METHOD_OPTIONS.find((m) => m.v === v) || METHOD_OPTIONS[0]).label;
}

export function parseActivateCommand(text) {
  const t = String(text || '').trim();
  const m = t.match(/^activate\s+(\S+)\s+(.+?)\s*$/i);
  if (m) return { username: m[1], password: m[2] };
  if (/^activate\s*$/i.test(t)) return { usage: true };
  return null;
}
