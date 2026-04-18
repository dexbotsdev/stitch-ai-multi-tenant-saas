import { Redis } from '@upstash/redis';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const MAIN_QUEUE = 'stitch:job_queue';
const PROCESSING_QUEUE = 'stitch:processing_queue';

async function flushQueues() {
  console.log('🧹 Flushing Redis job queues...');
  try {
    const mainLen = await redis.llen(MAIN_QUEUE);
    const procLen = await redis.llen(PROCESSING_QUEUE);
    
    await redis.del(MAIN_QUEUE);
    await redis.del(PROCESSING_QUEUE);
    
    console.log(`✅ Success! Deleted ${mainLen} jobs from main queue and ${procLen} from processing queue.`);
  } catch (err) {
    console.error('❌ Failed to flush Redis:', err);
  }
}

flushQueues();
