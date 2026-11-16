const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'UI', 'views');
const destDir = path.join(__dirname, '..', 'dist', 'UI', 'views');

function copyFolderSync(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach(element => {
    const stat = fs.lstatSync(path.join(from, element));
    if (stat.isFile()) {
      fs.copyFileSync(path.join(from, element), path.join(to, element));
    } else if (stat.isDirectory()) {
      copyFolderSync(path.join(from, element), path.join(to, element));
    }
  });
}

copyFolderSync(srcDir, destDir);
console.log('UI assets copied to dist/UI/views successfully.');

// Ensure native helper is compiled
if (process.platform === 'win32') {
  const { execSync } = require('child_process');
  const csSource = path.join(__dirname, '..', 'src', 'Platform', 'native', 'FsebLockdownHelper.cs');
  const binDir = path.join(__dirname, '..', 'bin');
  const targetExe = path.join(binDir, 'FsebLockdownHelper.exe');
  const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

  if (fs.existsSync(csSource) && fs.existsSync(cscPath)) {
    fs.mkdirSync(binDir, { recursive: true });
    try {
      execSync(`"${cscPath}" /target:winexe /optimize+ /platform:anycpu /out:"${targetExe}" "${csSource}"`, { stdio: 'ignore' });
      console.log('Native lockdown helper binary compiled successfully.');
    } catch (e) {
      console.warn('Failed to compile native helper binary:', e.message);
    }
  }
}


