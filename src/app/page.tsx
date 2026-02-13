"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isValidSolanaAddress } from "@/lib/utils";
import type { RiskResult } from "@/lib/risk-score";

const SEVERITY_STYLES = {
  high: {
    bg: "bg-red-500/15 border-red-500/40",
    text: "text-red-700 dark:text-red-400",
    label: "High risk",
  },
  medium: {
    bg: "bg-amber-500/15 border-amber-500/40",
    text: "text-amber-700 dark:text-amber-400",
    label: "Medium risk",
  },
  low: {
    bg: "bg-emerald-500/15 border-emerald-500/40",
    text: "text-emerald-700 dark:text-emerald-400",
    label: "Low risk",
  },
} as const;

const FACTOR_SEVERITY_STYLES = {
  critical: "danger" as const,
  warning: "warning" as const,
  positive: "success" as const,
  neutral: "secondary" as const,
};

function HomeContent() {
  const [mint, setMint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RiskResult | null>(null);

  const runAnalysis = useCallback(async (mintAddress: string) => {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/analyze?mint=${encodeURIComponent(mintAddress)}`
      );
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error ?? `Error ${res.status}`;
        if (res.status === 401 || msg.includes("invalid api key") || msg.includes("Invalid API key")) {
          setError(
            "Invalid Helius API key. In .env set HELIUS_API_KEY to your key from https://dashboard.helius.dev (no quotes or spaces), save the file and restart the server: npm run dev."
          );
        } else if (res.status === 503 && (msg.includes("HELIUS") || msg.includes("not configured"))) {
          setError(
            "Service not configured: Helius API key is missing. Get a free key at https://dashboard.helius.dev, create a .env file in the project root with HELIUS_API_KEY=your_key and restart the server (npm run dev)."
          );
        } else {
          setError(msg);
        }
        return;
      }
      setResult(data as RiskResult);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("mint", mintAddress);
        window.history.replaceState({}, "", url.toString());
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Network error. Check your connection."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleAnalyze() {
    const trimmed = mint.trim();
    if (!trimmed) {
      setError("Enter the token mint address");
      return;
    }
    if (!isValidSolanaAddress(trimmed)) {
      setError("Invalid Solana address. Expected 32–44 base58 characters.");
      return;
    }
    await runAnalysis(trimmed);
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          Check Solana token
        </h1>
        <p className="mt-3 text-lg font-semibold text-foreground tracking-tight">
          We analyze the creator’s story — before you invest
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Token mint address</CardTitle>
          <CardDescription>
            Paste a Solana token mint address to analyze. 
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="e.g. So11111111111111111111111111111111111111112"
              value={mint}
              onChange={(e) => setMint(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
              disabled={loading}
              className="font-mono text-sm"
            />
            <Button onClick={handleAnalyze} disabled={loading}>
              {loading ? "Analyzing…" : "Analyze"}
            </Button>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {result && (
        <div className="mt-8 space-y-6">
          {/* Risk Score */}
          <Card className={`border-2 ${SEVERITY_STYLES[result.severity].bg}`}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Risk score</span>
                <Badge
                  variant={
                    result.severity === "high"
                      ? "danger"
                      : result.severity === "medium"
                        ? "warning"
                        : "success"
                  }
                  className={SEVERITY_STYLES[result.severity].text}
                >
                  {SEVERITY_STYLES[result.severity].label}
                </Badge>
              </CardTitle>
              <CardDescription>
                Higher score = lower risk. 0–30: high, 31–60: medium, 61–100: low.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={`text-4xl font-bold tabular-nums ${SEVERITY_STYLES[result.severity].text}`}
              >
                {result.score}
                <span className="text-2xl font-normal text-muted-foreground">
                  /100
                </span>
              </div>
              {result.creator.tokenName && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Token: {result.creator.tokenName}
                  {result.creator.tokenSymbol && ` (${result.creator.tokenSymbol})`}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Emission, Creator sold, Liquidity, Fresh holders */}
          <Card>
            <CardHeader>
              <CardTitle>Supply, creator & liquidity</CardTitle>
              <CardDescription>
                Key metrics as in DEX dashboards
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground">Supply:</span>
                <span className="font-medium">
                  {result.emissionStatus === "unlimited"
                    ? "Unlimited (creator can mint more)"
                    : result.emissionStatus === "fixed"
                      ? "Fixed (mint authority revoked)"
                      : "—"}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground">Creator sold?</span>
                <span className="font-medium">
                  {result.holderStats?.creatorHoldPercent !== undefined ? (
                    result.creatorSold ? (
                      <span className="text-red-600 dark:text-red-400">Yes — creator holds {result.holderStats.creatorHoldPercent.toFixed(2)}%</span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400">No — creator holds {result.holderStats.creatorHoldPercent.toFixed(1)}%</span>
                    )
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground">Liquidity (pool):</span>
                <span className="font-medium tabular-nums">
                  {result.tokenMarket?.liquidityUsd !== undefined
                    ? `$${result.tokenMarket.liquidityUsd.toLocaleString()}`
                    : "no data"}
                </span>
              </div>
              {(result.tokenMarket?.pairs !== undefined || result.tokenMarket?.liquidityUsd !== undefined) && (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="text-muted-foreground">Pairs (swap to):</span>
                  <span className="font-medium tabular-nums text-right">
                    {result.tokenMarket?.pairs && result.tokenMarket.pairs.length > 0
                      ? result.tokenMarket.pairs.map((p) => `${p.quoteSymbol} ($${p.liquidityUsd.toLocaleString()})`).join(", ")
                      : "No pairs — not swappable"}
                  </span>
                </div>
              )}
              {(result.tokenMarket?.migrationStatus !== undefined || result.tokenMarket?.migrationLabel) && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted-foreground">Migration:</span>
                  <span className="font-medium">
                    {result.tokenMarket?.migrationLabel ?? "—"}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground">Trades (24h):</span>
                <span className="font-medium tabular-nums">
                  {result.tokenMarket?.txCount24h !== undefined
                    ? result.tokenMarket.buys24h !== undefined && result.tokenMarket.sells24h !== undefined
                      ? `${result.tokenMarket.txCount24h.toLocaleString()} (buys ${result.tokenMarket.buys24h.toLocaleString()} / sells ${result.tokenMarket.sells24h.toLocaleString()})`
                      : result.tokenMarket.txCount24h.toLocaleString()
                    : "—"}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground">Unique traders (24h):</span>
                <span className="font-medium tabular-nums">
                  {result.tokenMarket?.uniqueTraders24h !== undefined
                    ? result.tokenMarket.uniqueTraders24h.toLocaleString()
                    : "—"}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground">New holders (1D / 7D):</span>
                <span className="font-medium tabular-nums">
                  {result.tokenMarket?.freshHolders1dPercent !== undefined || result.tokenMarket?.freshHolders7dPercent !== undefined
                    ? `${(result.tokenMarket?.freshHolders1dPercent ?? 0).toFixed(1)}% / ${(result.tokenMarket?.freshHolders7dPercent ?? 0).toFixed(1)}%`
                    : "—"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Creator */}
          <Card>
            <CardHeader>
              <CardTitle>Token creator</CardTitle>
              <CardDescription>
                Wallet that deployed the token and its on-chain activity
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 font-mono text-sm">
              <p className="break-all text-muted-foreground">
                {result.creator.creatorAddress}
              </p>
              <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                {result.creator.accountAgeDays != null && (
                  <li>
                    Wallet age: ~{Math.round(result.creator.accountAgeDays)}{" "}
                    days
                  </li>
                )}
                <li>
                  Estimated tokens created:{" "}
                  {result.creator.estimatedTokensCreated}
                </li>
                <li>Transactions in sample: {result.creator.totalTxCount}</li>
                {result.creator.canMintUnlimited !== undefined && (
                  <li>
                    Can mint more (unlimited supply):{" "}
                    {result.creator.canMintUnlimited ? "yes" : "no (supply fixed)"}
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>

          {/* Creator's other tokens — liquidity and pairs (swapability) */}
          {result.creatorPreviousTokens && result.creatorPreviousTokens.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Creator&apos;s other tokens</CardTitle>
                <CardDescription>
                  Other tokens created by this wallet — current liquidity and pairs (can you swap to SOL/USDC?).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-3 text-sm">
                  {result.creatorPreviousTokens.map((t) => (
                    <li key={t.mint} className="rounded-md border bg-muted/20 p-3">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        <span className="font-mono truncate max-w-[200px]" title={t.mint}>
                          {t.mint.slice(0, 4)}…{t.mint.slice(-4)}
                        </span>
                        {(t.symbol ?? t.name) && (
                          <span className="text-muted-foreground">
                            {t.symbol ?? t.name}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                        <span className="tabular-nums">Liquidity: ${t.liquidityUsd.toLocaleString()}</span>
                        {t.pairs.length > 0 ? (
                          <span>Pairs: {t.pairs.map((p) => `${p.quoteSymbol} ($${p.liquidityUsd.toLocaleString()})`).join(", ")}</span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">No pairs — not swappable</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Holder distribution */}
          {result.holderStats && (
            <Card>
              <CardHeader>
                <CardTitle>Holder distribution</CardTitle>
                <CardDescription>
                  Share of supply held by top 10 wallets. High concentration = dump risk
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-2xl font-bold tabular-nums">
                    Top 10 holders: {result.holderStats.top10Percent.toFixed(1)}%
                  </span>
                  {result.holderStats.top10Percent >= 80 && (
                    <Badge variant="danger">Very high concentration</Badge>
                  )}
                  {result.holderStats.top10Percent >= 50 && result.holderStats.top10Percent < 80 && (
                    <Badge variant="warning">High concentration</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Total holders: {result.holderStats.totalHolders}
                </p>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Top 10 by share:</p>
                  {result.holderStats.topHolders.map((h, i) => {
                    const isConnected = result.holderStats?.creatorConnectedHolders?.some((c) => c.owner === h.owner);
                    return (
                      <div key={h.owner} className="flex items-center gap-2 text-sm">
                        <span className="w-5 text-muted-foreground">{i + 1}.</span>
                        <span className="font-mono truncate max-w-[180px]" title={h.owner}>
                          {h.owner.slice(0, 4)}…{h.owner.slice(-4)}
                        </span>
                        {isConnected && (
                          <Badge variant="warning" className="text-xs">received from creator</Badge>
                        )}
                        <span className="tabular-nums text-muted-foreground">{h.percent.toFixed(1)}%</span>
                        <div className="flex-1 h-2 rounded bg-muted overflow-hidden max-w-[120px]">
                          <div
                            className="h-full rounded bg-primary"
                            style={{ width: `${Math.min(100, h.percent)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Creator ↔ top holders connection */}
          {result.holderStats?.creatorConnectedHolders && result.holderStats.creatorConnectedHolders.length > 0 && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardHeader>
                <CardTitle>Creator ↔ top holders link</CardTitle>
                <CardDescription>
                  These top-10 wallets received SOL or tokens from the creator — possible coordination or sybil (creator distributed to own addresses).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm font-medium">
                  Creator → received transfers: {result.holderStats.creatorConnectedHolders.length} of top 10
                </p>
                <ul className="space-y-2 text-sm">
                  {result.holderStats.creatorConnectedHolders.map((h) => (
                    <li key={h.owner} className="flex flex-wrap items-center gap-2 rounded border border-amber-500/20 bg-background/50 px-3 py-2 font-mono">
                      <span className="truncate max-w-[200px]" title={h.owner}>
                        {h.owner.slice(0, 6)}…{h.owner.slice(-6)}
                      </span>
                      <span className="tabular-nums text-muted-foreground">({h.percent.toFixed(1)}% supply)</span>
                      {h.firstReceivedAt != null && (
                        <span className="text-muted-foreground text-xs">
                          first transfer from creator: {new Date(h.firstReceivedAt * 1000).toLocaleDateString()}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Red flags / factors */}
          <Card>
            <CardHeader>
              <CardTitle>Risk factors & signals</CardTitle>
              <CardDescription>
                What is included in the risk score
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {result.factors.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-md border bg-muted/30 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={FACTOR_SEVERITY_STYLES[f.severity]}>
                        {f.severity === "critical"
                          ? "Critical"
                          : f.severity === "warning"
                          ? "Warning"
                          : f.severity === "positive"
                          ? "Positive"
                          : "Neutral"}
                      </Badge>
                      <span className="font-medium">{f.label}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{f.description}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      <footer className="mt-12 border-t pt-6 text-center text-sm text-muted-foreground">
        Check Solana token is for informational use only. Not financial or legal advice.
      </footer>
    </main>
  );
}

export default function Home() {
  return <HomeContent />;
}
