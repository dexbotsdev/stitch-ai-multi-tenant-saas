import { stitch } from "@google/stitch-sdk";

async function main() {
  try {
    const project = await stitch.createProject("test-project");
    console.log("Created project:", project.id);
    const screen = await project.generate("Hello world", "DESKTOP", "GEMINI_3_PRO");
    console.log("Success:", screen.id);
  } catch (err: unknown) {
    const error = err as Error;
    console.error("Error from exact call:", error?.message || err);
    console.error(err);
  }
}
main();
