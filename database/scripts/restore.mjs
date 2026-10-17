// Restores the demo database from a pg_dump file: npm run db:restore -- backups/<file>.dump  (stop the app first)
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const file = process.argv[2];
if (!file || !existsSync(file)) { console.error('Foydalanish: npm run db:restore -- backups/<fayl>.dump'); process.exit(1); }
execSync(`docker exec -i meduza-db pg_restore -U meduza -d meduza --clean --if-exists --single-transaction < ${file}`, { stdio: 'inherit', shell: '/bin/sh' });
console.log(`Tiklandi: ${file}. Ilovani qayta ishga tushiring.`);
