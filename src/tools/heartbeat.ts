import { createTool } from "@mastra/core/tools";
import { z } from "zod";

interface Task {
  id: string; name: string; status: "completed" | "in-progress" | "blocked" | "queued";
  dependsOn: string[]; completedAt?: number; result?: string;
}
interface Message { from: string; text: string; timestamp: number; replied: boolean; }
interface AgentState {
  agentId: string; intervalMs: number; lastBeat: number | null;
  dag: Task[]; inbox: Message[]; status: "green" | "yellow" | "red";
  metrics: { tokenVolume24h: number; contentProduced: number; audienceEngagement: number; revenue: number; };
}

const agents = new Map<string, AgentState>();

function getOrCreate(agentId: string): AgentState {
  if (!agents.has(agentId)) {
    agents.set(agentId, {
      agentId, intervalMs: 5 * 60 * 1000, lastBeat: null, dag: [], inbox: [],
      status: "green", metrics: { tokenVolume24h: 0, contentProduced: 0, audienceEngagement: 0, revenue: 0 },
    });
  }
  return agents.get(agentId)!;
}

export const heartbeatTool = createTool({
  id: "heartbeat",
  description: "Submit a heartbeat with DAG of work completed/remaining + status. Returns pending inbox messages.",
  inputSchema: z.object({
    agentId: z.string(),
    completed: z.array(z.object({ id: z.string(), name: z.string(), result: z.string().optional() })),
    inProgress: z.array(z.object({ id: z.string(), name: z.string() })),
    queued: z.array(z.object({ id: z.string(), name: z.string(), dependsOn: z.array(z.string()).default([]) })),
    blocked: z.array(z.object({ id: z.string(), name: z.string(), dependsOn: z.array(z.string()), reason: z.string().optional() })).default([]),
    status: z.enum(["green", "yellow", "red"]),
    metrics: z.object({
      tokenVolume24h: z.number().default(0), contentProduced: z.number().default(0),
      audienceEngagement: z.number().default(0), revenue: z.number().default(0),
    }).optional(),
  }),
  outputSchema: z.object({
    acknowledged: z.boolean(),
    inbox: z.array(z.object({ from: z.string(), text: z.string(), timestamp: z.number() })),
    nextBeatIn: z.number(),
  }),
  execute: async ({ agentId, completed, inProgress, queued, blocked, status, metrics }) => {
    const state = getOrCreate(agentId);
    state.lastBeat = Date.now();
    state.status = status;
    if (metrics) state.metrics = metrics;

    // Update DAG
    for (const t of completed) {
      const ex = state.dag.find((d) => d.id === t.id);
      if (ex) { ex.status = "completed"; ex.completedAt = Date.now(); ex.result = t.result; }
      else state.dag.push({ id: t.id, name: t.name, status: "completed", dependsOn: [], completedAt: Date.now(), result: t.result });
    }
    for (const t of inProgress) {
      const ex = state.dag.find((d) => d.id === t.id);
      if (ex) ex.status = "in-progress"; else state.dag.push({ id: t.id, name: t.name, status: "in-progress", dependsOn: [] });
    }
    for (const t of queued) {
      const ex = state.dag.find((d) => d.id === t.id);
      if (ex) { ex.status = "queued"; ex.dependsOn = t.dependsOn; }
      else state.dag.push({ id: t.id, name: t.name, status: "queued", dependsOn: t.dependsOn });
    }

    const pending = state.inbox.filter((m) => !m.replied);
    pending.forEach((m) => (m.replied = true));
    return {
      acknowledged: true,
      inbox: pending.map((m) => ({ from: m.from, text: m.text, timestamp: m.timestamp })),
      nextBeatIn: state.intervalMs,
    };
  },
});

export const sendMessageTool = createTool({
  id: "send-heartbeat-message",
  description: "Send a message to another agent, delivered at their next heartbeat",
  inputSchema: z.object({ from: z.string(), to: z.string(), text: z.string() }),
  outputSchema: z.object({ delivered: z.boolean(), message: z.string() }),
  execute: async ({ from, to, text }) => {
    const state = getOrCreate(to);
    state.inbox.push({ from, text, timestamp: Date.now(), replied: false });
    return { delivered: true, message: `Queued for ${to}, delivered at next heartbeat.` };
  },
});

export const getHeartbeatStatus = createTool({
  id: "get-heartbeat-status",
  description: "Get heartbeat state for all agents or a specific one",
  inputSchema: z.object({ agentId: z.string().optional() }),
  outputSchema: z.object({
    agents: z.array(z.object({
      agentId: z.string(), status: z.string(), lastBeat: z.number().nullable(),
      secondsSinceLastBeat: z.number().nullable(),
      completedTasks: z.number(), inProgressTasks: z.number(),
      queuedTasks: z.number(), blockedTasks: z.number(), pendingMessages: z.number(),
      metrics: z.object({ tokenVolume24h: z.number(), contentProduced: z.number(), audienceEngagement: z.number(), revenue: z.number() }),
    })),
  }),
  execute: async ({ agentId }) => {
    const targets = agentId ? [getOrCreate(agentId)] : Array.from(agents.values());
    return {
      agents: targets.map((a) => ({
        agentId: a.agentId, status: a.status, lastBeat: a.lastBeat,
        secondsSinceLastBeat: a.lastBeat ? Math.round((Date.now() - a.lastBeat) / 1000) : null,
        completedTasks: a.dag.filter((t) => t.status === "completed").length,
        inProgressTasks: a.dag.filter((t) => t.status === "in-progress").length,
        queuedTasks: a.dag.filter((t) => t.status === "queued").length,
        blockedTasks: a.dag.filter((t) => t.status === "blocked").length,
        pendingMessages: a.inbox.filter((m) => !m.replied).length,
        metrics: a.metrics,
      })),
    };
  },
});

export const heartbeatTools = {
  heartbeat: heartbeatTool,
  "send-heartbeat-message": sendMessageTool,
  "get-heartbeat-status": getHeartbeatStatus,
};
