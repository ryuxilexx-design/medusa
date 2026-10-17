import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { createPool } from '@meduza/db';
import { config } from './config';

export type Q = Pick<PoolClient, 'query'>;

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool: Pool = createPool(config.databaseUrl);

  async rows<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<T>(sql, params)).rows;
  }
  async one<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.pool.query<T>(sql, params)).rows[0];
  }
  /** Runs fn inside a transaction (READ COMMITTED + explicit row locks where needed). */
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
  async onModuleDestroy() { await this.pool.end(); }
}
