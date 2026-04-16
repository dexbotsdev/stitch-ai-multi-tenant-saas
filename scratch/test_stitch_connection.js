// eslint-disable-next-line @typescript-eslint/no-require-imports
const { stitch } = require('@google/stitch-sdk');

console.log('Testing stitch.project() connection behavior...');
try {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _p = stitch.project("test-id");
  console.log('Project handle created.');
} catch (err) {
  console.error('Error during stitch.project():', (err as Error).message);
}

// Check if a transport was opened? (Difficult without internal access, but we can look for open sockets)
console.log('Checking for open handles...');
// In a real env, we'd use something like etc, but here I'll just check if it crashes on second call.
try {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _p2 = stitch.project("test-id-2");
  console.log('Second project handle created.');
} catch (err) {
  console.error('Error during second stitch.project():', (err as Error).message);
}


