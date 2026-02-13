/**
 * Helius API client — only server-side.
 * All keys must come from env (HELIUS_API_KEY).
 */

const HELIUS_API_BASE = "https://api-mainnet.helius-rpc.com";

const PLACEHOLDER_KEY = "your_helius_api_key_here";
const INVALID_KEY_MSG =
  "Invalid Helius API key. Update HELIUS_API_KEY in .env with your key from https://dashboard.helius.dev (no quotes or spaces), then restart the server (npm run dev).";

function getApiKey(): string {
  const raw = process.env.HELIUS_API_KEY;
  if (!raw || typeof raw !== "string") {
    throw new Error("HELIUS_API_KEY is not set. Add it to .env");
  }
  const key = raw.trim();
  if (!key) {
    throw new Error("HELIUS_API_KEY is empty in .env");
  }
  if (
    key === PLACEHOLDER_KEY ||
    key.toLowerCase() === PLACEHOLDER_KEY.toLowerCase()
  ) {
    throw new Error(
      ".env contains the placeholder key. Replace your_helius_api_key_here with your key from https://dashboard.helius.dev"
    );
  }
  return key;
}

export interface HeliusTransaction {
  signature: string;
  timestamp: number;
  feePayer: string;
  type?: string;
  source?: string;
  description?: string;
  nativeTransfers?: Array<{ fromUserAccount?: string; toUserAccount?: string; amount?: number }>;
  tokenTransfers?: Array<{ fromUserAccount?: string; toUserAccount?: string; mint?: string }>;
}

/**
 * Fetches transaction history for an address (Helius Enhanced API).
 * sort-order=asc => oldest first, desc => newest first.
 */
export async function getTransactionsByAddress(
  address: string,
  options: {
    "sort-order"?: "asc" | "desc";
    limit?: number;
    "before-signature"?: string;
  } = {}
): Promise<HeliusTransaction[]> {
  const apiKey = getApiKey();
  const params = new URLSearchParams({
    "api-key": apiKey,
    "sort-order": options["sort-order"] ?? "desc",
    limit: String(options.limit ?? 100),
  });
  if (options["before-signature"]) {
    params.set("before-signature", options["before-signature"]);
  }
  const url = `${HELIUS_API_BASE}/v0/addresses/${encodeURIComponent(address)}/transactions?${params}`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (res.status === 401) {
    throw new Error(INVALID_KEY_MSG);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Helius API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as HeliusTransaction[];
  return Array.isArray(data) ? data : [];
}

/**
 * From creator's transaction history, collects all wallet addresses that received
 * SOL or tokens FROM the creator (outgoing transfers). Used to detect sybil/insider
 * wallets that the creator funded before or after token launch.
 */
export function getWalletsReceivedFromCreator(
  creatorTxs: HeliusTransaction[],
  creatorAddress: string
): Map<string, number> {
  const receivedBy = new Map<string, number>();
  const creator = creatorAddress;

  for (const tx of creatorTxs) {
    const ts = tx.timestamp ?? 0;
    if (tx.nativeTransfers) {
      for (const t of tx.nativeTransfers) {
        if (t.fromUserAccount === creator && t.toUserAccount) {
          const to = t.toUserAccount;
          if (!receivedBy.has(to)) receivedBy.set(to, ts);
        }
      }
    }
    if (tx.tokenTransfers) {
      for (const t of tx.tokenTransfers) {
        if (t.fromUserAccount === creator && t.toUserAccount) {
          const to = t.toUserAccount;
          if (!receivedBy.has(to)) receivedBy.set(to, ts);
        }
      }
    }
  }
  return receivedBy;
}

/**
 * Fetches asset (token/NFT) by id (mint). DAS API via Helius RPC.
 */
export async function getAsset(
  mintAddress: string
): Promise<{
  id: string;
  creators?: Array<{ address: string }>;
  content?: { metadata?: { name?: string; symbol?: string } };
  token_info?: {
    supply?: string;
    decimals?: number;
    /** If set, creator can mint more tokens (unlimited supply risk). If null/revoked, supply is fixed. */
    mint_authority?: string | null;
  };
} | null> {
  const apiKey = getApiKey();
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;
  const body = {
    jsonrpc: "2.0",
    id: "1",
    method: "getAsset",
    params: { id: mintAddress },
  };
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    next: { revalidate: 0 },
  });
  const json = (await res.json()) as {
    result?: unknown;
    error?: { message?: string };
  };
  if (json.error) {
    if (res.status === 401 || (json.error.message ?? "").toLowerCase().includes("invalid api key")) {
      throw new Error(INVALID_KEY_MSG);
    }
    if (json.error.message?.includes("not found") || res.status === 404) {
      return null;
    }
    throw new Error(`Helius getAsset error: ${json.error.message ?? "Unknown"}`);
  }
  const raw = json.result as Record<string, unknown> | null;
  if (!raw) return null;
  return {
    id: (raw.id as string) ?? mintAddress,
    creators: raw.creators as Array<{ address: string }> | undefined,
    content: raw.content as { metadata?: { name?: string; symbol?: string } } | undefined,
    token_info: raw.token_info as {
      supply?: string;
      decimals?: number;
      mint_authority?: string | null;
    } | undefined,
  };
}

