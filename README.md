# Market Ledger WhatsApp Bot

Watches a WhatsApp **group** for bill photos. Send a bill photo with a caption and the
bot creates the entry in the [Market Ledger Vault](https://market-ledger-vault.pages.dev)
and replies with a formatted bill card.

## Caption format

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
4. Bill ki photo **caption ke saath** bhejo: `Ahmed Traders sales 50000`.

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
npm test   # 23 tests: caption parser (15) + ledger API client mocks (8)
```

## Files

- `index.js` — Baileys socket, group watcher, bill handler, Express dashboard (`/`, `/qr`, `/health`)
- `parser.js` — caption parser + `formatRs` (unit-tested)
- `ledger.js` — Market Ledger API client: login/token cache, parties lookup, sale/receipt create, balance (mock-tested, no real writes)
- `test/` — `parser.test.js`, `ledger.test.js`
- `render.yaml` — Render Blueprint
- `.gitignore` — node_modules, auth_info (WhatsApp session), .env
