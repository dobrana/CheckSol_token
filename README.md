# CheckSol token

Solana token risk analysis: creator check, wallet history and risk score before investing.

## Concept (from project spec)

**Problem:** Thousands of tokens are created on Solana every day; a large share are fraudulent (scams, rug pulls, pump-and-dump). Standard scanners and explorers show only current state, not creator history and behavior patterns. Retail investors lack on-chain forensics tools.

**Solution:** CheckSol provides analysis in three areas:

1. **Creator history** — the wallet that deployed the token: how many tokens it has launched, survival of past tokens, “create → pump → abandon” patterns, account age and funding sources.
2. **Connection graph** — links between wallets, sybil clusters, first buyers, circular transfers, graph visualization (MVP: input + Risk Score block).
3. **Transaction forensics** — wash trading, MEV bundles, sniper bots, timeline of suspicious activity (in future versions).

**MVP (this repo):**

- Single input: token mint address.
- **Risk Score (0–100)**
 with color scale: 0–30 high risk (red), 31–60 medium (yellow), 61–100 low (green).
- Risk factors with short explanations.
- Creator panel: address, wallet age, estimated tokens created, transactions in sample.

**Stack:**

- Frontend: Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn-style components.
- Backend: Next.js API Routes, Helius API (RPC + Enhanced Transactions).
- Deploy: Vercel. Keys only in environment variables (never in code).

**Security:**

- API keys only in `.env` (and in deploy env). `.env` is in `.gitignore`.
- No hardcoded keys; server reads `process.env.HELIUS_API_KEY`.

## Requirements

- Node.js 18+
- [Helius](https://dashboard.helius.dev) account and API key (free tier available).

## Install & run

```bash
npm install
cp .env.example .env
# Edit .env and set HELIUS_API_KEY=your_key
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), paste a token mint address and click **Analyze**.

## Deploy (Vercel)

1. Import the repo in Vercel.
2. In project settings add env var **HELIUS_API_KEY** (do not commit the value).
3. Deploy via Git or `vercel --prod`.

## Project structure

```
src/
  app/
    api/analyze/   # GET ?mint=... — token analysis
    layout.tsx
    page.tsx       # Input form + Risk Score dashboard
  components/ui/   # Button, Card, Input, Badge
  lib/
    helius.ts      # Helius client (server-only)
    risk-score.ts  # Risk and factor calculation
    utils.ts       # cn(), Solana address validation
doc/
  SolanaForensics_Project_Concept.docx  # Full concept
```

## Disclaimer

This tool is for informational purposes only. It is not financial or legal advice. Always do your own research (DYOR).
