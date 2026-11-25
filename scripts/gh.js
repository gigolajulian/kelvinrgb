// gh with the release token (SEC-8): KELVINRGB_GH_TOKEN, a fine-grained token for gigolajulian/kelvinrgb only
// (README Secrets), goes to gh as GH_TOKEN for these calls only. Unset: gh's own login, with a warning.
//   node scripts/gh.js release create v<version> "dist/KelvinRGB Setup <version>.exe" --title "KelvinRGB <version>"
// The token is never printed or logged.
const { execFileSync } = require('child_process');

function ghEnv(env = process.env, warn = console.warn) {
  const token = env.KELVINRGB_GH_TOKEN;
  if (!token) { warn('KELVINRGB_GH_TOKEN is not set: using the gh login, which reaches every repository (README Secrets).'); return { ...env }; }
  return { ...env, GH_TOKEN: token };
}

const gh = (args, opts = {}) => execFileSync('gh', args, { stdio: 'inherit', ...opts, env: ghEnv() });

if (require.main === module) {
  try { gh(process.argv.slice(2)); } catch (e) { process.exit(e.status || 1); }
}
module.exports = { ghEnv, gh };
