import { createTool } from "@mastra/core/tools";
import { z } from "zod";

interface CronJob {
  id: string; agentId: string; name: string; intervalMs: number;
  command: string; status: "active" | "paused" | "killed";
  lastRun: number | null; nextRun: number; runCount: number;
  timer?: ReturnType<typeof setInterval>;
}

const jobs = new Map<string, CronJob>();

export const scheduleCron = createTool({
  id: "schedule-cron",
  description: "Schedule a recurring task for an agent",
  inputSchema: z.object({
    agentId: z.string(),
    name: z.string().describe("Human-readable job name"),
    intervalMinutes: z.number().min(1),
    command: z.string().describe("Shell command or action to execute"),
  }),
  outputSchema: z.object({ jobId: z.string(), name: z.string(), intervalMinutes: z.number(), nextRun: z.string() }),
  execute: async ({ agentId, name, intervalMinutes, command }) => {
    const jobId = `${agentId}-${name.replace(/\s+/g, "-").toLowerCase()}-${Date.now().toString(36)}`;
    const intervalMs = intervalMinutes * 60 * 1000;
    const job: CronJob = {
      id: jobId, agentId, name, intervalMs, command,
      status: "active", lastRun: null, nextRun: Date.now() + intervalMs, runCount: 0,
    };
    job.timer = setInterval(() => {
      if (job.status !== "active") return;
      job.lastRun = Date.now(); job.runCount++; job.nextRun = Date.now() + intervalMs;
      console.log(`[CRON] ${job.agentId}/${job.name} run #${job.runCount}: ${job.command}`);
    }, intervalMs);
    jobs.set(jobId, job);
    return { jobId, name, intervalMinutes, nextRun: new Date(job.nextRun).toISOString() };
  },
});

export const listCrons = createTool({
  id: "list-crons",
  description: "List all cron jobs for an agent",
  inputSchema: z.object({ agentId: z.string() }),
  outputSchema: z.object({
    jobs: z.array(z.object({
      jobId: z.string(), name: z.string(), status: z.string(),
      intervalMinutes: z.number(), runCount: z.number(),
      lastRun: z.string().nullable(), nextRun: z.string(),
    })),
  }),
  execute: async ({ agentId }) => ({
    jobs: Array.from(jobs.values()).filter((j) => j.agentId === agentId).map((j) => ({
      jobId: j.id, name: j.name, status: j.status,
      intervalMinutes: j.intervalMs / 60000, runCount: j.runCount,
      lastRun: j.lastRun ? new Date(j.lastRun).toISOString() : null,
      nextRun: new Date(j.nextRun).toISOString(),
    })),
  }),
});

export const manageCron = createTool({
  id: "manage-cron",
  description: "Pause, resume, or kill a cron job",
  inputSchema: z.object({ jobId: z.string(), action: z.enum(["pause", "resume", "kill"]) }),
  outputSchema: z.object({ jobId: z.string(), status: z.string(), message: z.string() }),
  execute: async ({ jobId, action }) => {
    const job = jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (action === "kill") { job.status = "killed"; if (job.timer) clearInterval(job.timer); jobs.delete(jobId); }
    else job.status = action === "pause" ? "paused" : "active";
    return { jobId: job.id, status: job.status, message: `Job ${action}d` };
  },
});

export const cronTools = {
  "schedule-cron": scheduleCron,
  "list-crons": listCrons,
  "manage-cron": manageCron,
};
