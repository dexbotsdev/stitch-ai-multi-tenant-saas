import { stitchService } from '../lib/stitch-service';
import dotenv from 'dotenv';
dotenv.config();

async function testConcurrency() {
  console.log("🚀 Testing concurrent connection attempts...");
  
  // Call ensureConnected 5 times simultaneously
  const results = await Promise.allSettled([
    (stitchService as unknown as { ensureConnected: () => Promise<void> }).ensureConnected(),
    (stitchService as unknown as { ensureConnected: () => Promise<void> }).ensureConnected(),
    (stitchService as unknown as { ensureConnected: () => Promise<void> }).ensureConnected(),
    (stitchService as unknown as { ensureConnected: () => Promise<void> }).ensureConnected(),
    (stitchService as unknown as { ensureConnected: () => Promise<void> }).ensureConnected()
  ]);

  results.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      console.log(`✅ Attempt ${i + 1}: Success`);
    } else {
      console.log(`❌ Attempt ${i + 1}: Failed - ${res.reason}`);
    }
  });

  await stitchService.disconnect();
  console.log("🏁 Concurrency test complete.");
}

testConcurrency().catch(console.error);
