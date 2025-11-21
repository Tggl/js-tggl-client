import type { RedisClientOptions, RedisClientType } from 'redis';
import type { TgglStorage } from './types';

export type TgglRedisErrorCode =
  | 'FAILED_TO_CONNECT'
  | 'FAILED_TO_FETCH_CONFIG'
  | 'FAILED_TO_WRITE_CONFIG';

export class TgglRedisError extends Error {
  code: TgglRedisErrorCode;
  error: Error;

  constructor(code: TgglRedisErrorCode, message: string, error: Error) {
    super(`${message}: ${error.message}`);
    this.name = 'RedisError';
    this.code = code;
    this.error = error;
  }
}

export class TgglRedisStorage implements TgglStorage {
  private client: RedisClientType | null = null;
  private ready: Promise<void>;
  public name = 'Redis';
  private status: 'starting' | 'ready' | 'error' = 'starting';
  private error: Error | null = null;

  constructor(private options: RedisClientOptions) {
    this.ready = this.init();
    this.ready.catch(() => null);
  }

  private async init(): Promise<void> {
    try {
      const { createClient } = await import('redis');
      this.client = createClient(this.options) as RedisClientType;

      await this.client
        .on('error', (error) => {
          this.status = 'error';
          this.error = error;
        })
        .on('ready', () => {
          this.status = 'ready';
        })
        .connect();
    } catch (error) {
      throw new TgglRedisError(
        'FAILED_TO_CONNECT',
        'Failed to connect to Redis',
        error as Error
      );
    }
  }

  private async waitForConnection(): Promise<void> {
    if (this.status === 'error') {
      throw this.error;
    }

    await Promise.race([
      this.ready,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(this.error ?? new Error('Not responding')),
          2_000
        )
      ),
    ]);
  }

  async get(): Promise<string | null> {
    try {
      await this.waitForConnection();

      const data = await this.client?.hGetAll('tggl_config');

      if (!data?.config) {
        return null;
      }

      return data.config;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('WRONGTYPE')) {
        return null;
      }

      throw new TgglRedisError(
        'FAILED_TO_FETCH_CONFIG',
        'Failed to fetch config from Redis',
        error as Error
      );
    }
  }

  async set(config: string): Promise<void> {
    try {
      await this.waitForConnection();

      await this.client?.hSet('tggl_config', {
        config,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('WRONGTYPE')) {
        await this.client?.del('tggl_config');
        return this.set(config);
      }

      throw new TgglRedisError(
        'FAILED_TO_WRITE_CONFIG',
        'Failed to write config to Redis',
        error as Error
      );
    }
  }

  async close(): Promise<void> {
    await this.client?.close();
  }
}
