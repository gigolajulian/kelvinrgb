// Leftovers check (EXIT-3): every logon task main.js can create is deleted by the uninstaller, except during an update.
// Static: reads main.js and build/installer.nsh. A real uninstall on a test PC is the manual half.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const nsh = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
const problems = [];

const task = (main.match(/const TASK = '([^']+)'/) || [])[1];
if (!task) problems.push('main.js: no TASK name found');
if (/schtasks/i.test(main) && !/'\/Create', '\/TN', TASK/.test(main)) problems.push('main.js creates a task not named by TASK');
const un = (nsh.match(/!macro customUnInstall([\s\S]*?)!macroend/) || [])[1] || '';
if (!un) problems.push('installer.nsh: no customUnInstall step');
if (task && !new RegExp(`schtasks\\.exe"? /Delete /TN ${task} /F`, 'i').test(un)) problems.push(`uninstall does not delete the ${task} logon task`);
if (un && !/\$\{ifNot\} \$\{isUpdated\}/.test(un)) problems.push('uninstall would also delete the task during an update');

if (problems.length) { console.error(`uninstall-check:\n${problems.join('\n')}`); process.exit(1); }
console.log(`uninstall-check: ok (${task})`);
