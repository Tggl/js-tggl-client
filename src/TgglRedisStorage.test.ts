import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TgglRedisStorage } from './TgglRedisStorage.js';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { createClient, RedisClientType } from 'redis';

describe('stable Redis', () => {
  let container: StartedRedisContainer;
  let client: RedisClientType;

  before(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    client = createClient({
      url: container.getConnectionUrl(),
    });
    await client.connect();
  });

  after(async () => {
    await client.close();
    await container.stop();
  });

  beforeEach(async () => {
    try {
      await client.del('tggl_config');
    } catch (error) {
      // Ignore errors during cleanup
    }
  });

  test('should return null when config does not exist', async () => {
    const storage = new TgglRedisStorage({ url: container.getConnectionUrl() });
    const result = await storage.get();
    assert.equal(result, null, 'Should return null for non-existent config');

    await storage.close();
  });

  test('should handle get key not being a hash', async () => {
    await client.set('tggl_config', 'not-a-hash');
    const storage = new TgglRedisStorage({ url: container.getConnectionUrl() });
    const result = await storage.get();
    assert.equal(result, null, 'Should return null for non-existent config');

    await storage.close();
  });

  test('should handle set key not being a hash', async () => {
    await client.set('tggl_config', 'not-a-hash');
    const storage = new TgglRedisStorage({ url: container.getConnectionUrl() });
    await storage.set('foo');
    const result = await storage.get();
    assert.equal(result, 'foo');

    await storage.close();
  });

  test('should store and get config', async () => {
    const storage = new TgglRedisStorage({ url: container.getConnectionUrl() });

    await storage.set('foo');
    let result = await storage.get();
    assert.equal(result, 'foo', 'Should return the stored config');

    await storage.set('bar');
    result = await storage.get();
    assert.equal(result, 'bar', 'Should return the updated config');

    await storage.close();
  });

  test('should handle multiple storages with same connection', async () => {
    const storage1 = new TgglRedisStorage({
      url: container.getConnectionUrl(),
    });
    const storage2 = new TgglRedisStorage({
      url: container.getConnectionUrl(),
    });

    await storage1.set('from-storage-1');
    const result = await storage2.get();
    assert.equal(
      result,
      'from-storage-1',
      'Both storages should access same data'
    );

    await storage1.close();
    await storage2.close();
  });
});
