// Creates (or refreshes) the local read-only role used by the Postgres MCP server.
// Enforcement is done by PostgreSQL privileges, not by SQL parsing: the role can only SELECT.
// The sessions table (token hashes) is not readable. Local docker database only.
import { execFileSync } from 'node:child_process';
const ROLE = 'meduza_readonly';
const PASS = 'meduza_readonly_local'; // local-only, same trust level as docker-compose's meduza_local
const psql = (db, sql) => execFileSync('docker', ['exec', '-i', 'meduza-db', 'psql', '-U', 'meduza', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
psql('postgres', `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASS}'; END IF;
END $$;
ALTER ROLE ${ROLE} SET default_transaction_read_only = on;
ALTER ROLE ${ROLE} SET statement_timeout = '15s';`);
for (const db of ['meduza', 'meduza_test']) {
  psql(db, `GRANT CONNECT ON DATABASE ${db} TO ${ROLE};
GRANT USAGE ON SCHEMA public TO ${ROLE};
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ROLE};
ALTER DEFAULT PRIVILEGES FOR ROLE meduza IN SCHEMA public GRANT SELECT ON TABLES TO ${ROLE};
REVOKE ALL ON TABLE sessions FROM ${ROLE};`);
  console.log(`${ROLE}: ${db} — faqat SELECT (sessions yopiq)`);
}
