import { stitch } from "@google/stitch-sdk";
import fs from 'fs';

async function debugCall() {
  const projectName = "debug-proj-" + Date.now();
  console.log(`🚀 Creating project ${projectName}...`);
  await (stitch as unknown as { ensureConnected: () => Promise<void> }).ensureConnected();
  const project = await (stitch as unknown as { createProject: (name: string) => Promise<{ id: string }> }).createProject(projectName);
  
  console.log(`🎨 Calling generate_screen_from_text directly...`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawRes = await (stitch as any).callTool("generate_screen_from_text", { 
    projectId: project.id, 
    prompt: "A simple landing page with a hero section", 
    deviceType: "DESKTOP" 
  });
  
  console.log('📦 Raw Response Keys:', Object.keys(rawRes));
  if (rawRes.outputComponents) {
     console.log('📦 outputComponents[0] keys:', Object.keys(rawRes.outputComponents[0]));
     if (rawRes.outputComponents[0].design) {
        console.log('📦 design keys:', Object.keys(rawRes.outputComponents[0].design));
        if (rawRes.outputComponents[0].design.screens) {
            console.log('📦 screen[0] keys:', Object.keys(rawRes.outputComponents[0].design.screens[0]));
            console.log('📦 screen[0].html:', JSON.stringify(rawRes.outputComponents[0].design.screens[0].html, null, 2));
        }
     }
  }

  // Write to file for deep inspection
  fs.writeFileSync('stitch_debug.json', JSON.stringify(rawRes, null, 2));
  console.log('✅ Debug data saved to stitch_debug.json');
}

debugCall().catch(console.error);
