const { spawn } = require('child_process');
const electron = require('electron');

// Ensure ELECTRON_RUN_AS_NODE is stripped so Electron launches GUI mode
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  windowsHide: false
});

child.on('close', (code) => {
  process.exit(code || 0);
});

