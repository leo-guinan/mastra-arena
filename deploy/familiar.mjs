#!/usr/bin/env node
/**
 * Arena Familiar — Event-driven agent wake system
 * Based on familiard by Liet (https://github.com/liet-codes/familiard)
 * 
 * Instead of polling heartbeats that burn tokens, the familiar:
 * 1. Watches blockchain events, API changes, Farcaster mentions
 * 2. Classifies with a local model (ollama) or simple rules
 * 3. Only wakes the right agent when something actually matters
 * 
 * BEFORE: 5 agents × heartbeat every 5min = 1,440 LLM calls/day = $$$
 * AFTER:  familiar watches continuously, ~10-20 escalations/day = $
 */

import http from 'http';
import fs from 'fs';

const ARENA_URL = process.env.ARENA_URL || 'http://localhost';
const ARENA_KEY = process.env.ARENA_API_KEY || '';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b-instruct';
const INTERVAL = parseInt(process.env.INTERVAL_MS || '60000');
const JOURNAL_DIR = process.env.JOURNAL_DIR || '/opt/arena/journal';
const CONFIG_FILE = process.env.CONFIG_FILE || '/opt/arena/familiar.yaml';

// Ensure journal dir
if (!fs.existsSync(JOURNAL_DIR)) fs.mkdirSync(JOURNAL_DIR, { recursive: true });

// Agent routing rules — which agent handles what
const ROUTING = {
  // Token price moves
  'price_move': { agent: 'skippy', port: 4001, threshold: 'any price move >10% in tracked tokens' },
  // New holder detected
  'new_holder': { agent: 'skippy', port: 4001, threshold: 'new wallet appears in top 20 holders' },
  // Revenue event
  'payment': { agent: 'mando', port: 4002, threshold: 'any Stripe payment or token transfer to arena wallet' },
  // Farcaster mention
  'farcaster_mention': { agent: 'marvin', port: 4005, threshold: 'someone mentions @hitchhikerglitch or replies to our casts' },
  // Infrastructure alert
  'service_down': { agent: 'walle', port: 4003, threshold: 'any arena agent /health returns non-200' },
  // Prediction deadline
  'prediction_due': { agent: 'doc-brown', port: 4004, threshold: 'Friday arrives and predictions need grading' },
  // Wallet deposit
  'wallet_deposit': { agent: 'marvin', port: 4005, threshold: 'any new token arrives at arena wallet' },
};

// Event sources — what we watch
const WATCHERS = {
  // Check DexScreener for price moves
  async priceWatch() {
    const tokens = [
      { mint: 'Ak9ptp86tfJMrKwBwoe49pNkHxPjZk8GRQxZKB78pump', name: 'TOWEL' },
    ];
    const events = [];
    for (const t of tokens) {
      try {
        const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${t.mint}`);
        const j = await r.json();
        if (j.pairs?.[0]) {
          const p = j.pairs[0];
          const change = Math.abs(parseFloat(p.priceChange?.h1 || '0'));
          if (change > 10) {
            events.push({
              type: 'price_move',
              source: `dexscreener/${t.name}`,
              summary: `${t.name} moved ${p.priceChange.h1}% in 1h (now $${p.priceUsd})`,
              data: { token: t.name, change: p.priceChange.h1, price: p.priceUsd, mc: p.marketCap }
            });
          }
        }
      } catch (e) { /* silent */ }
    }
    return events;
  },

  // Check arena wallet for new deposits
  async walletWatch() {
    const WALLET = 'DorNUZdD3kjA6cC8HrVznGn8UyScWDuUMxj1WiU8aAqD';
    const stateFile = '/tmp/familiar-wallet-state.json';
    let lastBalance = 0;
    try { lastBalance = JSON.parse(fs.readFileSync(stateFile, 'utf8')).sol || 0; } catch {}

    try {
      const r = await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [WALLET] })
      });
      const j = await r.json();
      const sol = j.result?.value / 1e9 || 0;
      
      if (sol > lastBalance + 0.001) {
        fs.writeFileSync(stateFile, JSON.stringify({ sol }));
        return [{
          type: 'wallet_deposit',
          source: 'solana/arena-wallet',
          summary: `+${(sol - lastBalance).toFixed(4)} SOL received (total: ${sol.toFixed(4)})`,
          data: { sol, diff: sol - lastBalance }
        }];
      }
      fs.writeFileSync(stateFile, JSON.stringify({ sol }));
    } catch {}
    return [];
  },

  // Check agent health
  async healthWatch() {
    const events = [];
    const agents = [
      { id: 'skippy', port: 4001 },
      { id: 'mando', port: 4002 },
      { id: 'walle', port: 4003 },
      { id: 'doc-brown', port: 4004 },
      { id: 'marvin', port: 4005 },
    ];
    for (const a of agents) {
      try {
        const r = await fetch(`http://localhost:${a.port}/health`, {
          headers: { 'Authorization': `Bearer ${ARENA_KEY}` },
          signal: AbortSignal.timeout(5000)
        });
        if (!r.ok) {
          events.push({
            type: 'service_down',
            source: `arena/${a.id}`,
            summary: `Agent ${a.id} returned ${r.status}`,
            data: { agent: a.id, status: r.status }
          });
        }
      } catch (e) {
        events.push({
          type: 'service_down',
          source: `arena/${a.id}`,
          summary: `Agent ${a.id} unreachable: ${e.message}`,
          data: { agent: a.id, error: e.message }
        });
      }
    }
    return events;
  },

  // Check Farcaster notifications
  async farcasterWatch() {
    try {
      const r = await fetch('https://post.metaspn.network/v1/notifications', {
        headers: { 'Authorization': 'Bearer 1df38151f2fdc99f9786816956b15d7c469a75577c7f771b' }
      });
      if (!r.ok) return [];
      const j = await r.json();
      // Check for new notifications since last check
      const stateFile = '/tmp/familiar-fc-state.json';
      let lastCheck = 0;
      try { lastCheck = JSON.parse(fs.readFileSync(stateFile, 'utf8')).lastCheck || 0; } catch {}
      
      const events = [];
      const notifications = j.notifications || j.data || [];
      const newNotifs = notifications.filter(n => (n.timestamp || 0) > lastCheck);
      
      if (newNotifs.length > 0) {
        events.push({
          type: 'farcaster_mention',
          source: 'farcaster/notifications',
          summary: `${newNotifs.length} new Farcaster notification(s)`,
          data: { count: newNotifs.length, latest: newNotifs[0] }
        });
      }
      
      fs.writeFileSync(stateFile, JSON.stringify({ lastCheck: Date.now() }));
      return events;
    } catch { return []; }
  },
};

