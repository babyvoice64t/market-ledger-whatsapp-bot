// Parses staff auth commands sent to the bot (group or DM).
//   login <user-id> <password>  -> { cmd:'login', username, password }
//   logout                      -> { cmd:'logout' }
//   me | whoami                  -> { cmd:'me' }
// Anything else -> null (not an auth command).
export function parseAuthCommand(text) {
  const t = String(text || '').trim();
  const m = t.match(/^login\s+(\S+)\s+(.+?)\s*$/i);
  if (m) return { cmd: 'login', username: m[1], password: m[2] };
  const low = t.toLowerCase();
  if (low === 'logout') return { cmd: 'logout' };
  if (low === 'me' || low === 'whoami') return { cmd: 'me' };
  return null;
}
