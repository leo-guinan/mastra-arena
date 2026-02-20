import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const API_URL = process.env.FARCASTER_API_URL || "https://post.metaspn.network/v1";
const API_KEY = process.env.FARCASTER_API_KEY || "";

async function farcasterRequest(endpoint: string, method: string, body?: Record<string, unknown>) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Farcaster API ${res.status}: ${text}`);
  }
  return res.json();
}

export const postCast = createTool({
  id: "post-cast",
  description: "Post a cast (message) to Farcaster",
  inputSchema: z.object({
    text: z.string().max(1024).describe("Cast text content"),
    parentHash: z.string().optional().describe("Parent cast hash for replies"),
    parentUrl: z.string().optional().describe("Channel URL for posting to a channel"),
  }),
  outputSchema: z.object({
    hash: z.string(),
    message: z.string(),
  }),
  execute: async ({ text, parentHash, parentUrl }) => {
    const body: Record<string, unknown> = { text };
    if (parentHash) body.parent = parentHash;
    if (parentUrl) body.parentUrl = parentUrl;
    const data = await farcasterRequest("/cast", "POST", body) as { hash: string };
    return { hash: data.hash, message: "Cast posted" };
  },
});

export const postThread = createTool({
  id: "post-thread",
  description: "Post a thread of multiple casts to Farcaster, each replying to the previous",
  inputSchema: z.object({
    casts: z.array(z.string().max(1024)).min(1).max(20).describe("Array of cast texts, posted as a thread"),
    channelUrl: z.string().optional().describe("Channel URL for the first cast"),
  }),
  outputSchema: z.object({
    hashes: z.array(z.string()),
    count: z.number(),
    message: z.string(),
  }),
  execute: async ({ casts, channelUrl }) => {
    const hashes: string[] = [];
    for (let i = 0; i < casts.length; i++) {
      const body: Record<string, unknown> = { text: casts[i] };
      if (i === 0 && channelUrl) body.parentUrl = channelUrl;
      if (i > 0) body.parent = hashes[i - 1];
      const data = await farcasterRequest("/cast", "POST", body) as { hash: string };
      hashes.push(data.hash);
      // Small delay between casts to avoid rate limits
      if (i < casts.length - 1) await new Promise((r) => setTimeout(r, 2000));
    }
    return { hashes, count: hashes.length, message: `Thread posted: ${hashes.length} casts` };
  },
});

export const getNotifications = createTool({
  id: "get-farcaster-notifications",
  description: "Get recent Farcaster notifications (likes, recasts, replies, mentions)",
  inputSchema: z.object({
    limit: z.number().min(1).max(50).default(10),
  }),
  outputSchema: z.object({
    notifications: z.array(z.object({
      type: z.string(),
      from: z.string(),
      text: z.string().optional(),
      hash: z.string().optional(),
      timestamp: z.string(),
    })),
  }),
  execute: async ({ limit }) => {
    const data = await farcasterRequest(`/notifications?limit=${limit}`, "GET") as {
      notifications: Array<{ type: string; actor: { username: string }; content?: { text?: string; hash?: string }; timestamp: string }>;
    };
    return {
      notifications: (data.notifications || []).map((n) => ({
        type: n.type,
        from: n.actor?.username || "unknown",
        text: n.content?.text,
        hash: n.content?.hash,
        timestamp: n.timestamp,
      })),
    };
  },
});

export const searchCasts = createTool({
  id: "search-casts",
  description: "Search for casts on Farcaster by keyword",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    limit: z.number().min(1).max(25).default(10),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      hash: z.string(),
      author: z.string(),
      text: z.string(),
      timestamp: z.string(),
      likes: z.number(),
      recasts: z.number(),
    })),
  }),
  execute: async ({ query, limit }) => {
    const data = await farcasterRequest(`/search?q=${encodeURIComponent(query)}&limit=${limit}`, "GET") as {
      casts: Array<{ hash: string; author: { username: string }; text: string; timestamp: string; reactions?: { likes: number; recasts: number } }>;
    };
    return {
      results: (data.casts || []).map((c) => ({
        hash: c.hash,
        author: c.author?.username || "unknown",
        text: c.text,
        timestamp: c.timestamp,
        likes: c.reactions?.likes || 0,
        recasts: c.reactions?.recasts || 0,
      })),
    };
  },
});

export const farcasterTools = {
  "post-cast": postCast,
  "post-thread": postThread,
  "get-farcaster-notifications": getNotifications,
  "search-casts": searchCasts,
};
