import { Mastra } from "@mastra/core";
import { agents } from "./agents/index.js";
import { arenaHeartbeat } from "./workflows/arena-heartbeat.js";

export const mastra = new Mastra({
  agents,
  workflows: {
    "arena-heartbeat": arenaHeartbeat,
  },
});

// Re-export for convenience
export { agents } from "./agents/index.js";
export { walletTools } from "./tools/wallet.js";
export { streamTools } from "./tools/stream.js";
export { cronTools } from "./tools/cron.js";
export { heartbeatTools } from "./tools/heartbeat.js";
export { dexscreenerTools } from "./tools/dexscreener.js";
export { farcasterTools } from "./tools/farcaster.js";
