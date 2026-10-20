// Runs `vitest run` from a working directory with an upper-case drive letter.
// On Windows, started from "d:\…" (some shells and editors use a lower-case drive), Vitest
// loads two copies of itself and every test file fails with
// "Cannot read properties of undefined (reading 'config')".
import { spawnSync } from 'node:child_process';

const cwd = process.cwd().replace(/^[a-z]:/, (d) => d.toUpperCase());
const r = spawnSync('npx', ['vitest', 'run', ...process.argv.slice(2)], { cwd, stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
