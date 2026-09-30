# Market Ledger WhatsApp Bot

Watches a WhatsApp **group** for bill photos/PDFs. Send a bill photo or PDF and the
bot walks you through 3 quick steps — party, type (Sales/Receipt), amount — then
creates the entry in the [Market Ledger Vault](https://market-ledger-vault.pages.dev)
and replies with a formatted bill card.

## How it works (step-by-step)

1. 📸 **Bill ki photo ya PDF bhejo** (caption ki zaroorat nahi)
2. 🏪 Bot party list bhejega — **number** bhejo (misal: `2`)
3. 💰 Type select karo — `1` = Sales, `2` = Receipt
4. 🔢 **Amount** bhejo — chaaho to neeche **description** bhi likh do:
   ```
   5000
   Inv#0988 imran ali
   ```
5. 📅 **Bill ki date** bhejo — aaj ki hai to `aaj` likho, kal ki to `kal`, warna date (misal: `28-09-2026`)
6. ⚠️ Agar same party/type/amount/date ki entry akhri 3 ghante me ho chuki ho to bot poochega — *haan* likho phir bhi save karne ke liye, *nahi* likho cancel ke liye
7. ✅ Entry ban gayi — bill card wapas aayega (backdate ho to 📅 date bhi dikhegi)

**`undo`** — akhri 30 min me bot se bani entry delete karne ke liye `undo` likho (koi active session na ho).

**Shortcut** — photo/PDF ke caption me `<party> sales|receipt <amount>` likho to entry foran ban jati hai (aaj ki date, duplicate check ke saath).

Kisi bhi step par `cancel` likh do to session khatam. 10 minute me jawab na aaye
to session expire ho jati hai — photo/PDF dobara bhejo.

## Shortcut (caption format)

Photo ke **saath hi caption** likh do to steps skip ho jate hain:

```
<party name> <sales|receipt> <amount>
```

Examples:

- `Ahmed Traders sales 50000` → Sale of Rs 50,000 for Ahmed Traders
- `Ahmed Traders receipt 20000` → Receipt of Rs 20,000 for Ahmed Traders
- `ABC Co sales 12,500.50` → commas/decimals allowed
- Type keywords (case-insensitive): `sale`, `sales` → Sale · `receipt`, `receipts`, `payment`, `paid`, `received` → Receipt

Rules:

- The party name must **already exist** in the portal (case-insensitive exact match).
  If not, the bot replies: `⚠️ Party "*<name>*" portal me add nahi hai. Pehle portal me add karo: https://market-ledger-vault.pages.dev/` and creates nothing.
- On success the bot sends the photo back with a card:
  ```
  ✅ *Sale Recorded*
  🏪 Party: Ahmed Traders
  💰 Amount: Rs 50,000
  📊 Balance: Rs 30,000
  ```
- The bot only listens in the group named by `GROUP_NAME` (exact subject match).
  DMs, other groups, status broadcasts and its own messages are ignored.

## Setup (Render)

1. Push this folder to GitHub: `babyvoice64t/market-ledger-whatsapp-bot`
   (already created — push the code there).
2. On [Render](https://dashboard.render.com) → **New → Blueprint** → select the repo
   (or New → Web Service, build `npm ci`, start `npm start`).
3. Set these **Environment Variables** in the Render dashboard:

   | Key | Value |
   |---|---|
   | `LEDGER_URL` | `https://market-ledger-vault.pages.dev` |
   | `LEDGER_PASSWORD` | portal ka shared password |
   | `GROUP_NAME` | WhatsApp group ka **exact** naam (subject), misal `Market Ledger` |
   | `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name (receipt photos ke liye) |
   | `CLOUDINARY_API_KEY` | Cloudinary API key |
   | `CLOUDINARY_API_SECRET` | Cloudinary API secret |
   | `PORT` | Render khud set karta hai |

   `CLOUDINARY_*` wahi account hai jo Live Tech vault use karta hai
   (receipt ki photo bot khud `market-ledger/` folder me upload karta hai).

4. Deploy hone ke baad service ka URL kholo (misal
   `https://market-ledger-whatsapp-bot.onrender.com`) — QR code dikhega.
5. **Apne phone se** WhatsApp → Linked devices → Link a device → QR scan karo.
   Scan ke baad dashboard par "Connected ✅" aayega.

## WhatsApp group setup

1. WhatsApp par group banao (misal naam: `Market Ledger`).
2. Jis number se bot linked hai usay group me add karo.
3. `GROUP_NAME` env me **wahi exact naam** likho jo group ka subject hai.
4. Bill ki **photo ya PDF bhejo** aur bot ke 3 steps follow karo
   (party number → type → amount).

## Keep-alive

Render free plan idle par so jata hai. [UptimeRobot](https://uptimerobot.com) ya
[cron-job.org](https://cron-job.org) me har 10 minute me
`https://<tumhara-service>.onrender.com/health` ping karo taake bot online rahe.

## Run locally

```bash
cd ~/workspace/market-ledger-bot
npm ci
LEDGER_PASSWORD=dummy GROUP_NAME="Test Group" PORT=3000 npm start
# phir http://localhost:3000 kholo — QR scan karo
```

## Tests

```bash
npm test   # 41 tests: caption parser + ledger API client mocks + convo flow + date parser
```

## Files

- `index.js` — Baileys socket, group watcher, step-by-step bill flow, Express dashboard (`/`, `/qr`, `/health`)
- `convo.js` — conversation sessions (per-sender, 10-min TTL) + `parseAmount`/`parseSelection`/`formatPartyList` (unit-tested)
- `parser.js` — caption parser + `formatRs` (unit-tested)
- `ledger.js` — Market Ledger API client: login/token cache, parties lookup, sale/receipt create, balance (mock-tested, no real writes)
- `test/` — `parser.test.js`, `ledger.test.js`, `convo.test.js`
- `render.yaml` — Render Blueprint
- `.gitignore` — node_modules, auth_info (WhatsApp session), .env
