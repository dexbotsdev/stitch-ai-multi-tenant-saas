import { stitchService } from "../lib/stitch-service";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  try {
    const res = await stitchService.generate(
      "test-project", 
      "a simple coffee shop landing page",
      "", // description
      "test-job-id",
      "test-worker-id",
      "test-execution-id"
    );
    console.log("Success:", res);
  } catch (err) {
    console.error("Error:", err);
  }
}
main();
