import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const DELAY = 2500;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rugcheckReport(mint: string) {
  const r = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`);
  return r.json();
}

async function dexscreenerInfo(mint: string) {
  const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  const j = await r.json();
  if (!j.pairs?.[0]) return null;
  const p = j.pairs[0];
  return {
    name: p.baseToken.name,
    symbol: p.baseToken.symbol,
    price: p.priceUsd,
    mc: p.marketCap || p.fdv,
    vol24h: p.volume?.h24,
    buys24h: p.txns?.h24?.buys,
    sells24h: p.txns?.h24?.sells,
    liquidity: p.liquidity?.usd,
    chain: p.chainId,
    priceChange24h: p.priceChange?.h24,
  };
}

async function rpc(method: string, params: any[]) {
  const r = await fetch("https://api.mainnet-beta.solana.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return r.json();
}

function classifyFromTxns(txns: any[], tokenCount: number | null, solBalance: number | null, holdingPct: number) {
  if (!txns || txns.length === 0) {
    if (holdingPct > 10) return { type: "LP_POOL", confidence: 0.9, signals: ["high_pct", "no_txns"] };
    return { type: "DEAD", confidence: 0.8, signals: ["no_txns"] };
  }

  const gaps: number[] = [];
  for (let i = 0; i < txns.length - 1; i++) {
    gaps.push((txns[i].time - txns[i + 1].time) / 1000);
  }

  const minGap = gaps.length ? Math.min(...gaps) : Infinity;
  const burstCount = gaps.filter((g) => g < 5).length;

  let type = "HUMAN";
  let confidence = 0.6;
  const signals: string[] = [];

  if (burstCount > 5 || (minGap < 2 && gaps.length > 10)) {
    type = "BOT";
    confidence = 0.9;
    signals.push("burst_trading");
  }

  if (tokenCount !== null) {
    if (tokenCount > 20) signals.push("MEGA_DEGEN");
    else if (tokenCount > 10) signals.push("DEGEN");
    else if (tokenCount <= 3) signals.push("FOCUSED");
  }

  if (solBalance !== null) {
    if (solBalance > 100) signals.push("WHALE");
    else if (solBalance > 10) signals.push("MID_CAP");
    else if (solBalance > 1) signals.push("RETAIL");
    else signals.push("DUST");
  }

  // Timezone inference
  const hours = txns.map((t: any) => new Date(t.time).getUTCHours());
  const hourCounts: Record<number, number> = {};
  hours.forEach((h: number) => { hourCounts[h] = (hourCounts[h] || 0) + 1; });
  const peakHour = parseInt(Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "0");

  let timezone = "Ambiguous";
  if (peakHour >= 13 && peakHour <= 22) timezone = "US";
  else if (peakHour >= 8 && peakHour <= 17) timezone = "Europe";
  else if (peakHour >= 0 && peakHour <= 9) timezone = "Asia";

  return { type, confidence, signals, timezone, peakHour };
}

export const analyzeTokenHolders = createTool({
  id: "analyze-token-holders",
  description:
    "Run a full holder intelligence report on a Solana token. Returns behavioral classification, bot detection, timezone inference, wealth tiers, and conviction scoring for each holder.",
  inputSchema: z.object({
    mint: z.string().describe("Solana token mint address"),
    name: z.string().optional().describe("Token name/symbol for display"),
  }),
  outputSchema: z.object({
    token: z.object({
      name: z.string(),
      mint: z.string(),
      price: z.string().nullable(),
      mc: z.number().nullable(),
      vol24h: z.number().nullable(),
      riskScore: z.number(),
    }),
    holders: z.array(
      z.object({
        address: z.string(),
        holdingPct: z.number(),
        type: z.string(),
        confidence: z.number(),
        solBalance: z.number().nullable(),
        tokenCount: z.number().nullable(),
        timezone: z.string().nullable(),
        signals: z.array(z.string()),
      })
    ),
    summary: z.object({
      totalHolders: z.number(),
      bots: z.number(),
      humans: z.number(),
      dead: z.number(),
      avgSol: z.number(),
      timezones: z.record(z.number()),
    }),
  }),
  execute: async ({ mint, name }) => {
    // DexScreener
    const dex = await dexscreenerInfo(mint);
    const displayName = name || dex?.symbol || mint.slice(0, 8);

    // Rugcheck holders
    await wait(1000);
    const rc = await rugcheckReport(mint);
    const realHolders = (rc.topHolders || []).filter((h: any) => h.pct < 50 && h.pct > 0.01);

    const profiles = [];
    for (const holder of realHolders.slice(0, 10)) {
      await wait(DELAY);
      // Get SOL balance
      const balRes = await rpc("getBalance", [holder.owner]);
      const sol = balRes.error ? null : balRes.result.value / 1e9;

      await wait(DELAY);
      // Get transaction history
      const txRes = await rpc("getSignaturesForAddress", [holder.owner, { limit: 20 }]);
      const txns = txRes.error
        ? null
        : txRes.result.map((tx: any) => ({ time: tx.blockTime * 1000, err: !!tx.err }));

      await wait(DELAY);
      // Get token count
      const taRes = await rpc("getTokenAccountsByOwner", [
        holder.owner,
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        { encoding: "jsonParsed" },
      ]);
      const tokenCount = taRes.error
        ? null
        : taRes.result.value.filter(
            (a: any) => parseFloat(a.account.data.parsed.info.tokenAmount.uiAmountString) > 0
          ).length;

      const classification = classifyFromTxns(txns, tokenCount, sol, holder.pct);

      profiles.push({
        address: holder.owner,
        holdingPct: holder.pct,
        type: classification.type,
        confidence: classification.confidence,
        solBalance: sol,
        tokenCount,
        timezone: classification.timezone || null,
        signals: classification.signals,
      });
    }

    const bots = profiles.filter((p) => p.type === "BOT").length;
    const humans = profiles.filter((p) => p.type === "HUMAN").length;
    const dead = profiles.filter((p) => p.type === "DEAD" || p.type === "LP_POOL").length;
    const avgSol =
      profiles.filter((p) => p.solBalance !== null).reduce((a, p) => a + (p.solBalance || 0), 0) /
      (profiles.length || 1);

    const tzCounts: Record<string, number> = {};
    profiles.forEach((p) => {
      if (p.timezone) tzCounts[p.timezone] = (tzCounts[p.timezone] || 0) + 1;
    });

    return {
      token: {
        name: displayName,
        mint,
        price: dex?.price || null,
        mc: dex?.mc || null,
        vol24h: dex?.vol24h || null,
        riskScore: rc.score || 0,
      },
      holders: profiles,
      summary: {
        totalHolders: realHolders.length,
        bots,
        humans,
        dead,
        avgSol: Math.round(avgSol * 100) / 100,
        timezones: tzCounts,
      },
    };
  },
});

export const getMarketSnapshot = createTool({
  id: "get-market-snapshot",
  description: "Get a market snapshot for multiple tokens by searching DexScreener. Works for any chain.",
  inputSchema: z.object({
    tokenNames: z.array(z.string()).describe("Token names or symbols to search"),
    chain: z.string().optional().describe("Filter by chain (e.g. 'base', 'solana')"),
  }),
  outputSchema: z.object({
    tokens: z.array(
      z.object({
        name: z.string(),
        address: z.string(),
        chain: z.string(),
        price: z.string(),
        mc: z.number(),
        vol24h: z.number(),
        buys24h: z.number(),
        sells24h: z.number(),
        buysSellRatio: z.number(),
        liquidity: z.number(),
        priceChange24h: z.number(),
      })
    ),
  }),
  execute: async ({ tokenNames, chain }) => {
    const tokens = [];
    for (const name of tokenNames) {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${name}`);
      const j = await r.json();
      let pairs = j.pairs || [];
      if (chain) pairs = pairs.filter((p: any) => p.chainId === chain);
      pairs = pairs.filter((p: any) =>
        p.baseToken.symbol.toUpperCase().includes(name.toUpperCase())
      );

      if (pairs.length > 0) {
        const p = pairs[0];
        tokens.push({
          name: p.baseToken.symbol,
          address: p.baseToken.address,
          chain: p.chainId,
          price: p.priceUsd,
          mc: p.marketCap || p.fdv || 0,
          vol24h: p.volume?.h24 || 0,
          buys24h: p.txns?.h24?.buys || 0,
          sells24h: p.txns?.h24?.sells || 0,
          buysSellRatio: (p.txns?.h24?.buys || 0) / (p.txns?.h24?.sells || 1),
          liquidity: p.liquidity?.usd || 0,
          priceChange24h: p.priceChange?.h24 || 0,
        });
      }
      await wait(500);
    }
    return { tokens };
  },
});

export const holderIntelTools = {
  "analyze-token-holders": analyzeTokenHolders,
  "get-market-snapshot": getMarketSnapshot,
};
