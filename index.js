// Market Ledger WhatsApp Bot — watches a WhatsApp GROUP for bill photos.
// Caption format: "<party name> sales|receipt <amount>"  e.g. "Ahmed Traders sales 50000"
// Validates the party against the Market Ledger portal, creates the entry,
// and replies with a formatted bill card (photo + party + amount + balance).

import makeWASocket, {
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers,
  isJidBroadcast,
} from '@whiskeysockets/baileys';
import express from 'express';
import pino from 'pino';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Boom } from '@hapi/boom';
import { v2 as cloudinary } from 'cloudinary';
import { parseCaption, formatRs, USAGE_TEXT } from './parser.js';
import { createLedgerClient, createUserLedgerClient } from './ledger.js';
import { parseActivateCommand } from './botcmd.js';
import { createConvoStore, STEPS, parseAmountAndDescription, parseSelection, parseDateInput, formatPartyList, CANCEL_WORDS } from './convo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const LEDGER_URL = (process.env.LEDGER_URL || 'https://market-ledger-vault.pages.dev').replace(/\/+$/, '');
const LEDGER_PASSWORD = process.env.LEDGER_PASSWORD || '';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
});

if (!LEDGER_PASSWORD) console.warn('⚠️ LEDGER_PASSWORD not set — bot cannot talk to the ledger');

const ledger = createLedgerClient({ baseUrl: LEDGER_URL, password: LEDGER_PASSWORD });

// ─── Group bindings: WhatsApp group JID -> customer ledger ───
// A group is bound with `activate <user-id> <password>` (typed in the group).
// One user ID = one group (enforced server-side). Bills in a bound group are
// created with that user's token, so entries land in THEIR ledger only.
// Unbound groups are completely silent (except the activate command).
// The bot never stores user passwords — tokens are minted via /api/bot-groups/token.
const groupBindings = new Map(); // jid -> { client, username, name }

