import { dexscreenerTools } from '../src/tools/dexscreener.js';

async function main() {
  console.log("=== TEST: DexScreener Tools ===\n");

  // Test 1: Get TOWEL price
  console.log("1. Get TOWEL price...");
  const get = dexscreenerTools['get-token-price'];
  const result = await get.execute({ tokenAddress: 'Ak9ptp86tfJMrKwBwoe49pNkHxPjZk8GRQxZKB78pump' });
  console.log(`   ✅ ${result.symbol}: $${result.priceUsd} | MC: $${result.marketCap.toLocaleString()} | 24h vol: $${result.volume24h.toLocaleString()}`);

  // Test 2: Multiple tokens
  console.log("\n2. Get multiple tokens (TOWEL, METATOWEL, MARVIN)...");
  const getMulti = dexscreenerTools['get-multiple-token-prices'];
  const multi = await getMulti.execute({
    tokenAddresses: [
      'Ak9ptp86tfJMrKwBwoe49pNkHxPjZk8GRQxZKB78pump',
      'CtsDk7Mo1wwhxhQp6zqB2oHEFXPEHhgjTBE8VvcUpump',
      'HM9k1EBbPuRGR4VP2CW6ADgsnbdkfYMW8y8gmkM3MhSa',
    ]
  });
  console.log(`   ✅ Got ${multi.tokens.length}/3 tokens at ${multi.timestamp}`);
  for (const t of multi.tokens) {
    console.log(`      ${t.symbol}: MC $${t.marketCap.toLocaleString()} | 24h: $${t.volume24h.toLocaleString()}`);
  }

  console.log("\n=== DEXSCREENER TESTS COMPLETE ===");
}

main().catch(console.error);
