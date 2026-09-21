import assert from 'node:assert/strict';
import test from 'node:test';
import { attemptDeviceCleanup } from '../src/lib/deviceCleanup.ts';

test('successful cleanup reports success', async () => {
  let calls = 0;
  const result = await attemptDeviceCleanup(async () => { calls += 1; });
  assert.equal(result, true);
  assert.equal(calls, 1);
});

test('rejected, timed-out, and blocked cleanup reports failure', async () => {
  assert.equal(await attemptDeviceCleanup(async () => { throw new Error('rejected'); }), false);
  assert.equal(await attemptDeviceCleanup(async () => new Promise((_, reject) => {
    setTimeout(() => reject(new Error('timeout')), 0);
  })), false);
  assert.equal(await attemptDeviceCleanup(async () => { throw new Error('blocked'); }), false);
});

test('retry succeeds without repeating a server lifecycle request', async () => {
  let cleanupCalls = 0;
  const serverRequests = 0;
  const cleanup = async () => {
    cleanupCalls += 1;
    if (cleanupCalls === 1) throw new Error('blocked');
  };

  assert.equal(await attemptDeviceCleanup(cleanup), false);
  assert.equal(await attemptDeviceCleanup(cleanup), true);
  assert.equal(await attemptDeviceCleanup(cleanup), true);
  assert.equal(cleanupCalls, 3);
  assert.equal(serverRequests, 0);
});
