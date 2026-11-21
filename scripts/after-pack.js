// electron-builder skips junctions, so a worktree whose sidecar/lib links to the main checkout shipped no DLLs (0.2.x to 0.3.2).
// Copy the real files and fail the build if they are still missing.
const fs = require('fs');
const path = require('path');
exports.default = async (ctx) => {
  const dest = path.join(ctx.appOutDir, 'resources', 'sidecar', 'lib');
  fs.cpSync(path.join(__dirname, '..', 'sidecar', 'lib'), dest, { recursive: true, dereference: true });
  if (!fs.existsSync(path.join(dest, 'LibreHardwareMonitorLib.dll'))) throw new Error('sidecar/lib missing from the package');
  if (!fs.existsSync(path.join(ctx.appOutDir, 'resources', 'setup', 'PawnIO_setup.exe'))) throw new Error('setup/PawnIO_setup.exe missing: run node scripts/fetch-pawnio.js');
};
