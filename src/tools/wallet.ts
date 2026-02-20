import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const WALLET_DIR = process.env.WALLET_DIR || ".wallets";
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

function ensureWalletDir() {
  if (!fs.existsSync(WALLET_DIR)) fs.mkdirSync(WALLET_DIR, { recursive: true });
}

function loadKeypair(agentId: string): Keypair | null {
  const fp = path.join(WALLET_DIR, `${agentId}.json`);
  if (!fs.existsSync(fp)) return null;
  const secret = JSON.parse(fs.readFileSync(fp, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function saveKeypair(agentId: string, kp: Keypair) {
  ensureWalletDir();
  const fp = path.join(WALLET_DIR, `${agentId}.json`);
  fs.writeFileSync(fp, JSON.stringify(Array.from(kp.secretKey)));
}

export const createWallet = createTool({
  id: "create-wallet",
  description: "Create a new Solana wallet for an agent. Returns the public key.",
  inputSchema: z.object({
    agentId: z.string().describe("Agent identifier"),
  }),
  outputSchema: z.object({
    publicKey: z.string(),
    created: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ agentId }) => {
    const existing = loadKeypair(agentId);
    if (existing) {
      return { publicKey: existing.publicKey.toBase58(), created: false, message: "Wallet already exists" };
    }
    const kp = Keypair.generate();
    saveKeypair(agentId, kp);
    return { publicKey: kp.publicKey.toBase58(), created: true, message: "Wallet created" };
  },
});

export const getBalance = createTool({
  id: "get-balance",
  description: "Get SOL balance for an agent's wallet",
  inputSchema: z.object({ agentId: z.string() }),
  outputSchema: z.object({
    publicKey: z.string(),
    balanceSol: z.number(),
    balanceLamports: z.number(),
  }),
  execute: async ({ agentId }) => {
    const kp = loadKeypair(agentId);
    if (!kp) throw new Error(`No wallet for agent ${agentId}`);
    const conn = new Connection(RPC_URL);
    const bal = await conn.getBalance(kp.publicKey);
    return { publicKey: kp.publicKey.toBase58(), balanceSol: bal / LAMPORTS_PER_SOL, balanceLamports: bal };
  },
});

export const sendSol = createTool({
  id: "send-sol",
  description: "Send SOL from an agent's wallet to a destination address",
  inputSchema: z.object({
    agentId: z.string(),
    to: z.string().describe("Destination public key"),
    amountSol: z.number().describe("Amount in SOL"),
  }),
  outputSchema: z.object({ signature: z.string(), amountSol: z.number() }),
  execute: async ({ agentId, to, amountSol }) => {
    const kp = loadKeypair(agentId);
    if (!kp) throw new Error(`No wallet for agent ${agentId}`);
    const conn = new Connection(RPC_URL);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: new PublicKey(to),
        lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
      })
    );
    const sig = await conn.sendTransaction(tx, [kp]);
    return { signature: sig, amountSol };
  },
});

export const walletTools = {
  "create-wallet": createWallet,
  "get-balance": getBalance,
  "send-sol": sendSol,
};
