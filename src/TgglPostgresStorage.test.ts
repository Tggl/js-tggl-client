import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TgglPostgresStorage } from './TgglPostgresStorage.js';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';

describe('stable Postgres', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;

  before(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new Pool({
      connectionString: container.getConnectionUri(),
    });
  });

  after(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DROP TABLE IF EXISTS tggl_config;').catch(() => null);
  });

  const assertTableExists = async (exists = true) => {
    const result = await pool.query(
      `SELECT EXISTS (SELECT
                      FROM information_schema.tables
                      WHERE table_name = 'tggl_config');`
    );

    assert.equal(
      result.rows[0].exists,
      exists,
      exists ? 'Table should be created' : 'Table should not be created'
    );
  };

  test('calling set should create table', async () => {
    await assertTableExists(false);

    const storage = new TgglPostgresStorage({
      connectionString: container.getConnectionUri(),
    });
    await storage.set('foo');

    await assertTableExists(true);

    await storage.close();
  });

  test('should return null when config does not exist', async () => {
    const storage = new TgglPostgresStorage({
      connectionString: container.getConnectionUri(),
    });
    const result = await storage.get();
    assert.equal(result, null, 'Should return null for non-existent config');

    await storage.close();
  });

  test('should store and get config', async () => {
    const storage = new TgglPostgresStorage({
      connectionString: container.getConnectionUri(),
    });

    await storage.set('foo');
    let result = await storage.get();
    assert.equal(result, 'foo', 'Should return the stored config');

    await storage.set('bar');
    result = await storage.get();
    assert.equal(result, 'bar', 'Should return the stored config');

    await storage.close();
  });

  test('should return null when table is empty', async () => {
    const storage = new TgglPostgresStorage({
      connectionString: container.getConnectionUri(),
    });

    await storage.set('foo');

    await pool.query('TRUNCATE TABLE tggl_config;').catch(() => null);

    const result = await storage.get();
    assert.equal(result, null);

    await storage.close();
  });
});
