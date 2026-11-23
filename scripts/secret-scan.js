// Secret scan: every tracked file as it is now, plus every commit in the history when git has one.
// Exits 1 with file and pattern (never the value) when anything looks like a key or token. Run: node scripts/secret-scan.js
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const PATTERNS = {
  'private key': /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/,
  'AWS access key': /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  'GitHub token': /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/,
  'Slack token': /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  'OpenAI or Anthropic key': /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/,
  'Google API key': /\bAIza[0-9A-Za-z_-]{35}\b/,
  'Stripe live key': /\b[rs]k_live_[0-9a-zA-Z]{20,}\b/,
};
// The break recipe for this check plants a fake token on purpose.
const ALLOW = [/^\.bedrock\/breaks\/SEC-1\.patch$/, /^\.bedrock\/breaks\.json$/];
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });

const hits = [];
const scan = (where, text) => { for (const [name, re] of Object.entries(PATTERNS)) if (re.test(text)) hits.push(`${where}: ${name}`); };

for (const f of git('ls-files', '-z').split('\0').filter(Boolean)) {
  if (ALLOW.some((re) => re.test(f))) continue;
  let buf; try { buf = fs.readFileSync(f); } catch { continue; }
  if (buf.includes(0)) continue; // binary
  scan(f, buf.toString('utf8'));
}

let history = '';
try { history = git('log', '--all', '-p', '--no-color', '--format=@@commit %H'); } catch {}
let commit = '', file = '';
for (const line of history.split('\n')) {
  if (line.startsWith('@@commit ')) { commit = line.slice(9, 17); continue; }
  if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
  if (line.startsWith('+') && !ALLOW.some((re) => re.test(file))) scan(`${commit} ${file}`, line);
}

if (hits.length) { console.error(`secret-scan: ${hits.length} finding(s)\n${[...new Set(hits)].join('\n')}`); process.exit(1); }
console.log('secret-scan: clean');