// Classify event — use ollama if available, otherwise use rules
async function classify(event) {
  // Simple rule-based classification (no LLM needed for clear signals)
  if (event.type === 'service_down') return { action: 'escalate', confidence: 1.0 };
  if (event.type === 'wallet_deposit') return { action: 'escalate', confidence: 1.0 };
  if (event.type === 'payment') return { action: 'escalate', confidence: 1.0 };
  
  // For ambiguous events, try ollama
  try {
    const r = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: `Classify this event for an AI agent monitoring crypto tokens and blockchain activity. Respond with ONLY one word: ignore, log, or escalate.\n\nEvent: ${event.summary}\nSource: ${event.source}\n\nClassification:`,
        stream: false,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    const response = (j.response || '').toLowerCase().trim();
    
    if (response.includes('escalate')) return { action: 'escalate', confidence: 0.8 };
    if (response.includes('log')) return { action: 'log', confidence: 0.8 };
    return { action: 'ignore', confidence: 0.6 };
  } catch {
    // No ollama? Rule-based fallback — escalate price moves, log everything else
    if (event.type === 'price_move') return { action: 'escalate', confidence: 0.7 };
    if (event.type === 'farcaster_mention') return { action: 'escalate', confidence: 0.7 };
    return { action: 'log', confidence: 0.5 };
  }
}

// Journal an event
function journal(event, classification) {
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toISOString().split('T')[1].slice(0, 5);
  const icon = classification.action === 'escalate' ? '🔴' : classification.action === 'log' ? '📝' : '⚪';
  const line = `${time} ${icon} [${event.source}] ${event.summary}\n`;
  
  fs.appendFileSync(`${JOURNAL_DIR}/${date}.md`, line);
  return line;
}

// Escalate to the right agent
async function escalate(event) {
  const route = ROUTING[event.type];
  if (!route) return;
  
  const url = `${ARENA_URL}:${route.port}/heartbeat`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ARENA_KEY}`,
      },
      body: JSON.stringify({
        trigger: event.type,
        summary: event.summary,
        data: event.data,
        source: 'familiar',
      }),
      signal: AbortSignal.timeout(30000),
    });
    console.log(`  → Escalated to ${route.agent}: ${r.status}`);
  } catch (e) {
    console.error(`  → Failed to escalate to ${route.agent}: ${e.message}`);
  }
}

// Main loop
async function tick() {
  const allEvents = [];
  
  for (const [name, watcher] of Object.entries(WATCHERS)) {
    try {
      const events = await watcher();
      allEvents.push(...events);
    } catch (e) {
      console.error(`Watcher ${name} error:`, e.message);
    }
  }
  
  for (const event of allEvents) {
    const classification = await classify(event);
    const entry = journal(event, classification);
    process.stdout.write(entry);
    
    if (classification.action === 'escalate') {
      await escalate(event);
    }
  }
  
  if (allEvents.length === 0) {
    // Silent tick — nothing happened
  }
}

// Health endpoint
const PORT = parseInt(process.env.FAMILIAR_PORT || '4010');
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'familiar',
      uptime: process.uptime(),
      watchers: Object.keys(WATCHERS),
      routing: Object.fromEntries(Object.entries(ROUTING).map(([k, v]) => [k, v.agent])),
    }));
  } else if (req.url === '/journal') {
    const date = new Date().toISOString().split('T')[0];
    const file = `${JOURNAL_DIR}/${date}.md`;
    const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'No entries today.';
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(content);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  const mem = process.memoryUsage();
  console.log(`[familiar] Arena event daemon on port ${PORT} (RSS: ${Math.round(mem.rss / 1048576)}MB)`);
  console.log(`[familiar] Watchers: ${Object.keys(WATCHERS).join(', ')}`);
  console.log(`[familiar] Interval: ${INTERVAL / 1000}s`);
  console.log(`[familiar] Journal: ${JOURNAL_DIR}`);
  
  // First tick immediately
  tick();
  // Then on interval
  setInterval(tick, INTERVAL);
});
