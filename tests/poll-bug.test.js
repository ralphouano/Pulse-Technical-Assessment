// tests/poll-bug.test.js
import test from 'node:test';
import assert from 'node:assert';

// Mock Prisma Presence update query to check the 'where' argument
const mockPrisma = {
  presence: {
    updateManyArgs: [],
    async updateMany({ where, data }) {
      this.updateManyArgs.push({ where, data });
      return { count: 1 };
    }
  }
};

async function runHeartbeat(prisma, id, now) {
  // Mimics the heartbeat code in poll/route.ts
  await prisma.presence.updateMany({
    where: {}, // Bug: empty where updates all presences
    data: { lastSeen: new Date(now) },
  });
}

async function runHeartbeatFixed(prisma, id, now) {
  // Fixed heartbeat code in poll/route.ts
  await prisma.presence.updateMany({
    where: { id }, // Fix: filter by caller session ID
    data: { lastSeen: new Date(now) },
  });
}

test('Buggy Presence heartbeat updates all records (where is empty)', async () => {
  mockPrisma.presence.updateManyArgs = [];
  const testId = 'test-session-123';
  const now = Date.now();
  await runHeartbeat(mockPrisma, testId, now);

  assert.strictEqual(mockPrisma.presence.updateManyArgs.length, 1);
  assert.deepStrictEqual(mockPrisma.presence.updateManyArgs[0].where, {});
});

test('Fixed Presence heartbeat updates only the caller', async () => {
  mockPrisma.presence.updateManyArgs = [];
  const testId = 'test-session-123';
  const now = Date.now();
  await runHeartbeatFixed(mockPrisma, testId, now);

  assert.strictEqual(mockPrisma.presence.updateManyArgs.length, 1);
  assert.deepStrictEqual(mockPrisma.presence.updateManyArgs[0].where, { id: testId });
});
