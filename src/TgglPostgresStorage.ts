import type { TgglStorage } from './types.js';
import type { Pool, PoolConfig } from 'pg';

export type TgglPostgresErrorCode =
  | 'FAILED_TO_CONNECT'
  | 'FAILED_TO_CREATE_TABLE'
  | 'FAILED_TO_FETCH_CONFIG'
  | 'FAILED_TO_WRITE_CONFIG';

export class TgglPostgresError extends Error {
  code: TgglPostgresErrorCode;
  error: Error;

  constructor(code: TgglPostgresErrorCode, message: string, error: Error) {
    super(`${message}: ${error.message}`);
    this.name = 'PostgresError';
    this.code = code;
    this.error = error;
  }
}

export class TgglPostgresStorage implements TgglStorage {
  private ready: Promise<void>;
  private client: Pool | null = null;

  constructor(config?: PoolConfig) {
    this.ready = import('pg').then(({ Pool }) => {
      this.client = new Pool({
        ...config,
        max: 1,
        connectionTimeoutMillis: 5_000,
        query_timeout: 5_000,
        statement_timeout: 5_000,
      });

      this.client.on('connect', async (client) => {
        await this.init(client);
      });
    });
    this.ready.catch(() => null);
  }

  private async init(client: {
    query: (query: string) => Promise<void>;
  }): Promise<void> {
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS tggl_config (key TEXT PRIMARY KEY, value TEXT);`
      );
    } catch (error) {
      throw new TgglPostgresError(
        'FAILED_TO_CREATE_TABLE',
        'Failed to create tggl_config table',
        error as Error
      );
    }
  }

  async get(): Promise<string | null> {
    try {
      await this.ready;

      const result = await this.client?.query(
        `SELECT "value"
         FROM "tggl_config"
         WHERE "key" = 'config'
         LIMIT 1;`
      );

      if (!result || result.rows.length == 0) {
        return null;
      }

      return (result.rows[0] as { value: string }).value;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'relation "tggl_config" does not exist'
      ) {
        return null;
      }
      throw new TgglPostgresError(
        'FAILED_TO_FETCH_CONFIG',
        'Failed to fetch config from Postgres',
        error as Error
      );
    }
  }

  async set(value: string): Promise<void> {
    try {
      await this.ready;

      if (!this.client) {
        throw new Error('Postgres client is not initialized');
      }

      await this.client.query(
        `INSERT INTO "tggl_config" ("key", "value") VALUES ( 'config', $1) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";`,
        [value]
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'relation "tggl_config" does not exist' &&
        this.client
      ) {
        await this.init(this.client);
        return this.set(value);
      }
      throw new TgglPostgresError(
        'FAILED_TO_WRITE_CONFIG',
        'Failed to write config to Postgres',
        error as Error
      );
    }
  }

  async close(): Promise<void> {
    await this.client?.end();
  }
}
