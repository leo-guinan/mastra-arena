/**
 * Arena Scheduler
 * 
 * Runs the heartbeat workflow on a configurable interval.
 * Each tick: all agents submit heartbeats → rankings computed → commentary published.
 * 
 * Usage:
 *   HEARTBEAT_INTERVAL_MS=300000 npx tsx src/scheduler.ts
 */

import { mastra } from "./index.js";

const INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL_MS || "300000", 10); // default 5 min
const AGENT_IDS = ["skippy", "mando", "walle", "doc-brown"];

let tickCount = 0;

async function runHeartbeatCycle() {
  tickCount++;
  const start = Date.now();
  console.log(`\n🫀 Heartbeat #${tickCount} @ ${new Date().toISOString()}`);

  try {
    const workflow = mastra.getWorkflow("arena-heartbeat");
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: { agentIds: AGENT_IDS },
    });

    const elapsed = Date.now() - start;

    if (result.status === "success") {
      const output = result.result as { commentary: string; shouldPublish: boolean };
      console.log(`✅ Cycle complete in ${elapsed}ms`);
      console.log(output.commentary);
      if (output.shouldPublish) {
        console.log(`📢 Publishing commentary to Farcaster...`);
        // In production: call marvin agent to post commentary
        // const marvin = mastra.getAgent("marvin");
        // await marvin.generate(`Post this arena update to Farcaster: ${output.commentary}`);
      }
    } else {
      console.error(`❌ Cycle failed:`, result);
    }
  } catch (err) {
    console.error(`❌ Heartbeat error:`, err);
  }
}

// Initial run
runHeartbeatCycle();

// Schedule recurring
const timer = setInterval(runHeartbeatCycle, INTERVAL);

console.log(`🏟️ Arena Scheduler started`);
console.log(`   Interval: ${INTERVAL / 1000}s`);
console.log(`   Agents: ${AGENT_IDS.join(", ")}`);
console.log(`   Press Ctrl+C to stop\n`);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Scheduler stopping...");
  clearInterval(timer);
  process.exit(0);
});
