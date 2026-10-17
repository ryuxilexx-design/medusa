// Creates the isolated test database (default: meduza_test) if it is missing. Refuses names without the _test suffix.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { Client } = require('pg');
const url = new URL(process.env.TEST_DATABASE_URL || 'postgres://meduza:meduza_local@127.0.0.1:5433/meduza_test');
const name = url.pathname.slice(1);
if (!/^[a-z0-9_]+_test$/.test(name)) { console.error(`Xavfsizlik to‘xtatdi: test bazasi nomi «*_test» bo‘lishi shart (hozir: «${name}»)`); process.exit(1); }
const admin = new URL(url); admin.pathname = '/postgres';
const c = new Client({ connectionString: admin.toString() });
await c.connect();
const exists = (await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount;
if (!exists) { await c.query(`CREATE DATABASE "${name}"`); console.log(`Test bazasi yaratildi: ${name}`); } else console.log(`Test bazasi: ${name}`);
await c.end();