/** SPL Token mint account: byte 10 = mint_authority option (0 = revoked, 1 = set). */
const MINT_AUTHORITY_OPTION_OFFSET = 10;

/**
 * Returns true if mint authority is set (creator can mint more), false if revoked. Uses RPC getAccountInfo for plain SPL mints when DAS getAsset has no token_info.
 */
export async function getMintAuthoritySet(
  mintAddress: string
): Promise<boolean | null> {
  const apiKey = getApiKey();
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "getAccountInfo",
      params: [mintAddress, { encoding: "base64" }],
    }),
    next: { revalidate: 0 },
  });
  const json = (await res.json()) as {
    result?: { value?: { data: string } };
    error?: { message?: string };
  };
  if (json.error || !json.result?.value?.data) return null;
  try {
    const buf = Buffer.from(json.result.value.data, "base64");
    if (buf.length < MINT_AUTHORITY_OPTION_OFFSET + 1) return null;
    return buf[MINT_AUTHORITY_OPTION_OFFSET] === 1;
  } catch {
    return null;
  }
}

export interface TokenAccountHolder {
  owner: string;
  amount: string;
}

/**
 * Fetches token accounts by mint (holders). Uses pagination; for MVP we fetch up to limit.
 * Amounts are in raw units (with decimals).
 */
export async function getTokenAccountsByMint(
  mintAddress: string,
  limit = 1000
): Promise<{ token_accounts: TokenAccountHolder[]; total: number }> {
  const apiKey = getApiKey();
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;
  const body = {
    jsonrpc: "2.0",
    id: "1",
    method: "getTokenAccounts",
    params: { mint: mintAddress, limit },
  };
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    next: { revalidate: 0 },
  });
  if (res.status === 401) {
    throw new Error(INVALID_KEY_MSG);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Helius getTokenAccounts error ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    result?: {
      token_accounts?: Array< { owner?: string; amount?: number | string } >;
      total?: number;
    };
    token_accounts?: Array< { owner?: string; amount?: number | string } >;
    total?: number;
    error?: { message?: string };
  };
  if (json.error) {
    throw new Error(`Helius getTokenAccounts: ${json.error.message ?? "Unknown"}`);
  }
  const data = json.result ?? json;
  const accounts = data.token_accounts ?? [];
  const total = data.total ?? accounts.length;
  const token_accounts: TokenAccountHolder[] = accounts.map((a) => ({
    owner: String(a.owner ?? ""),
    amount: String(a.amount ?? 0),
  }));
  return { token_accounts, total };
}
