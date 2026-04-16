import { stitch } from "@google/stitch-sdk";

async function main() {
  try {
    const project = await stitch.createProject("test-project");
    
    // Testing default model ID ("" or undef)
    const raw = await project.client.callTool("generate_screen_from_text", {
      projectId: project.id,
      prompt: "A modern coffee shop landing page with warm colors, a hero section, menu showcase, and contact form",
      deviceType: "DESKTOP"
    });
    
    console.log("RAW_OUT:", JSON.stringify(raw));

  } catch (err) {
    console.log("ERR_OUT:", err?.message || err);
  }
}
main();
