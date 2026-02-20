import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { agents } from "./agents/index.js";
import { arenaHeartbeat } from "./workflows/arena-heartbeat.js";

export const mastra = new Mastra({
  agents,
  workflows: {
    "arena-heartbeat": arenaHeartbeat,
  },
  storage: new LibSQLStore({
    id: "mastra-arena",
    url: "file:./mastra.db",
  }),
});

// Re-export for convenience
export { agents } from "./agents/index.js";
export { walletTools } from "./tools/wallet.js";
export { streamTools } from "./tools/stream.js";
export { cronTools } from "./tools/cron.js";
export { heartbeatTools } from "./tools/heartbeat.js";
export { dexscreenerTools } from "./tools/dexscreener.js";
export { farcasterTools } from "./tools/farcaster.js";
