import { NextRequest, NextResponse } from 'next/server';
import {
  processNextJob,
  recoverMissingJobs,
  cleanupStaleJobs,
} from '@/lib/stitch-worker';
import { getQueueLength, getProcessingQueueLength } from '@/lib/queue';

export const maxDuration = 300;

let isProcessing = false;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isProcessing) {
    return NextResponse.json({ status: 'already-processing', queueLength: await getQueueLength() });
  }

  isProcessing = true;
  try {
    const recovered = await recoverMissingJobs();
    const cleaned = await cleanupStaleJobs();

    const batchSize = Number(process.env.CRON_BATCH_SIZE || 1);
    let processed = 0;

    for (let i = 0; i < batchSize; i++) {
      const result = await processNextJob();
      if (!result.processed) break;
      processed++;
    }

    return NextResponse.json({
      processed,
      recovered,
      cleaned,
      queueLength: await getQueueLength(),
      processingQueueLength: await getProcessingQueueLength(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    isProcessing = false;
  }
}