// A ledger client acting as `username`, with tokens minted by the backend
// (admin-authorized). Auto-refreshes on expiry; survives bot restarts.
function userClientFor(username) {
  return createLedgerClient({
    baseUrl: LEDGER_URL,
    loginFn: async () => {
      const t = await ledger.ensureToken();
      const r = await fetch(`${LEDGER_URL}/api/bot-groups/token?password=${encodeURIComponent(t)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok || !j.token) throw new Error(j.error || 'user token failed');
      return j.token;
    },
  });
}

// Load/refresh bindings from the portal (admin API). Keeps existing clients.
async function refreshGroupBindings() {
  try {
    const t = await ledger.ensureToken();
    const r = await fetch(`${LEDGER_URL}/api/bot-groups?password=${encodeURIComponent(t)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray(j.groups)) throw new Error(j.error || 'groups fetch failed');
    const next = new Map();
    for (const g of j.groups) {
      const prev = groupBindings.get(g.jid);
      if (prev && prev.username === g.username) next.set(g.jid, prev);
      else next.set(g.jid, { client: userClientFor(g.username), username: g.username, name: g.name || '' });
    }
    groupBindings.clear();
    for (const [k, v] of next) groupBindings.set(k, v);
    console.log(`📋 group bindings refreshed: ${groupBindings.size} active`);
  } catch (e) {
    console.error('refreshGroupBindings fail:', e.message);
  }
}

const logger = pino({ level: 'silent' });
function makeSimpleCache(ttlSec = 0) {
  const map = new Map();
  return {
    get: (k) => map.get(k),
    set: (k, v) => { map.set(k, v); if (ttlSec) setTimeout(() => map.delete(k), ttlSec * 1000); },
    del: (k) => map.delete(k),
    keys: () => [...map.keys()],
  };
}
const msgRetryCounterCache = makeSimpleCache();
const messageStore = new Map();
const handledIds = new Set(); // processed message ids (dedup across redelivery)
const convos = createConvoStore(); // step-by-step bill entry sessions, one per sender
const groupSubjectCache = makeSimpleCache(5 * 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let qrString = null;
let sock = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT = 50;

// ─── Express: dashboard + QR + health ───
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Market Ledger Bot</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,-apple-system,sans-serif;background:#fafafa;min-height:100vh;display:grid;place-items:center;padding:16px}
.card{max-width:520px;width:100%;background:#fff;border:1px solid #e4e4e7;border-radius:24px;padding:32px;box-shadow:0 8px 32px rgba(0,0,0,.06)}
h1{font-size:20px;font-weight:800;letter-spacing:-.02em}
.sub{font-size:12px;color:#71717a;margin-top:4px;font-family:monospace;word-break:break-all}
.qr-box{margin:20px 0;min-height:280px;border-radius:16px;background:#fafafa;border:1.5px dashed #d4d4d8;display:grid;place-items:center;padding:16px;text-align:center}
.qr-box img{width:240px;height:240px;border-radius:12px;border:1px solid #e4e4e7}
.ok{color:#16a34a;font-weight:700;font-size:15px}.wait{color:#a1a1aa;font-size:13px}
.stat{margin-top:12px;padding:12px;border-radius:12px;background:#fafafa;border:1px solid #f0f0f0;font-size:12px;color:#52525b;line-height:1.7;font-family:monospace;white-space:pre-wrap}</style></head>
<body><div class="card">
<h1>Market Ledger WhatsApp Bot</h1>
<div class="sub">Ledger: ${LEDGER_URL}<br>Active groups: <span id="gCount">—</span></div>
<div class="qr-box" id="qrBox"><span class="wait">Loading...</span></div>
<div class="stat" id="stBox">—</div>
</div>
<script>
async function poll(){try{const r=await fetch('/qr');const j=await r.json();
let s='Status: '+(j.connected?'Connected ✅':'Disconnected ❌')+'\\nActive groups: '+(j.groups??'—');
document.getElementById('stBox').textContent=s;
if(j.qr){document.getElementById('qrBox').innerHTML='<img src="'+j.qr+'">'}
else if(j.connected){document.getElementById('qrBox').innerHTML='<span class="ok">✅ Connected — send a bill photo or PDF in the group and follow the steps</span>'}
else{document.getElementById('qrBox').innerHTML='<span class="wait">Waiting for QR — scan with WhatsApp</span>'}}catch(e){}}
poll();setInterval(poll,3000);
</script></body></html>`);
});

app.get('/qr', async (req, res) => {
  let qrDataUrl = null;
  if (qrString) { try { qrDataUrl = await QRCode.toDataURL(qrString); } catch {} }
  res.json({ qr: qrDataUrl, connected: isConnected, groups: groupBindings.size });
});

app.get('/health', (req, res) => res.json({ ok: true, connected: isConnected, groups: groupBindings.size, version: '2.8.0' }));

// ─── Helpers ───
function msgKeyId(key) { return `${key.remoteJid}:${key.id}`; }

function unwrapMsg(m) {
  let cur = m;
  for (let i = 0; i < 5; i++) {
    if (!cur) break;
    if (cur.ephemeralMessage) cur = cur.ephemeralMessage.message;
    else if (cur.viewOnceMessage) cur = cur.viewOnceMessage.message;
    else if (cur.viewOnceMessageV2) cur = cur.viewOnceMessageV2.message;
    else if (cur.viewOnceMessageV2Extension) cur = cur.viewOnceMessageV2Extension.message;
    else if (cur.documentWithCaptionMessage) cur = cur.documentWithCaptionMessage.message;
    else break;
  }
  return cur || m;
}

async function groupSubject(jid) {
  const c = groupSubjectCache.get(jid);
  if (c) return c;
  try {
    const md = await sock.groupMetadata(jid);
    groupSubjectCache.set(jid, md.subject || '');
    return md.subject || '';
  } catch {
    return '';
  }
}

async function sendText(groupJid, text, quoted) {
  await sock.sendMessage(groupJid, { text }, quoted ? { quoted } : undefined);
}

// Receipt attachments: the /api/receipts endpoint has no file field, so the bot
// uploads the bill file to Cloudinary (folder market-ledger/) itself and appends
// the URL to the receipt description. Works for images and PDFs.
async function uploadMedia(buffer, mimetype, partyName, kind) {
  const dataUri = `data:${mimetype || 'application/octet-stream'};base64,${buffer.toString('base64')}`;
  const safe = String(partyName || 'party').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30) || 'party';
  const prefix = kind === 'pdf' ? 'receiptpdf' : 'receipt';
  const up = await cloudinary.uploader.upload(dataUri, {
    folder: 'market-ledger',
    public_id: `${prefix}_${safe}_${Date.now()}`,
    resource_type: 'auto',
  });
  return up.secure_url || '';
}

// Pakistan date (YYYY-MM-DD) — Render runs on UTC, so don't use UTC date directly.
function todayPK() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// ─── DM promo reply (no functionality in personal chat) ───
const PROMO_TEXT = (
  '🤖 *Live Tech — Automation & Software*\n\n' +
  'Hello! I am a WhatsApp automation bot.\n\n' +
  'We build automation and custom software for businesses — ' +
  'WhatsApp bots, ledger systems and much more.\n\n' +
  '📞 Contact: 0317-3291218'
);

async function deleteMessage(jid, key) {
  try {
    await sock.sendMessage(jid, { delete: key });
    return true;
  } catch (e) {
    console.error('deleteMessage fail:', e.message);
    return false;
  }
}

// ─── Group activation: `activate <user-id> <password>` ───
// Binds this WhatsApp group (by unique JID) to a user ID — one user ID = one
// group (enforced server-side). The password message is deleted right away so
// it doesn't stay visible in the chat. The password itself is never stored.
async function handleActivate({ remoteJid, msg, username, password }) {
  // best-effort: bot group admin ho to ye message delete ho jayega, warna nahi
  await deleteMessage(remoteJid, msg.key);
  const check = createUserLedgerClient({ baseUrl: LEDGER_URL, username, password });
  try {
    await check.ensureToken();
  } catch (e) {
    console.log(`🔐 activate: credential check failed for "${username}" (status=${e.status || '?'})`);
    if (e.status === 401) await sendText(remoteJid, '❌ Wrong user ID or password.', msg);
    else if (e.status === 403) await sendText(remoteJid, '⛔ This account is blocked. Contact the admin.', msg);
    else if (e.status === 429) await sendText(remoteJid, '⏳ Too many attempts — try again in a bit.', msg);
    else await sendText(remoteJid, `❌ Could not activate: ${e.message || 'unknown error'}`, msg);
    return;
  }
  let subject = '';
  try { subject = await groupSubject(remoteJid); } catch {}
  try {
    const t = await ledger.ensureToken();
    const r = await fetch(`${LEDGER_URL}/api/bot-groups?password=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid: remoteJid, name: subject, username }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      if (r.status === 409) {
        await sendText(remoteJid, '❌ This ID is already active in another group.\nOne ID works in only one group.', msg);
      } else {
        await sendText(remoteJid, `❌ Could not activate: ${j.error || 'unknown error'}`, msg);
      }
      return;
    }
  } catch (e) {
    console.error('activate bind fail:', e.message);
    await sendText(remoteJid, `❌ Could not activate: ${e.message}`, msg);
    return;
  }
  groupBindings.set(remoteJid, { client: userClientFor(username), username, name: subject });
  console.log(`✅ group activated: "${subject}" -> ${username}`);
  await sendText(
    remoteJid,
    `✅ *Activated!*\n👤 User: *${username}*\nBills in this group will now go to *your ledger*.\n\n🔒 Delete your activate message yourself (long press → delete) so no one sees your password.`,
    msg
  );
}

// ─── Core: create the ledger entry (file buffer already in hand) ───
// media: { kind: 'image'|'pdf', mimetype, filename }
// Returns { ok:true, id, type, partyName, amount } on success, { ok:false } otherwise.
// lastEntries: senderKey -> last bot-created entry (for the "undo" command, 30 min TTL).
const lastEntries = new Map();
const UNDO_TTL_MS = 30 * 60 * 1000;
// senderKey -> bills waiting their turn (one active bill per sender at a time)
const mediaQueues = new Map();
const MAX_QUEUE = 10;
async function processBill(groupJid, msg, parsed, buffer, media, description, entryDate, client) {
  const kind = media?.kind || 'image';
  const mimetype = media?.mimetype || 'image/jpeg';
  const filename = media?.filename || `bill_${Date.now()}.jpg`;
  const date = entryDate || todayPK();
  const desc = String(description || '').trim() || 'Added via WhatsApp';
  const L = client; // this group's bound customer ledger
  let parties;
  try {
    parties = await L.getParties();
  } catch (e) {
    console.error('getParties fail:', e.message);
    await sendText(groupJid, '❌ Could not connect to the portal. Retry in a bit.', msg);
    return { ok: false };
  }

  const party = L.findParty(parties, parsed.partyName);
  if (!party) {
    await sendText(
      groupJid,
      `⚠️ Party "*${parsed.partyName}*" is not in the portal. Add it in the portal first: ${LEDGER_URL}/`,
      msg
    );
    return { ok: false };
  }

  try {
    let entryId = null;
    let photoFailed = false; // receipt: bill photo Cloudinary upload failed (entry still saved)
    if (parsed.type === 'sale' || parsed.type === 'purchase' || parsed.type === 'payment') {
      const createFn = parsed.type === 'sale' ? L.createSale : parsed.type === 'purchase' ? L.createPurchase : L.createPayment;
      const res = await createFn({
        partyId: party.id,
        amount: parsed.amount,
        date,
        description: desc,
        photoBuffer: buffer,
        filename,
        mimetype,
      });
      entryId = res && res.id != null ? res.id : null;
    } else {
      let photoUrl = '';
      try {
        photoUrl = await uploadMedia(buffer, mimetype, party.name, kind);
      } catch (e) {
        photoFailed = true;
        console.error('receipt file upload fail:', e.message);
      }
      const res = await L.createReceipt({
        partyId: party.id,
        amount: parsed.amount,
        date,
        description: desc + (photoUrl ? ` | Photo: ${photoUrl}` : ''),
      });
      entryId = res && res.id != null ? res.id : null;
    }

    const balance = await L.getBalance(party.id).catch(() => null);
    const title = parsed.type === 'sale' ? '✅ *Sale Recorded*' : parsed.type === 'purchase' ? '✅ *Purchase Recorded*' : parsed.type === 'payment' ? '✅ *Payment Recorded*' : '✅ *Receipt Recorded*';
    const lines = [title, `🏪 Party: ${party.name}`, `💰 Amount: ${formatRs(parsed.amount)}`];
    if (desc !== 'Added via WhatsApp') lines.push(`📝 ${desc}`);
    if (date !== todayPK()) lines.push(`📅 Date: ${date}`);
    if (photoFailed) {
      lines.push('⚠️ Bill photo upload failed (Cloudinary) — entry was still saved.');
    }
    if (balance !== null) lines.push(`📊 Balance: ${formatRs(balance)}`);
    const caption = lines.join('\n');
    if (kind === 'pdf') {
      await sock.sendMessage(
        groupJid,
        { document: buffer, mimetype: 'application/pdf', fileName: filename, caption },
        { quoted: msg }
      );
    } else {
      await sock.sendMessage(groupJid, { image: buffer, caption }, { quoted: msg });
    }
    console.log(`✅ ${parsed.type} recorded: ${party.name} ${parsed.amount} (${kind}) date=${date} id=${entryId}`);
    return { ok: true, id: entryId, type: parsed.type, partyName: party.name, amount: parsed.amount };
  } catch (e) {
    console.error('entry failed:', e.message);
    const errText = e.message || '';
    if (/rate limit|too many requests|429/i.test(errText)) {
      // Cloudinary throttling: sale needs its bill photo, so nothing was saved.
      await sendText(
        groupJid,
        '⏳ *Cloudinary rate limit hit* — photo not uploaded, *entry NOT saved*.\nSend the bill again in 5-10 min.',
        msg
      );
    } else {
      await sendText(groupJid, `❌ Could not save entry: ${errText}`, msg);
    }
    return { ok: false };
  }
}

// Remember a bot-created entry so "undo" can delete it (30 min window).
function trackLastEntry(senderKey, res) {
  if (res && res.ok && res.id != null) {
    lastEntries.set(senderKey, { ...res, at: Date.now() });
  }
}

// ─── Baileys socket (proven pattern from live-tech bot) ───
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth_info'));
  const { version } = await fetchLatestBaileysVersion();
  console.log(`📦 Baileys version: ${version.join('.')}`);

  sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: Browsers.macOS('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    generateHighQualityLinkPreview: false,
    msgRetryCounterCache,
    maxMsgRetryCount: 5,
    connectTimeoutMs: 30000,
    keepAliveIntervalMs: 30000,
    defaultQueryTimeoutMs: 60000,
    retryRequestDelayMs: 250,
    shouldIgnoreJid: (jid) => isJidBroadcast(jid),
    getMessage: async (key) => messageStore.get(msgKeyId(key))?.message ?? undefined,
    cachedGroupMetadata: async (jid) => groupSubjectCache.get(jid) || undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('groups.update', async ([event]) => {
    try {
      const md = await sock.groupMetadata(event.id);
      groupSubjectCache.set(event.id, md.subject || '');
    } catch {}
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    console.log('🔌 connection.update:', JSON.stringify({ connection, hasQr: !!qr, code: lastDisconnect?.error?.output?.statusCode }));
    if (qr) { qrString = qr; reconnectAttempts = 0; }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output.statusCode : lastDisconnect?.error?.output?.statusCode);
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      isConnected = false;
      if (loggedOut) {
        qrString = null;
        try { fs.rmSync(path.join(__dirname, 'auth_info'), { recursive: true, force: true }); } catch {}
        console.log('🔴 Logged out — deleted auth_info, need new QR');
      } else {
        if (reconnectAttempts >= MAX_RECONNECT) {
          console.log('⛔ Max reconnect reached, waiting for manual restart');
          return;
        }
        reconnectAttempts++;
        const delay = Math.min(reconnectAttempts * 2000, 30000);
        console.log(`🔄 Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts}) code=${statusCode}`);
        setTimeout(startBot, delay);
      }
    } else if (connection === 'open') {
      isConnected = true;
      reconnectAttempts = 0;
      qrString = null;
      console.log('✅ Connected — id:', sock.user?.id);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      if (msg.key?.id) messageStore.set(msgKeyId(msg.key), msg);
      if (messageStore.size > 500) {
        const firstKey = messageStore.keys().next().value;
        messageStore.delete(firstKey);
      }
    }
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;
        if (isJidBroadcast(msg.key.remoteJid)) continue;
        const remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');
        const isDM = !isGroup && String(remoteJid || '').endsWith('@s.whatsapp.net');
        if (!isGroup && !isDM) continue;
        if (handledIds.has(msg.key.id)) continue;

        const inner = unwrapMsg(msg.message);
        const img = inner.imageMessage;
        const doc = inner.documentMessage;
        const text = String(inner.conversation || inner.extendedTextMessage?.text || '').trim();
        const senderKey = msg.key.participant || msg.pushName || remoteJid;

        // ── DMs: promo reply only, no functionality ──
        if (isDM) {
          handledIds.add(msg.key.id);
          await sendText(remoteJid, PROMO_TEXT, msg);
          continue;
        }

        // ── groups: only bound (activated) groups work ──
        const binding = groupBindings.get(remoteJid);
        if (!binding) {
          const act = parseActivateCommand(text);
          if (act) {
            handledIds.add(msg.key.id);
            if (act.usage) {
              await sendText(remoteJid, 'To activate, type:\n`activate <user-id> <password>`', msg);
            } else {
              await handleActivate({ remoteJid, msg, username: act.username, password: act.password });
            }
          }
          continue; // unbound group: silent
        }
        const client = binding.client; // this group's customer ledger

        // bill media = photo, or a PDF document
        const docMime = String(doc?.mimetype || '').toLowerCase();
        const isPdf = !!doc && (docMime === 'application/pdf' || /\.pdf$/i.test(doc.fileName || ''));
        if (doc && !isPdf) {
          handledIds.add(msg.key.id);
          await sendText(remoteJid, '❌ Send only a *photo* or *PDF*. Other files are not supported.', msg);
          continue;
        }
        const media = img
          ? { kind: 'image', caption: String(img.caption || '').trim(), mimetype: img.mimetype || 'image/jpeg', filename: `bill_${Date.now()}.jpg` }
          : isPdf
            ? { kind: 'pdf', caption: String(doc.caption || '').trim(), mimetype: 'application/pdf', filename: doc.fileName || `bill_${Date.now()}.pdf` }
            : null;
        if (!media && !text) continue; // nothing we handle here

        handledIds.add(msg.key.id);
        if (handledIds.size > 1000) {
          const first = handledIds.values().next().value;
          handledIds.delete(first);
        }

        // ── helper: fetch parties or bail out with an error message ──
        async function needParties() {
          try {
            return await client.getParties();
          } catch (e) {
            console.error('getParties fail:', e.message);
            await sendText(remoteJid, '❌ Could not connect to the portal. Retry in a bit.', msg);
            return null;
          }
        }

        // ── helper: duplicate detection (same party + type + amount + date, last 3h) ──
        async function findDuplicate(partyId, entryType, amount, entryDate) {
          try {
            const recent = await client.getRecentEntries(partyId, 180);
            return (
              recent.find(
                (e) =>
                  e.type === entryType &&
                  Math.abs(Number(e.amount) - amount) < 0.005 &&
                  String(e.date || '') === entryDate
              ) || null
            );
          } catch (e) {
            console.error('dup check fail:', e.message);
            return null; // never block entry creation on a failed check
          }
        }

        function dupPrompt(partyName, entryType, amount, entryDate) {
          const typeLabel = entryType === 'sale' ? '💰 Sales' : entryType === 'purchase' ? '🛒 Purchase' : entryType === 'payment' ? '💸 Payment' : '🧾 Receipt';
          return (
            `⚠️ *This entry may already be saved:*\n` +
            `🏪 Party: ${partyName}\n${typeLabel}: ${formatRs(amount)}\n📅 Date: ${entryDate}\n\n` +
            `Save anyway? *yes* / *no*`
          );
        }

        // ── helper: create the entry from a finished session and track it for undo ──
        async function finalizeEntry(s) {
          convos.clear(senderKey);
          const parsed = { ok: true, partyName: s.partyName, type: s.entryType, amount: s.amount };
          console.log(
            `👉 creating ${s.entryType}: ${s.partyName} ${s.amount} date=${s.entryDate}` +
              (s.description ? ` desc=${s.description.slice(0, 40)}` : '')
          );
          const res = await processBill(remoteJid, msg, parsed, s.media.buffer, s.media, s.description, s.entryDate, client);
          trackLastEntry(senderKey, res);
          await advanceQueue(); // start the next queued bill, if any
        }

        function partyListPrompt(parties) {
          const shown = parties.slice(0, 50);
          const extra = parties.length > 50 ? `\n…plus ${parties.length - 50} more parties (showing first 50)` : '';
          return `🏪 Select a party — send the *number*:\n${formatPartyList(shown)}${extra}\n\n❌ Type "cancel" to cancel`;
        }

        // ── bill queue: one active bill per sender, the rest wait their turn ──
        function getBillQueue() {
          let q = mediaQueues.get(senderKey);
          if (!q) { q = []; mediaQueues.set(senderKey, q); }
          return q;
        }

        // start the flow for one bill: caption shortcut (instant) or step-by-step
        async function startBillFlow(item) {
          const parsed = parseCaption(item.caption);
          convos.clear(senderKey);
          if (parsed.ok) {
            // shortcut: "<party> sales|receipt <amount>" caption still works instantly
            console.log(`📩 bill ${item.kind} in "${binding.name}": caption="${item.caption.slice(0, 80)}"`);
            const parties = await needParties();
            const today = todayPK();
            const party = parties ? client.findParty(parties, parsed.partyName) : null;
            const dup = party ? await findDuplicate(party.id, parsed.type, parsed.amount, today) : null;
            if (dup) {
              // duplicate suspected → ask instead of creating instantly
              convos.start(senderKey, { buffer: item.buffer, mimetype: item.mimetype, filename: item.filename, kind: item.kind });
              convos.setStep(senderKey, STEPS.CONFIRM, {
                partyId: party.id, partyName: party.name, entryType: parsed.type,
                amount: parsed.amount, description: '', entryDate: today, dup: true,
              });
              console.log(`⚠️ duplicate suspected (caption shortcut): ${party.name} ${parsed.amount}`);
              await sendText(remoteJid, dupPrompt(party.name, parsed.type, parsed.amount, today), msg);
            } else {
              const res = await processBill(remoteJid, msg, parsed, item.buffer, item, undefined, undefined, client);
              trackLastEntry(senderKey, res);
            }
            return;
          }
          // step-by-step flow: ask for the party first
          const parties = await needParties();
          if (!parties) { return; }
          if (!parties.length) {
            await sendText(remoteJid, `⚠️ No parties in the portal yet. Add a party in the portal first: ${LEDGER_URL}/`, msg);
            return;
          }
          convos.start(senderKey, { buffer: item.buffer, mimetype: item.mimetype, filename: item.filename, kind: item.kind });
          const label = item.kind === 'pdf' ? 'PDF' : 'Photo';
          console.log(`📩 bill ${item.kind} in "${binding.name}" — asking party`);
          await sendText(remoteJid, `📸 ${label} received!\n\n${partyListPrompt(parties)}`, msg);
        }

        // after an entry finishes, start the next queued bill (if any)
        async function advanceQueue() {
          if (convos.get(senderKey)) return; // still busy with a bill
          const q = mediaQueues.get(senderKey);
          if (!q || !q.length) return;
          const next = q.shift();
          if (!q.length) mediaQueues.delete(senderKey);
          console.log(`📸 starting queued bill (${q.length} left in queue)`);
          await startBillFlow(next);
        }

        if (media) {
          // ── a bill photo/PDF arrived ──
          let buffer;
          try {
            buffer = await downloadMediaMessage(msg, 'buffer', {});
          } catch (e) {
            console.error('download fail:', e.message);
            await sendText(remoteJid, '❌ File download failed. Send it again.', msg);
            continue;
          }
          const item = { buffer, mimetype: media.mimetype, filename: media.filename, kind: media.kind, caption: media.caption };
          if (convos.get(senderKey)) {
            // busy with another bill → queue this one, it starts automatically later
            const q = getBillQueue();
            if (q.length >= MAX_QUEUE) {
              await sendText(remoteJid, `⚠️ Queue is full (${MAX_QUEUE} bills). Let the first entries finish, then send.`, msg);
              continue;
            }
            q.push(item);
            console.log(`📸 bill queued at #${q.length}`);
            await sendText(remoteJid, `📸 Bill received — queued (#${q.length}).\nI will ask about it as soon as the first entry is done 👆`, msg);
            continue;
          }
          const waiting = mediaQueues.get(senderKey);
          if (waiting && waiting.length) {
            // no active session but bills waiting (old session expired) → oldest first
            waiting.push(item);
            const next = waiting.shift();
            await startBillFlow(next);
            continue;
          }
          await startBillFlow(item);
          continue;
        }

        // ── "undo": delete the last entry this bot created for this sender (30 min window) ──
        if (['undo', 'undo karo'].includes(text.toLowerCase().trim()) && !convos.get(senderKey)) {
          const last = lastEntries.get(senderKey);
          if (!last || Date.now() - last.at > UNDO_TTL_MS) {
            await sendText(remoteJid, '❓ No recent entry found to undo.\n(Only entries made by the bot in the last 30 min can be undone.)', msg);
            continue;
          }
          try {
            await client.deleteEntry(last.type, last.id);
            lastEntries.delete(senderKey);
            const typeLabel = last.type === 'sale' ? 'Sales' : last.type === 'purchase' ? 'Purchase' : last.type === 'payment' ? 'Payment' : 'Receipt';
            await sendText(remoteJid, `🗑️ *Entry deleted:*\n🏪 ${last.partyName}\n💰 ${formatRs(last.amount)} (${typeLabel})`, msg);
            console.log(`↩️ undo: deleted ${last.type} #${last.id} (${last.partyName} ${last.amount})`);
          } catch (e) {
            console.error('undo fail:', e.message);
            await sendText(remoteJid, `❌ Could not delete: ${e.message}`, msg);
          }
          continue;
        }

        // ── a text message arrived: part of an active step-by-step session? ──
        const sess = convos.get(senderKey);
        if (!sess) continue; // no session → stay silent (old caption-only texts are ignored now)

        const low = text.toLowerCase().trim();
        if (low === 'cancel all' || low === 'cancel queue') {
          convos.clear(senderKey);
          mediaQueues.delete(senderKey);
          await sendText(remoteJid, '❌ Everything cancelled — queue cleared too.', msg);
          continue;
        }
        if (CANCEL_WORDS.has(low)) {
          convos.clear(senderKey);
          const left = mediaQueues.get(senderKey)?.length || 0;
          await sendText(
            remoteJid,
            left ? `❌ This bill is cancelled. Starting the next bill in the queue…` : '❌ Cancelled. Send a photo/PDF again for a new bill.',
            msg
          );
          await advanceQueue();
          continue;
        }

        if (sess.step === STEPS.PARTY) {
          // accept a number, or a full old-style caption as a shortcut
          const shortcut = parseCaption(text);
          if (shortcut.ok) {
            const s = convos.get(senderKey);
            const parties = await needParties();
            const today = todayPK();
            const party = parties ? client.findParty(parties, shortcut.partyName) : null;
            const dup = party ? await findDuplicate(party.id, shortcut.type, shortcut.amount, today) : null;
            if (dup) {
              convos.setStep(senderKey, STEPS.CONFIRM, {
                partyId: party.id, partyName: party.name, entryType: shortcut.type,
                amount: shortcut.amount, description: '', entryDate: today, dup: true,
              });
              console.log(`📩 caption shortcut in "${subject}": "${text.slice(0, 80)}" — duplicate suspected`);
              await sendText(remoteJid, dupPrompt(party.name, shortcut.type, shortcut.amount, today), msg);
            } else {
              convos.clear(senderKey);
              console.log(`📩 caption shortcut in "${subject}": "${text.slice(0, 80)}"`);
              const res = await processBill(remoteJid, msg, shortcut, s.media.buffer, s.media, undefined, undefined, client);
              trackLastEntry(senderKey, res);
            }
            continue;
          }
          const parties = await needParties();
          if (!parties) { convos.clear(senderKey); continue; }
          const n = parseSelection(text, Math.min(parties.length, 50));
          if (!n) {
            await sendText(remoteJid, `❌ Send a number from 1 to ${Math.min(parties.length, 50)}.\n\n${partyListPrompt(parties)}`, msg);
            continue;
          }
          const party = parties[n - 1];
          convos.setStep(senderKey, STEPS.TYPE, { partyId: party.id, partyName: party.name });
          console.log(`👉 party chosen: ${party.name}`);
          await sendText(remoteJid, `🏪 Party: *${party.name}*\n\nSelect entry type:\n1. 💰 Sales\n2. 🧾 Receipt\n3. 🛒 Purchase\n4. 💸 Payment\n\n❌ Type "cancel" to cancel`, msg);
          continue;
        }

        if (sess.step === STEPS.TYPE) {
          let entryType = null;
          if (low === '1' || low === 'sales' || low === 'sale') entryType = 'sale';
          else if (low === '2' || low === 'receipt' || low === 'receipts') entryType = 'receipt';
          else if (low === '3' || low === 'purchase' || low === 'purchases' || low === 'kharid') entryType = 'purchase';
          else if (low === '4' || low === 'payment' || low === 'payments' || low === 'adaigi' || low === 'paid to') entryType = 'payment';
          if (!entryType) {
            await sendText(remoteJid, '❌ Send 1=Sales, 2=Receipt, 3=Purchase, 4=Payment.', msg);
            continue;
          }
          convos.setStep(senderKey, STEPS.AMOUNT, { entryType });
          const label = entryType === 'sale' ? '💰 Sales' : entryType === 'purchase' ? '🛒 Purchase' : entryType === 'payment' ? '💸 Payment' : '🧾 Receipt';
          console.log(`👉 type chosen: ${entryType}`);
          await sendText(remoteJid, `✅ ${label}\n\n🔢 Now send the *amount* (e.g. 5000):\n\n❌ Type "cancel" to cancel`, msg);
          continue;
        }

        if (sess.step === STEPS.AMOUNT) {
          const { amount, description } = parseAmountAndDescription(text);
          if (amount === null) {
            await sendText(remoteJid, '❌ Enter a valid amount (e.g. 50000).', msg);
            continue;
          }
          if (description) {
            // amount ke saath description bhi bhej di — seedha date pe jao
            convos.setStep(senderKey, STEPS.DATE, { amount, description });
            console.log(`👉 amount entered: ${amount} | desc: ${description.slice(0, 40)} — asking date`);
            await sendText(
              remoteJid,
              `✅ Amount: ${formatRs(amount)}\n📝 ${description}\n\n📅 What is the bill *date*?\nType *today*, or a custom date (e.g. 28-09-2026):\n\n❌ Type "cancel" to cancel`,
              msg
            );
            continue;
          }
          convos.setStep(senderKey, STEPS.DESCRIPTION, { amount });
          console.log(`👉 amount entered: ${amount} — asking description`);
          await sendText(
            remoteJid,
            `✅ Amount: ${formatRs(amount)}\n\n📝 Now write a *description* (optional):\n\nType "skip" to skip.\n\n❌ Type "cancel" to cancel`,
            msg
          );
          continue;
        }

        if (sess.step === STEPS.DESCRIPTION) {
          const skipWords = new Set(['skip', '-', 'nahi', 'nahin', 'no', 'n']);
          const description = skipWords.has(text.trim().toLowerCase()) ? '' : text.trim().slice(0, 500);
          convos.setStep(senderKey, STEPS.DATE, { description });
          const s = convos.get(senderKey);
          console.log(`👉 description entered: ${description ? description.slice(0, 40) : '(skipped)'} — asking date`);
          await sendText(
            remoteJid,
            `✅ Amount: ${formatRs(s.amount)}${description ? `\n📝 ${description}` : ''}\n\n📅 What is the bill *date*?\nType *today*, or a custom date (e.g. 28-09-2026):\n\n❌ Type "cancel" to cancel`,
            msg
          );
          continue;
        }

        if (sess.step === STEPS.DATE) {
          const s = convos.get(senderKey);
          const entryDate = parseDateInput(text, todayPK());
          if (!entryDate) {
            await sendText(remoteJid, '❌ Enter a valid date: type *today*, or a custom date (e.g. 28-09-2026 or 2026-09-28).', msg);
            continue;
          }
          const dup = await findDuplicate(s.partyId, s.entryType, s.amount, entryDate);
          if (dup) {
            convos.setStep(senderKey, STEPS.CONFIRM, { entryDate, dup: true });
            console.log(`⚠️ duplicate suspected: ${s.partyName} ${s.amount} date=${entryDate}`);
            await sendText(remoteJid, dupPrompt(s.partyName, s.entryType, s.amount, entryDate), msg);
            continue;
          }
          s.entryDate = entryDate;
          await finalizeEntry(s);
          continue;
        }

        if (sess.step === STEPS.CONFIRM) {
          const s = convos.get(senderKey);
          if (['haan', 'ha', 'yes', 'y', '1'].includes(low)) {
            console.log('👉 duplicate confirmed by user — creating anyway');
            await finalizeEntry(s);
            continue;
          }
          if (['nahi', 'nahin', 'na', 'no', 'n', '2'].includes(low)) {
            convos.clear(senderKey);
            await sendText(remoteJid, '❌ OK, entry not saved.', msg);
            continue;
          }
          await sendText(remoteJid, '❓ Type *yes* to save, *no* to cancel.', msg);
          continue;
        }

        // unknown step (shouldn't happen) → reset
        convos.clear(senderKey);
        // 'empty' → no photo was waiting: ignore (existing behavior)
      } catch (e) {
        console.error('message handler error:', e.message);
      }
    }
  });
}

app.listen(PORT, () => {
  console.log(`🌐 Dashboard on :${PORT}`);
  refreshGroupBindings(); // load bound groups at startup…
  setInterval(refreshGroupBindings, 5 * 60 * 1000); // …and keep them fresh
  startBot().catch((e) => {
    console.error('startBot failed:', e.message);
    setTimeout(startBot, 5000);
  });
});
