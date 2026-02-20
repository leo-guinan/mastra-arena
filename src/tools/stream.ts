import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { execSync, spawn, ChildProcess } from "child_process";
import * as fs from "fs";

const activeStreams = new Map<string, ChildProcess>();

export const createStream = createTool({
  id: "create-stream",
  description: "Start an RTMP stream to pump.fun or YouTube",
  inputSchema: z.object({
    agentId: z.string(),
    platform: z.enum(["pumpfun", "youtube"]),
    rtmpUrl: z.string().describe("Full RTMP URL including stream key"),
    source: z.string().describe("Path to video/image file"),
    audioSource: z.string().optional().describe("Path to audio or 'tts:text'"),
  }),
  outputSchema: z.object({ pid: z.number(), status: z.string() }),
  execute: async ({ agentId, rtmpUrl, source, audioSource }) => {
    const existing = activeStreams.get(agentId);
    if (existing && !existing.killed) existing.kill("SIGTERM");

    const inputArgs: string[] = [];
    if (source.match(/\.(png|jpg|jpeg|gif)$/i)) {
      inputArgs.push("-loop", "1", "-i", source);
    } else {
      inputArgs.push("-re", "-i", source);
    }

    if (audioSource?.startsWith("tts:")) {
      const text = audioSource.slice(4);
      const tmpAudio = `/tmp/stream-tts-${agentId}.mp3`;
      execSync(`say -o ${tmpAudio} --data-format=LEF32@22050 "${text.replace(/"/g, '\\"')}" 2>/dev/null || true`);
      if (fs.existsSync(tmpAudio)) inputArgs.push("-i", tmpAudio);
    } else if (audioSource) {
      inputArgs.push("-i", audioSource);
    }

    const proc = spawn("ffmpeg", [
      ...inputArgs,
      "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
      "-b:v", "2500k", "-maxrate", "2500k", "-bufsize", "5000k",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
      "-f", "flv", rtmpUrl,
    ], { stdio: "ignore", detached: true });
    proc.unref();
    activeStreams.set(agentId, proc);
    return { pid: proc.pid!, status: "streaming" };
  },
});

export const observeStream = createTool({
  id: "observe-stream",
  description: "Check if an agent's stream is running",
  inputSchema: z.object({ agentId: z.string() }),
  outputSchema: z.object({ running: z.boolean(), pid: z.number().optional() }),
  execute: async ({ agentId }) => {
    const proc = activeStreams.get(agentId);
    if (!proc || proc.killed) return { running: false };
    try { process.kill(proc.pid!, 0); return { running: true, pid: proc.pid! }; }
    catch { return { running: false }; }
  },
});

export const killStream = createTool({
  id: "kill-stream",
  description: "Stop an agent's active stream",
  inputSchema: z.object({ agentId: z.string() }),
  outputSchema: z.object({ killed: z.boolean(), message: z.string() }),
  execute: async ({ agentId }) => {
    const proc = activeStreams.get(agentId);
    if (!proc || proc.killed) return { killed: false, message: "No active stream" };
    proc.kill("SIGTERM");
    activeStreams.delete(agentId);
    return { killed: true, message: "Stream terminated" };
  },
});

export const streamTools = {
  "create-stream": createStream,
  "observe-stream": observeStream,
  "kill-stream": killStream,
};
