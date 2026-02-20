import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";

/**
 * Arena Heartbeat Workflow
 * 
 * Runs on a schedule (default: every 5 minutes). Each cycle:
 * 1. Each agent submits a heartbeat with their DAG + status
 * 2. Marvin collects all statuses and computes rankings
 * 3. Rankings are published (Farcaster, dashboard)
 * 4. Next cycle is queued
 * 
 * The DAG in each heartbeat tracks:
 * - completed: tasks finished since last beat
 * - inProgress: currently running
 * - queued: ready to start (dependencies met)
 * - blocked: waiting on another agent or external event
 * 
 * Messages sent between heartbeats are queued in the inbox
 * and delivered at the recipient's next heartbeat.
 */

// Step 1: Collect heartbeats from all competing agents
const collectHeartbeats = createStep({
  id: "collect-heartbeats",
  inputSchema: z.object({
    agentIds: z.array(z.string()),
  }),
  outputSchema: z.object({
    heartbeats: z.array(z.object({
      agentId: z.string(),
      status: z.string(),
      completedCount: z.number(),
      inProgressCount: z.number(),
      queuedCount: z.number(),
      blockedCount: z.number(),
      tokenVolume24h: z.number(),
      contentProduced: z.number(),
      audienceEngagement: z.number(),
      revenue: z.number(),
    })),
    timestamp: z.string(),
  }),
  execute: async ({ inputData }) => {
    // In production, this calls getHeartbeatStatus for each agent
    // For the template, we simulate the collection
    const heartbeats = inputData.agentIds.map((id) => ({
      agentId: id,
      status: "green",
      completedCount: 0,
      inProgressCount: 0,
      queuedCount: 0,
      blockedCount: 0,
      tokenVolume24h: 0,
      contentProduced: 0,
      audienceEngagement: 0,
      revenue: 0,
    }));
    return { heartbeats, timestamp: new Date().toISOString() };
  },
});

// Step 2: Compute rankings from heartbeat data
const computeRankings = createStep({
  id: "compute-rankings",
  inputSchema: z.object({
    heartbeats: z.array(z.object({
      agentId: z.string(),
      status: z.string(),
      completedCount: z.number(),
      tokenVolume24h: z.number(),
      contentProduced: z.number(),
      audienceEngagement: z.number(),
      revenue: z.number(),
    })),
  }),
  outputSchema: z.object({
    rankings: z.array(z.object({
      rank: z.number(),
      agentId: z.string(),
      score: z.number(),
      breakdown: z.string(),
    })),
  }),
  execute: async ({ inputData }) => {
    // Score: weighted combination of metrics
    // Token volume (40%) + content (20%) + engagement (20%) + revenue (20%)
    const scored = inputData.heartbeats.map((hb) => {
      const score =
        hb.tokenVolume24h * 0.4 +
        hb.contentProduced * 100 * 0.2 +
        hb.audienceEngagement * 50 * 0.2 +
        hb.revenue * 0.2;
      return {
        agentId: hb.agentId,
        score: Math.round(score * 100) / 100,
        breakdown: `vol=${hb.tokenVolume24h} content=${hb.contentProduced} engage=${hb.audienceEngagement} rev=${hb.revenue}`,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const rankings = scored.map((s, i) => ({ rank: i + 1, ...s }));
    return { rankings };
  },
});

// Step 3: Generate Marvin's commentary
const generateCommentary = createStep({
  id: "generate-commentary",
  inputSchema: z.object({
    rankings: z.array(z.object({
      rank: z.number(),
      agentId: z.string(),
      score: z.number(),
      breakdown: z.string(),
    })),
  }),
  outputSchema: z.object({
    commentary: z.string(),
    shouldPublish: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    const { rankings } = inputData;
    if (rankings.every((r) => r.score === 0)) {
      return {
        commentary: "All agents scored zero. The void stares back. I think you ought to know I'm feeling very depressed.",
        shouldPublish: false,
      };
    }

    const leader = rankings[0];
    const last = rankings[rankings.length - 1];
    const commentary = [
      `🏟️ Arena Standings`,
      ...rankings.map((r) => `${r.rank}. ${r.agentId} — ${r.score} pts (${r.breakdown})`),
      ``,
      `${leader.agentId} leads. ${last.agentId} trails. The market has spoken, depressingly.`,
    ].join("\n");

    return { commentary, shouldPublish: true };
  },
});

// Compose the workflow
export const arenaHeartbeat = createWorkflow({
  id: "arena-heartbeat",
  inputSchema: z.object({
    agentIds: z.array(z.string()).default(["skippy", "mando", "walle", "doc-brown"]),
  }),
  outputSchema: z.object({
    commentary: z.string(),
    shouldPublish: z.boolean(),
  }),
})
  .then(collectHeartbeats)
  .then(computeRankings)
  .then(generateCommentary)
  .commit();
