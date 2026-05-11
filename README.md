# ⚡ Sudden Death Chess

> One bad move. Game over.

Real-time multiplayer chess where a single blunder (≥200cp drop) ends the game instantly.
10 seconds per move. Live Elo rating. Reach 1600 to remove ads forever.

---

## 🚀 Deploy in 15 Minutes

### Step 1 — Download Stockfish & Chess.js

You need two JS files in `client/public/js/`:

**chess.js** (the chess logic library):
```
https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js
```
Download it and save as `client/public/js/chess.js`

**stockfish.js** (the engine — single-file version):
```
https://github.com/nmrugg/stockfish.js/raw/master/stockfish.js
```
Download and save as `client/public/js/stockfish.js`

---

### Step 2 — Push to GitHub

Open Terminal and run these commands from inside the `suddendeath` folder:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/sudden-death-chess.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.
(Create the repo on github.com first — click New Repository, name it `sudden-death-chess`, leave it empty)

---

### Step 3 — Deploy on Railway (free to start)

1. Go to **railway.app** and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your `sudden-death-chess` repo
4. Railway detects Node.js automatically and deploys

**Set environment variables in Railway:**
- Click your service → **Variables** tab
- Add: `JWT_SECRET` = (any long random string, e.g. `mySuperSecretKey12345abc`)

5. Click **Deploy** — it'll be live in ~2 minutes
6. Railway gives you a free URL like `https://sudden-death-chess.up.railway.app`

---

### Step 4 — Connect Your Domain

Once you've bought `suddendeathchess.com` on Namecheap:

1. In Railway: Settings → Domains → **Add Custom Domain**
2. Type `suddendeathchess.com` and click Add
3. Railway shows you a CNAME record (looks like: `sudden-death-chess.up.railway.app`)
4. In Namecheap: go to your domain → Advanced DNS → Add CNAME record:
   - Host: `@` or `www`
   - Value: the Railway URL
5. Wait 10-30 minutes for DNS to propagate
6. ✅ Your site is live at suddendeathchess.com

---

### Step 5 — Apply for Google AdSense

1. Go to **adsense.google.com**
2. Sign in with a Google account
3. Add your site: `suddendeathchess.com`
4. Copy the AdSense snippet they give you
5. In `client/public/index.html`, find this comment:
   ```html
   <!-- <script async src="https://pagead2.googlesyndication.com/...
   ```
   Uncomment it and replace `ca-pub-XXXXXXXXXXXXXXXX` with your Publisher ID
6. Wait 2-4 weeks for approval
7. Once approved, replace the `<div class="ad">AD</div>` placeholders with real AdSense units

---

## 🔧 Run Locally (for testing)

```bash
cd suddendeath
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000

---

## 📁 Project Structure

```
suddendeath/
├── server/
│   ├── index.js          ← Express + WebSocket server
│   ├── db.js             ← SQLite database + schema
│   ├── routes/
│   │   ├── auth.js       ← Register + Login
│   │   └── users.js      ← Profile + Leaderboard
│   └── game/
│       ├── matchmaker.js ← Real-time matchmaking + game logic
│       └── elo.js        ← Elo rating calculation
├── client/public/
│   ├── index.html        ← Full frontend UI
│   ├── css/main.css      ← All styles
│   └── js/
│       ├── app.js        ← Frontend app (WebSocket + Stockfish)
│       ├── chess.js      ← chess.js library (you download this)
│       └── stockfish.js  ← Stockfish engine (you download this)
├── package.json
├── railway.toml          ← Railway deployment config
├── .env.example          ← Environment variable template
└── .gitignore
```

---

## 💰 Monetization

**Ads:** Placed in 5 locations across the UI. Once AdSense approves you, replace placeholders.

**No-Ads Reward:** Any player who reaches **1600 Elo peak** gets ads removed permanently.
This is tracked in the database (`peak_rating` column) — even if they drop below 1600 later, it's locked in.

---

## 📈 Scaling Up

When you start getting real traffic:
- Upgrade Railway plan ($20/month handles thousands of concurrent users)
- Add Redis for matchmaking queue (Railway has Redis add-on)
- Add persistent file storage for the SQLite database (or migrate to PostgreSQL)

---

## 🆘 Need Help?

Common issues:
- **Port errors:** Railway sets PORT automatically — don't hardcode it
- **WebSocket not connecting:** Make sure your Railway service isn't sleeping (upgrade from free tier)
- **Database resets on deploy:** Add a Railway Volume for persistent storage
