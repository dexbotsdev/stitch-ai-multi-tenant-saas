import { Redis } from "@upstash/redis";
import Database from 'better-sqlite3';

const redis = new Redis({
  url: "https://present-squirrel-89480.upstash.io",
  token: "gQAAAAAAAV2IAAIncDEwZDdmYTMzNmJmMDY0ODllOTUzMjZlNjQxNzc4NDkwOXAxODk0ODA",
});

async function resetAll() {
  console.log("Emptying Redis Queues...");
  await redis.del("stitch:job_queue", "stitch:processing_queue");

  console.log("Emptying SQLite Database...");
  const db = new Database('tenants.db');
  
  // Disable foreign keys temporarily for truncation
  db.exec("PRAGMA foreign_keys = OFF;");
  
  const tables = [
    'stitch_history',
    'job_metrics',
    'usage_tracking',
    'stitch_job_logs',
    'stitch_jobs_dead_letter',
    'audit_logs',
    'stitch_jobs',
    'tenants',
    'users'
  ];

  for (const table of tables) {
    try {
      db.exec(`DELETE FROM ${table};`);
      console.log(`- Cleared table: ${table}`);
    } catch (e) {
      console.log(`- Error clearing table ${table}:`, e.message);
    }
  }

  // Re-enable foreign keys
  db.exec("PRAGMA foreign_keys = ON;");
  
  console.log("Database reset complete!");
}

resetAll();
