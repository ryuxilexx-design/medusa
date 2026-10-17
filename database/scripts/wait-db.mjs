import { execSync } from 'node:child_process';
for (let i = 0; i < 60; i++) {
  try { execSync('docker exec meduza-db pg_isready -U meduza -d meduza', { stdio: 'ignore' }); console.log('PostgreSQL tayyor'); process.exit(0); }
  catch { await new Promise((r) => setTimeout(r, 1000)); }
}
console.error('PostgreSQL 60 soniyada ishga tushmadi'); process.exit(1);
