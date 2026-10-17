// Writes a restorable pg_dump (custom format) of the demo database into ./backups/.
import { execSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
mkdirSync('backups', { recursive: true });
const file = `backups/meduza-${stamp}.dump`;
execSync(`docker exec meduza-db pg_dump -U meduza -d meduza -Fc > ${file}`, { stdio: 'inherit', shell: '/bin/sh' });
console.log(`Nusxa saqlandi: ${file} (${statSync(file).size} bayt). Tiklash: npm run db:restore -- ${file}`);
