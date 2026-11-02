const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const stageDir = path.join(rootDir, 'build-staging');
  const targetAsar = path.join(rootDir, 'release', 'win-unpacked', 'resources', 'app.asar');

  if (!fs.existsSync(path.dirname(targetAsar))) {
    console.log('[pack-asar] Skipping asar update (release/win-unpacked/resources not found).');
    return;
  }

  console.log('[pack-asar] Preparing staging directory:', stageDir);

  if (fs.existsSync(stageDir)) {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stageDir, { recursive: true });

  // 1. Copy package.json
  fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(stageDir, 'package.json'));

  // 2. Copy dist directory recursively
  function copyRecursive(src, dest) {
    if (fs.statSync(src).isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      for (const child of fs.readdirSync(src)) {
        copyRecursive(path.join(src, child), path.join(dest, child));
      }
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  console.log('[pack-asar] Copying dist files...');
  copyRecursive(path.join(rootDir, 'dist'), path.join(stageDir, 'dist'));

  // 3. Copy production node_modules dependencies (plist, base64-js, xmlbuilder, @xmldom)
  console.log('[pack-asar] Copying production node_modules...');
  const stageModules = path.join(stageDir, 'node_modules');
  fs.mkdirSync(stageModules, { recursive: true });

  const prodPackages = ['plist', 'base64-js', 'xmlbuilder', '@xmldom'];
  for (const pkg of prodPackages) {
    const srcPkg = path.join(rootDir, 'node_modules', pkg);
    const destPkg = path.join(stageModules, pkg);
    if (fs.existsSync(srcPkg)) {
      copyRecursive(srcPkg, destPkg);
    }
  }

  // 4. Create asar archive
  console.log('[pack-asar] Packaging asar archive to:', targetAsar);
  await asar.createPackage(stageDir, targetAsar);

  // 5. Clean up staging directory
  fs.rmSync(stageDir, { recursive: true, force: true });

  console.log('[pack-asar] Successfully updated', targetAsar);
}

main().catch((err) => {
  console.error('[pack-asar] Error:', err);
  process.exit(1);
});

