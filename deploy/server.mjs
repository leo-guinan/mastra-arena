#!/usr/bin/env node
/**
 * Thin Agent API Server
 * 
 * Each agent runs as a lightweight HTTP server with:
 * - POST /ask — LLM-powered responses with tool access
 * - POST /tool/:name — direct tool execution (no LLM)
 * - GET /state — agent state
 * - POST /heartbeat — run heartbeat cycle
 * - GET /health — alive check
 * 
 * Usage: AGENT_ID=skippy PORT=4001 node server.mjs
 * 
 * RAM target: ~30-40MB per agent
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const AGENT_ID = process.env.AGENT_ID || 'marvin';
const PORT = parseInt(process.env.PORT || '4000');
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const ARENA_DIR = process.env.ARENA_DIR || '/opt/arena';
const AGENT_DIR = path.join(ARENA_DIR, 'agents', AGENT_ID);
const STATE_FILE = path.join(AGENT_DIR, 'state.json');

// Load soul
let SOUL = '';
try { SOUL = fs.readFileSync(path.join(AGENT_DIR, 'SOUL.md'), 'utf8'); }
catch { SOUL = `You are ${AGENT_ID}. Respond helpfully.`; }

// Pyramid memory integration
const PYRAMID_DIR = path.join(ARENA_DIR, 'pyramid');
const MEMORY_DIR = path.join(AGENT_DIR, 'memory');

function pyramidObserve(text) {
  try {
    execSync(
      `cd ${PYRAMID_DIR} && python3 cli.py internal observe -w ${MEMORY_DIR} "${text.replace(/"/g, '\\"').slice(0, 500)}"`,
      { timeout: 5000, stdio: 'pipe' }
    );
  } catch { /* silent — pyramid is optional enhancement */ }
}

function pyramidJournal() {
  const memFile = path.join(MEMORY_DIR, 'MEMORY.md');
  try { return fs.readFileSync(memFile, 'utf8'); }
  catch { return null; }
}

// Load/save state
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { created: new Date().toISOString(), heartbeats: 0, predictions: [], tasks: [] }; }
}
function saveState(state) { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }

// Tool registry — lazy-loaded to minimize startup RAM
const toolRegistry = {};

async function loadTools() {
  const toolDir = path.join(ARENA_DIR, 'shared', 'tools');
  if (!fs.existsSync(toolDir)) return;
  
  const files = fs.readdirSync(toolDir).filter(f => f.endsWith('.mjs'));
  for (const file of files) {
    try {
      const mod = await import(path.join(toolDir, file));
      const toolName = file.replace('.mjs', '');
      toolRegistry[toolName] = mod.default || mod.execute || mod;
    } catch (e) {
      console.error(`Failed to load tool ${file}:`, e.message);
    }
  }
}

// LLM call via OpenRouter
async function askLLM(prompt, tools = []) {
  if (!OPENROUTER_KEY) return { response: 'No OPENROUTER_API_KEY configured', toolsUsed: [] };
  
  const messages = [
    { role: 'system', content: SOUL },
    { role: 'user', content: prompt }
  ];
  
  const body = {
    model: 'anthropic/claude-sonnet-4.6',
    messages,
    max_tokens: 2048,
  };
  
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'HTTP-Referer': 'https://metaspn.network',
    },
    body: JSON.stringify(body),
  });
  
  const j = await r.json();
  const response = j.choices?.[0]?.message?.content || 'No response';
  return { response, model: j.model, usage: j.usage };
}

// HTTP handler
async function handler(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  
  // Auth check
  const authKey = process.env.ARENA_API_KEY;
  if (authKey) {
    const provided = req.headers.authorization?.replace('Bearer ', '');
    if (provided !== authKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
  }
  
  try {
    // GET /health
    if (url.pathname === '/health' && method === 'GET') {
      const mem = process.memoryUsage();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        agent: AGENT_ID,
        uptime: process.uptime(),
        memory: { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576) },
        tools: Object.keys(toolRegistry),
      }));
      return;
    }
    
    // GET /state
    if (url.pathname === '/state' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(loadState()));
      return;
    }
    
    // POST /ask
    if (url.pathname === '/ask' && method === 'POST') {
      const body = await readBody(req);
      const { prompt } = JSON.parse(body);
      const result = await askLLM(prompt);
      
      // Record observation in pyramid memory
      pyramidObserve(`Asked: ${prompt.slice(0, 200)} → Responded with ${result.response?.slice(0, 200) || 'no response'}`);
      
      // Update state
      const state = loadState();
      state.lastAsk = { prompt: prompt.slice(0, 100), time: new Date().toISOString() };
      saveState(state);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }
    
    // POST /tool/:name
    const toolMatch = url.pathname.match(/^\/tool\/(.+)$/);
    if (toolMatch && method === 'POST') {
      const toolName = toolMatch[1];
      const tool = toolRegistry[toolName];
      if (!tool) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Tool not found: ${toolName}`, available: Object.keys(toolRegistry) }));
        return;
      }
      
      const body = await readBody(req);
      const params = JSON.parse(body || '{}');
      const result = await (typeof tool === 'function' ? tool(params) : tool.execute(params));
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }
    
    // POST /heartbeat
    if (url.pathname === '/heartbeat' && method === 'POST') {
      const state = loadState();
      state.heartbeats = (state.heartbeats || 0) + 1;
      state.lastHeartbeat = new Date().toISOString();
      
      // Ask agent to report status
      const result = await askLLM(
        `Heartbeat #${state.heartbeats}. Current state: ${JSON.stringify(state)}. ` +
        `Report your status: what have you completed, what's in progress, what's blocked? ` +
        `Update any predictions or metrics. Be brief.`
      );
      
      state.lastStatus = result.response;
      saveState(state);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ heartbeat: state.heartbeats, status: result.response }));
      return;
    }
    
    // GET /memory — pyramid memory contents
    if (url.pathname === '/memory' && method === 'GET') {
      const memory = pyramidJournal();
      const modelsDir = path.join(MEMORY_DIR, 'models');
      let models = {};
      try {
        const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.md'));
        for (const f of files) {
          models[f.replace('.md', '')] = fs.readFileSync(path.join(modelsDir, f), 'utf8');
        }
      } catch {}
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ memory: memory || 'No memory yet. Run pyramid sync.', models }));
      return;
    }
    
    // POST /observe — manually add an observation
    if (url.pathname === '/observe' && method === 'POST') {
      const body = await readBody(req);
      const { observation } = JSON.parse(body);
      pyramidObserve(observation);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, observation: observation.slice(0, 100) }));
      return;
    }
    
    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', endpoints: ['GET /health', 'GET /state', 'GET /memory', 'POST /ask', 'POST /tool/:name', 'POST /heartbeat', 'POST /observe'] }));
    
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

// Start
await loadTools();
const server = http.createServer(handler);
server.listen(PORT, () => {
  const mem = process.memoryUsage();
  console.log(`[${AGENT_ID}] Arena agent API on port ${PORT} (RSS: ${Math.round(mem.rss / 1048576)}MB)`);
});
