# Helius API setup (one-time)

The message “Service not configured: HELIUS_API_KEY is missing” means the app needs an API key to access Solana data.

## Steps

### 1. Get a Helius key (free)

1. Open **https://dashboard.helius.dev**
2. Sign up or log in.
3. Create an API key (e.g. in API Keys).
4. Copy the key (long string of characters).

### 2. Create `.env` in the project root

**Option A:** Copy the example and edit:

```bash
cp .env.example .env
```

Then open `.env` and replace `your_helius_api_key_here` with your key.

**Option B:** In the project root (next to `package.json`) create a file named **`.env`** with one line:

```env
HELIUS_API_KEY=paste_your_key_here
```

Example (placeholder key):

```env
HELIUS_API_KEY=abcd1234-5678-90ab-cdef-1234567890ab
```

**Important:** Do not commit this file to Git — it is already in `.gitignore`.

If you see **401 / invalid api key**:
- No quotes in `.env`: use `HELIUS_API_KEY=key`, not `HELIUS_API_KEY="key"`.
- No spaces around `=` or at the start/end of the key.
- Copy the key from dashboard.helius.dev in full (usually a long string).
- After changing `.env`, restart the server (Ctrl+C, then `npm run dev`).

### 3. Restart the server

Stop the current `npm run dev` (Ctrl+C) and start again:

```bash
npm run dev
```

Then enter the token address again and click **Analyze**.

---

If the key is already in `.env` but the error persists — check for extra spaces around `=` or quotes, and that you restarted the server after editing `.env`.
