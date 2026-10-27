// Direct Cloudinary uploads (receipt PDFs + any file the bot uploads itself).
//
// Multi-account with failover. Accounts come from env: set 1 uses the plain
// CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET names,
// sets 2..6 add a _2 … _6 suffix. Only complete sets count. An upload starts
// from the portal's least-busy pick (cached 5 min) and walks the list —
// wrapping around once — until one account accepts it, so a full or
// rate-limited account never blocks a receipt save; if the portal pick is
// unavailable it simply starts at account 1 (local order).
//
// Uploads are RAW signed HTTPS posts, not the cloudinary SDK: the SDK holds a
// single global config and cannot switch accounts per upload.
import { createHash, randomBytes } from 'node:crypto';

// Ordered [{ cloud, key, secret }] from env sets 1..6; incomplete sets skip.
export function cloudinaryAccounts(env = process.env) {
  const accounts = [];
  for (let i = 1; i <= 6; i++) {
    const sfx = i === 1 ? '' : `_${i}`;
    const cloud = String(env[`CLOUDINARY_CLOUD_NAME${sfx}`] || '').trim();
    const key = String(env[`CLOUDINARY_API_KEY${sfx}`] || '').trim();
    const secret = String(env[`CLOUDINARY_API_SECRET${sfx}`] || '').trim();
    if (cloud && key && secret) accounts.push({ cloud, key, secret });
  }
  return accounts;
}

// Cloudinary signature: SHA1 of the alphabetically-sorted signed params
// ("k=v" joined with '&') with the api_secret appended.
export function cloudinarySignature(params, secret) {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== '' && params[k] != null)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1').update(toSign + secret).digest('hex');
}

// One signed upload to ONE account (folder market-ledger/, random public_id,
// type 'authenticated' — same shape the SDK path produced). Resolves with
// secure_url; rejects with an Error carrying Cloudinary's message.
export async function uploadToAccount(acct, buffer, mimetype, fetchImpl = fetch) {
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = 's' + randomBytes(9).toString('hex');
  const signature = cloudinarySignature(
    { folder: 'market-ledger', public_id: publicId, timestamp, type: 'authenticated' },
    acct.secret,
  );
  const form = new FormData();
  form.append('file', `data:${mimetype || 'application/octet-stream'};base64,${buffer.toString('base64')}`);
  form.append('folder', 'market-ledger');
  form.append('public_id', publicId);
  form.append('type', 'authenticated');
  form.append('timestamp', String(timestamp));
  form.append('api_key', acct.key);
  form.append('signature', signature);
  const r = await fetchImpl(`https://api.cloudinary.com/v1_1/${acct.cloud}/auto/upload`, { method: 'POST', body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.secure_url) {
    throw new Error((j.error && j.error.message) || `cloudinary upload failed (HTTP ${r.status})`);
  }
  return j.secure_url;
}

// uploadMedia(buffer, mimetype, { username }) -> secure_url, with pick +
// failover. The portal pick is per-customer: with a username it returns that
// customer's HOME account (their files normally live in one account; the rest
// are failover only). pickCloud: async (username|null) => cloud-name | null
// (null/throw = no pick this time). Only a successful pick is cached
// (pickCacheMs, keyed per username); a failed pick just means "start at
// account 1" for that call and is retried on the next upload.
export function createCloudinaryUploader({ accounts, pickCloud = null, fetchImpl = fetch, pickCacheMs = 5 * 60 * 1000, now = Date.now } = {}) {
  const picks = new Map(); // username|'' -> { cloud, at }
  async function startIndex(username) {
    if (!pickCloud || !accounts.length) return 0;
    const key = username || '';
    const cached = picks.get(key);
    if (cached && cached.cloud && now() - cached.at < pickCacheMs) {
      const i = accounts.findIndex((a) => a.cloud === cached.cloud);
      return i >= 0 ? i : 0;
    }
    try {
      const cloud = await pickCloud(username || null);
      if (cloud) {
        picks.set(key, { cloud, at: now() });
        const i = accounts.findIndex((a) => a.cloud === cloud);
        return i >= 0 ? i : 0; // picked cloud not in our env list → account 1
      }
    } catch { /* portal pick unavailable — local order */ }
    return 0;
  }
  async function uploadMedia(buffer, mimetype, opts = {}) {
    if (!accounts.length) throw new Error('cloudinary upload failed: no Cloudinary account is configured');
    const start = await startIndex(opts.username || null);
    let lastErr = null;
    for (let n = 0; n < accounts.length; n++) {
      const acct = accounts[(start + n) % accounts.length];
      try {
        return await uploadToAccount(acct, buffer, mimetype, fetchImpl);
      } catch (e) {
        lastErr = e;
        console.error(`cloudinary upload fail (${acct.cloud}):`, e.message);
      }
    }
    throw lastErr || new Error('cloudinary upload failed');
  }
  return { uploadMedia };
}
