// Parses the group activation command:
//   activate <user-id> <password>  -> { username, password }
//   activate (bare)                 -> { usage: true }
// Anything else -> null.
export function parseActivateCommand(text) {
  const t = String(text || '').trim();
  const m = t.match(/^activate\s+(\S+)\s+(.+?)\s*$/i);
  if (m) return { username: m[1], password: m[2] };
  if (/^activate\s*$/i.test(t)) return { usage: true };
  return null;
}
