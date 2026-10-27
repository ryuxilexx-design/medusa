// MedPlus database access for the bridge: one MySQL/MariaDB connection, READ ONLY at the session level and per
// query (START TRANSACTION READ ONLY), a statement time limit, no multi-statements, dates as strings (wall time as
// MedPlus stored it). Use a MySQL user that has only SELECT (docs/MEDPLUS_SYNC.md «Read-only user»).
import { bindSql } from './core.mjs';

export async function mysqlSource(cfg) {
  const mysql = (await import('mysql2/promise')).default;
  const conn = await mysql.createConnection({
    host: cfg.host ?? '127.0.0.1', port: Number(cfg.port ?? 3306), user: cfg.user, password: cfg.password, database: cfg.database,
    charset: cfg.charset ?? 'utf8mb4', dateStrings: true, multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 10_000,
  });
  await conn.query('SET SESSION TRANSACTION READ ONLY');
  // a slow query must not hurt the clinic's working day: MySQL 5.7+ (ms) or MariaDB 10.1+ (s); older servers ignore it
  await conn.query('SET SESSION max_execution_time = 30000').catch(() => conn.query('SET SESSION max_statement_time = 30').catch(() => undefined));
  return {
    async fetch(_kind, sql, params) {
      const { text, values } = bindSql(sql, params);
      await conn.query('START TRANSACTION READ ONLY');
      try {
        const [rows] = await conn.query(text, values);
        return rows;
      } finally {
        await conn.query('COMMIT').catch(() => undefined);
      }
    },
    /** Schema only (tables, approximate row counts, columns, keys) — never a row of data. */
    async probe() {
      const [tables] = await conn.query(
        `SELECT table_name AS t, table_rows AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name`);
      const [cols] = await conn.query(
        `SELECT table_name AS t, column_name AS c, column_type AS type, column_key AS k, is_nullable AS nul FROM information_schema.columns
          WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position`);
      const [[ver]] = await conn.query('SELECT VERSION() AS v');
      return { server: ver.v, tables: tables.map((x) => ({ name: x.t, approx_rows: Number(x.n ?? 0), columns: cols.filter((c) => c.t === x.t).map((c) => `${c.c} ${c.type}${c.k ? ` [${c.k}]` : ''}${c.nul === 'YES' ? '' : ' NOT NULL'}`) })) };
    },
    close: () => conn.end(),
  };
}
