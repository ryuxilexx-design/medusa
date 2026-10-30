// MedPlus database access for the bridge: one MySQL/MariaDB connection, READ ONLY at the session level and per
// query (START TRANSACTION READ ONLY), a statement time limit, no multi-statements, dates as strings (wall time as
// MedPlus stored it). Use a MySQL user that has only SELECT (docs/MEDPLUS_SYNC.md «Read-only user»).
import { bindSql } from './core.mjs';

const SYSTEM_DBS = ['information_schema', 'mysql', 'performance_schema', 'sys', 'phpmyadmin'];
// MySQL < 5.6.5 has no READ ONLY transactions; the SELECT-only user and checkSql() still keep the bridge read-only
const tooOld = (e) => e?.code === 'ER_PARSE_ERROR' || e?.errno === 1064;

export async function mysqlSource(cfg) {
  const mysql = (await import('mysql2/promise')).default;
  const conn = await mysql.createConnection({
    host: cfg.host ?? '127.0.0.1', port: Number(cfg.port ?? 3306), user: cfg.user, password: cfg.password, database: cfg.database || undefined,
    charset: cfg.charset ?? 'utf8mb4', dateStrings: true, multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 10_000,
  });
  let readOnlyTx = true;
  await conn.query('SET SESSION TRANSACTION READ ONLY').catch((e) => { if (!tooOld(e)) throw e; readOnlyTx = false; });
  // a slow query must not hurt the clinic's working day: MySQL 5.7+ (ms) or MariaDB 10.1+ (s); older servers ignore it
  await conn.query('SET SESSION max_execution_time = 30000').catch(() => conn.query('SET SESSION max_statement_time = 30').catch(() => undefined));
  return {
    async fetch(_kind, sql, params) {
      if (!cfg.database) throw new Error('config: mysql.database kerak (--probe bazalar ro‘yxatini ko‘rsatadi)');
      const { text, values } = bindSql(sql, params);
      if (!readOnlyTx) return (await conn.query(text, values))[0];
      await conn.query('START TRANSACTION READ ONLY');
      try {
        const [rows] = await conn.query(text, values);
        return rows;
      } finally {
        await conn.query('COMMIT').catch(() => undefined);
      }
    },
    /**
     * Schema only (tables, approximate row counts, columns, keys, charsets) — never a row of data. Without
     * mysql.database it lists the databases this user can see, so the admin can pick MedPlus's one.
     */
    async probe() {
      const [[ver]] = await conn.query('SELECT VERSION() AS v');
      if (!cfg.database) {
        const [dbs] = await conn.query('SHOW DATABASES');
        return { server: ver.v, read_only_tx: readOnlyTx, databases: dbs.map((r) => Object.values(r)[0]).filter((d) => !SYSTEM_DBS.includes(String(d).toLowerCase())) };
      }
      const [tables] = await conn.query(
        `SELECT table_name AS t, table_rows AS n, table_collation AS coll FROM information_schema.tables
          WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name`);
      const [cols] = await conn.query(
        `SELECT table_name AS t, column_name AS c, column_type AS type, column_key AS k, is_nullable AS nul FROM information_schema.columns
          WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position`);
      const byTable = new Map();
      for (const c of cols) {
        const t = String(c.t).toLowerCase();
        if (!byTable.has(t)) byTable.set(t, []);
        byTable.get(t).push(`${c.c} ${c.type}${c.k ? ` [${c.k}]` : ''}${c.nul === 'YES' ? '' : ' NOT NULL'}`);
      }
      return {
        server: ver.v, database: cfg.database, read_only_tx: readOnlyTx,
        tables: tables.map((x) => ({ name: x.t, approx_rows: Number(x.n ?? 0), collation: x.coll ?? null, columns: byTable.get(String(x.t).toLowerCase()) ?? [] })),
      };
    },
    close: () => conn.end(),
  };
}
