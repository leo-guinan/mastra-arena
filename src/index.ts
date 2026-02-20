import { Mastra } from "@mastra/core";
import { agents } from "./agents/index.js";
import { arenaHeartbeat } from "./workflows/arena-heartbeat.js";

export const mastra = new Mastra({
  agents,
  workflows: {
    "arena-heartbeat": arenaHeartbeat,
  },
});
