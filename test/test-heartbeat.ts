import { heartbeatTools } from '../src/tools/heartbeat.js';

async function main() {
  console.log("=== TEST: Heartbeat Tools ===\n");

  // Test 1: Submit heartbeat for skippy
  console.log("1. Skippy heartbeat with completed work...");
  const hb = heartbeatTools['heartbeat'];
  const r1 = await hb.execute({
    agentId: 'skippy',
    completed: [{ id: 'research-1', name: 'Cohort MC analysis', result: '7 tokens tracked' }],
    inProgress: [{ id: 'research-2', name: 'Prediction accuracy audit' }],
    queued: [{ id: 'research-3', name: 'Weekly briefing', dependsOn: ['research-2'] }],
    blocked: [],
    status: 'green',
    metrics: { tokenVolume24h: 0, contentProduced: 1, audienceEngagement: 0, revenue: 0 },
  });
  console.log(`   ✅ Acknowledged: ${r1.acknowledged} | Inbox: ${r1.inbox.length} msgs | Next beat: ${r1.nextBeatIn}ms`);

  // Test 2: Send message to skippy
  console.log("\n2. Marvin sends message to Skippy...");
  const send = heartbeatTools['send-heartbeat-message'];
  const r2 = await send.execute({
    from: 'marvin',
    to: 'skippy',
    text: 'Your research is insufficiently depressing. Add more error rates.',
  });
  console.log(`   ✅ ${r2.message}`);

  // Test 3: Skippy's next heartbeat should receive the message
  console.log("\n3. Skippy heartbeat #2 (should receive message)...");
  const r3 = await hb.execute({
    agentId: 'skippy',
    completed: [{ id: 'research-2', name: 'Prediction accuracy audit', result: '62% accurate' }],
    inProgress: [{ id: 'research-3', name: 'Weekly briefing' }],
    queued: [],
    blocked: [],
    status: 'green',
  });
  console.log(`   ✅ Inbox: ${r3.inbox.length} msg(s)`);
  if (r3.inbox.length > 0) {
    console.log(`      From: ${r3.inbox[0].from} — "${r3.inbox[0].text}"`);
  }

  // Test 4: Get all agent statuses
  console.log("\n4. Get all heartbeat statuses...");
  const status = heartbeatTools['get-heartbeat-status'];
  const r4 = await status.execute({});
  console.log(`   ✅ ${r4.agents.length} agent(s) reporting:`);
  for (const a of r4.agents) {
    console.log(`      ${a.agentId}: ${a.status} | done=${a.completedTasks} in-progress=${a.inProgressTasks} queued=${a.queuedTasks}`);
  }

  console.log("\n=== HEARTBEAT TESTS COMPLETE ===");
}

main().catch(console.error);
