import { walletTools } from '../src/tools/wallet.js';

async function main() {
  console.log("=== TEST: Wallet Tools ===\n");

  // Test 1: Create wallet
  console.log("1. Creating wallet for 'skippy'...");
  const create = walletTools['create-wallet'];
  const result = await create.execute({ agentId: 'skippy' });
  console.log("   ✅ CREATE:", JSON.stringify(result));

  // Test 2: Create same wallet again (should say already exists)
  console.log("\n2. Creating same wallet again (idempotent?)...");
  const result2 = await create.execute({ agentId: 'skippy' });
  console.log("   ✅ IDEMPOTENT:", result2.created === false ? "PASS" : "FAIL", JSON.stringify(result2));

  // Test 3: Check balance
  console.log("\n3. Checking balance...");
  const bal = walletTools['get-balance'];
  const balResult = await bal.execute({ agentId: 'skippy' });
  console.log("   ✅ BALANCE:", JSON.stringify(balResult));

  // Test 4: Create wallets for all agents
  console.log("\n4. Creating wallets for all agents...");
  for (const id of ['mando', 'walle', 'doc-brown', 'marvin']) {
    const r = await create.execute({ agentId: id });
    console.log(`   ✅ ${id}: ${r.publicKey} (created: ${r.created})`);
  }

  console.log("\n=== WALLET TESTS COMPLETE ===");
}

main().catch(console.error);
