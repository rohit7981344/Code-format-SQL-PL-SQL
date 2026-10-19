const fs = require('fs'), path = require('path');
const { format, sameTokens } = require('../out/formatter');
const dir = path.join(__dirname, 'samples');
let ok = true;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql') && !f.includes('.out.'))) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const out = format(src);
  fs.writeFileSync(path.join(dir, f.replace('.sql', '.out.sql')), out);
  const again = format(out);
  const same = sameTokens(src, out), stable = again === out;
  console.log(`${f}: tokens preserved=${same} idempotent=${stable}`);
  if (!same || !stable) ok = false;
  if (process.argv.includes('-v')) console.log('-----\n' + out);
}
process.exit(ok ? 0 : 1);
