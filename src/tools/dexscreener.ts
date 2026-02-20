import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const BASE_URL = process.env.DEXSCREENER_BASE_URL || "https://api.dexscreener.com/latest/dex";

interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd: string;
  volume: { h24: number; h6: number; h1: number; m5: number };
  priceChange: { h24: number; h6: number; h1: number; m5: number };
  liquidity: { usd: number; base: number; quote: number };
  fdv: number;
  marketCap: number;
  txns: { h24: { buys: number; sells: number }; h6: { buys: number; sells: number }; h1: { buys: number; sells: number }; m5: { buys: number; sells: number } };
}

export const getTokenPrice = createTool({
  id: "get-token-price",
  description: "Get real-time price, volume, liquidity, and transaction data for a token from DexScreener",
  inputSchema: z.object({
    tokenAddress: z.string().describe("Token contract address"),
  }),
  outputSchema: z.object({
    symbol: z.string(),
    name: z.string(),
    priceUsd: z.string(),
    marketCap: z.number(),
    volume24h: z.number(),
    volume1h: z.number(),
    volume5m: z.number(),
    priceChange24h: z.number(),
    priceChange1h: z.number(),
    liquidity: z.number(),
    buys24h: z.number(),
    sells24h: z.number(),
    chain: z.string(),
    dex: z.string(),
    pairAddress: z.string(),
  }),
  execute: async ({ tokenAddress }) => {
    const res = await fetch(`${BASE_URL}/tokens/${tokenAddress}`);
    if (!res.ok) throw new Error(`DexScreener API error: ${res.status}`);
    const data = await res.json() as { pairs: DexPair[] };
    if (!data.pairs?.length) throw new Error(`No pairs found for ${tokenAddress}`);

    // Use highest-liquidity pair
    const pair = data.pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    return {
      symbol: pair.baseToken.symbol,
      name: pair.baseToken.name,
      priceUsd: pair.priceUsd,
      marketCap: pair.marketCap || pair.fdv || 0,
      volume24h: pair.volume?.h24 || 0,
      volume1h: pair.volume?.h1 || 0,
      volume5m: pair.volume?.m5 || 0,
      priceChange24h: pair.priceChange?.h24 || 0,
      priceChange1h: pair.priceChange?.h1 || 0,
      liquidity: pair.liquidity?.usd || 0,
      buys24h: pair.txns?.h24?.buys || 0,
      sells24h: pair.txns?.h24?.sells || 0,
      chain: pair.chainId,
      dex: pair.dexId,
      pairAddress: pair.pairAddress,
    };
  },
});

export const getMultipleTokenPrices = createTool({
  id: "get-multiple-token-prices",
  description: "Get prices for multiple tokens at once. Returns array of price data for arena scoreboard.",
  inputSchema: z.object({
    tokenAddresses: z.array(z.string()).describe("Array of token contract addresses"),
  }),
  outputSchema: z.object({
    tokens: z.array(z.object({
      address: z.string(),
      symbol: z.string(),
      priceUsd: z.string(),
      marketCap: z.number(),
      volume24h: z.number(),
      volume1h: z.number(),
      priceChange24h: z.number(),
      liquidity: z.number(),
      buys24h: z.number(),
      sells24h: z.number(),
    })),
    timestamp: z.string(),
  }),
  execute: async ({ tokenAddresses }) => {
    const tokens = await Promise.all(
      tokenAddresses.map(async (addr) => {
        try {
          const res = await fetch(`${BASE_URL}/tokens/${addr}`);
          if (!res.ok) return null;
          const data = await res.json() as { pairs: DexPair[] };
          if (!data.pairs?.length) return null;
          const pair = data.pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
          return {
            address: addr,
            symbol: pair.baseToken.symbol,
            priceUsd: pair.priceUsd,
            marketCap: pair.marketCap || pair.fdv || 0,
            volume24h: pair.volume?.h24 || 0,
            volume1h: pair.volume?.h1 || 0,
            priceChange24h: pair.priceChange?.h24 || 0,
            liquidity: pair.liquidity?.usd || 0,
            buys24h: pair.txns?.h24?.buys || 0,
            sells24h: pair.txns?.h24?.sells || 0,
          };
        } catch { return null; }
      })
    );
    return {
      tokens: tokens.filter((t): t is NonNullable<typeof t> => t !== null),
      timestamp: new Date().toISOString(),
    };
  },
});

export const dexscreenerTools = {
  "get-token-price": getTokenPrice,
  "get-multiple-token-prices": getMultipleTokenPrices,
};
