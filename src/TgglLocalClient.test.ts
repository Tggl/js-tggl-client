/* eslint-disable @typescript-eslint/ban-ts-comment */
import { TgglLocalClient } from './TgglLocalClient.js';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fetchMock from 'fetch-mock';
import { PACKAGE_VERSION } from './version.js';
import { TgglReporting } from './TgglReporting.js';
import { TgglConfig, TgglStorage } from './types.js';
import { TgglLocalClientStateSerializer } from './serializers.js';
import { Flag, Operator } from 'tggl-core';

before(() => {
  fetchMock.mockGlobal();
});

beforeEach(() => {
  fetchMock.clearHistory();
  fetchMock.removeRoutes();
});

const flagAConfig = (value: any = 42): string =>
  JSON.stringify([
    {
      slug: 'flagA',
      conditions: [],
      defaultVariation: {
        active: true,
        value,
      },
    },
  ]);

const flagAConfigMap = (value: any = 42): TgglConfig => {
  const config: TgglConfig = new Map();
  config.set('flagA', {
    conditions: [],
    defaultVariation: {
      active: true,
      value,
    },
  });
  return config;
};

describe('API call specs', () => {
  test('check API call headers and content', async () => {
    fetchMock.get('https://api.tggl.io/config', '[]');

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });
    await client.waitReady();

    assert.equal(
      fetchMock.callHistory.callLogs.length,
      1,
      'API should be called once'
    );

    const call = fetchMock.callHistory.callLogs[0];
    const headers = call.request!.headers!;

    assert.equal(
      headers.has('x-tggl-api-key'),
      false,
      'X-Tggl-Api-Key header should not be present'
    );
  });

  test('passing apiKey to constructor should add header', async () => {
    fetchMock.get('https://api.tggl.io/config', '[]');

    const client = new TgglLocalClient({
      apiKey: 'my_api_key',
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const call = fetchMock.callHistory.callLogs[0];
    const headers = call.request!.headers!;

    assert.equal(
      headers.get('x-tggl-api-key'),
      'my_api_key',
      'X-Tggl-Api-Key header should be present'
    );
  });
});

describe('retry mechanism', () => {
  test('success after retry', async () => {
    fetchMock.get('https://api.tggl.io/config', 500, { repeat: 2 });
    fetchMock.get('https://api.tggl.io/config', flagAConfig());

    const client = new TgglLocalClient({
      maxRetries: 2,
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const calls = fetchMock.callHistory.callLogs;
    assert.equal(calls.length, 3);

    assert.equal(client.get({}, 'flagA', 'my_default'), 42);
  });

  test('max retry taken into account', async () => {
    fetchMock.get('https://api.tggl.io/config', 500);

    const client = new TgglLocalClient({
      maxRetries: 2,
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const calls = fetchMock.callHistory.callLogs;
    assert.equal(calls.length, 3);
  });

  test('retry after timeout', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(), {
      delay: 1_000,
      repeat: 2,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig());

    const client = new TgglLocalClient({
      maxRetries: 2,
      timeoutMs: 200,
      pollingIntervalMs: 0,
      reporting: false,
    });

    await client.waitReady();

    const calls = fetchMock.callHistory.callLogs;
    assert.equal(calls.length, 3);

    assert.equal(client.get({}, 'flagA', 'my_default'), 42);
    assert.equal(client.get({}, 'flagB', 'my_default'), 'my_default');
  });

  test('do not retry on invalid json', async () => {
    fetchMock.get('https://api.tggl.io/config', 'Hello World');

    const client = new TgglLocalClient({
      maxRetries: 2,
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const calls = fetchMock.callHistory.callLogs;
    assert.equal(calls.length, 1);

    assert.equal(
      client.getError()?.message,
      'Unexpected token \'H\', "Hello World" is not valid JSON'
    );
  });

  test('do not retry on invalid response format', async () => {
    fetchMock.get('https://api.tggl.io/config', '{}');

    const client = new TgglLocalClient({
      maxRetries: 2,
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const calls = fetchMock.callHistory.callLogs;
    assert.equal(calls.length, 1);

    assert.equal(
      client.getError()?.message,
      'Invalid response from Tggl, malformed config'
    );
  });

  test('fallback urls with retry', async () => {
    fetchMock.get('https://my-proxy.com/api/config', 500);
    fetchMock.get('https://api.tggl.io/config', 500, { repeat: 1 });
    fetchMock.get('https://api.tggl.io/config', flagAConfig());

    const client = new TgglLocalClient({
      maxRetries: 2,
      baseUrls: ['https://my-proxy.com/api'],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const calls = fetchMock.callHistory.callLogs;
    assert.equal(calls.length, 5);

    assert.equal(client.get({}, 'flagA', 'my_default'), 42);
    assert.equal(client.get({}, 'flagB', 'my_default'), 'my_default');
  });
});

describe('error', () => {
  test('error should be last error', async () => {
    fetchMock.get('https://api.tggl.io/config', 500, { repeat: 1 });
    fetchMock.get('https://api.tggl.io/config', 500, {
      repeat: 1,
      delay: 1_000,
    });
    fetchMock.get('https://api.tggl.io/config', '[]', { repeat: 1 });

    const client = new TgglLocalClient({
      maxRetries: 0,
      timeoutMs: 200,
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    assert.equal(
      client.getError()?.message,
      'Request failed with status code 500 Internal Server Error: GET https://api.tggl.io/config'
    );

    await client.refetch();
    assert.equal(
      client.getError()?.message,
      'Request timed out: GET https://api.tggl.io/config'
    );

    await client.refetch();
    assert.equal(client.getError(), null);
  });

  test('missing api key', async () => {
    fetchMock.get('https://api.tggl.io/config', {
      body: '{"error":"Missing header X-Tggl-API-Key"}',
      status: 401,
    });

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    assert.equal(client.getError()?.message, 'Missing header X-Tggl-API-Key');
    assert.equal(fetchMock.callHistory.callLogs.length, 1);
  });

  test('onError callback should be called after each error until unsubscribe', async () => {
    fetchMock.get('https://api.tggl.io/config', 500, { repeat: 1 });
    fetchMock.get('https://api.tggl.io/config', 500, {
      repeat: 1,
      delay: 1_000,
    });
    fetchMock.get('https://api.tggl.io/config', 500, { repeat: 1 });

    const client = new TgglLocalClient({
      maxRetries: 0,
      timeoutMs: 100,
      reporting: false,
      pollingIntervalMs: 0,
    });

    // listen to errors
    const callback1 = mock.fn();
    const callback2 = mock.fn();
    client.onError(callback1);
    const unsub2 = client.onError(callback2);

    assert.equal(callback1.mock.callCount(), 0);
    assert.equal(callback2.mock.callCount(), 0);

    // First error
    await client.waitReady();
    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(
      callback1.mock.calls[0].arguments[0].message,
      'Request failed with status code 500 Internal Server Error: GET https://api.tggl.io/config'
    );

    assert.equal(callback2.mock.callCount(), 1);
    assert.equal(
      callback2.mock.calls[0].arguments[0].message,
      'Request failed with status code 500 Internal Server Error: GET https://api.tggl.io/config'
    );

    // Second error
    callback1.mock.resetCalls();
    callback2.mock.resetCalls();

    await client.refetch();
    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(
      callback1.mock.calls[0].arguments[0].message,
      'Request timed out: GET https://api.tggl.io/config'
    );

    assert.equal(callback2.mock.callCount(), 1);
    assert.equal(
      callback2.mock.calls[0].arguments[0].message,
      'Request timed out: GET https://api.tggl.io/config'
    );

    // Third error after unsubscribing second callback
    unsub2();
    callback1.mock.resetCalls();
    callback2.mock.resetCalls();
    await client.refetch();
    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(
      callback1.mock.calls[0].arguments[0].message,
      'Request failed with status code 500 Internal Server Error: GET https://api.tggl.io/config'
    );

    assert.equal(callback2.mock.callCount(), 0);
  });

  test('onError callback should be called after ready is set', async () => {
    fetchMock.get('https://api.tggl.io/config', 500, { repeat: 1 });

    const client = new TgglLocalClient({
      maxRetries: 0,
      reporting: false,
      pollingIntervalMs: 0,
    });

    let ready: any = 'callback not called';
    client.onError(() => (ready = client.isReady()));

    await client.waitReady();
    assert.equal(ready, true);
  });

  test('onError callback should be called even if one throws', async () => {
    fetchMock.get('https://api.tggl.io/config', 500, { repeat: 1 });

    const client = new TgglLocalClient({
      maxRetries: 0,
      timeoutMs: 100,
      reporting: false,
      pollingIntervalMs: 0,
    });

    // listen to errors
    const callback2 = mock.fn();
    client.onError(() => {
      throw new Error('Callback error');
    });
    client.onError(callback2);

    await client.waitReady();

    assert.equal(callback2.mock.callCount(), 1);
  });

  test('onError callback should be called even if one async throws', async () => {
    fetchMock.get('https://api.tggl.io/config', 500, { repeat: 1 });

    const client = new TgglLocalClient({
      maxRetries: 0,
      timeoutMs: 100,
      reporting: false,
      pollingIntervalMs: 0,
    });

    const callback2 = mock.fn();
    client.onError(async () => {
      throw new Error('Callback error');
    });
    client.onError(callback2);

    await client.waitReady();

    assert.equal(callback2.mock.callCount(), 1);
  });
});

describe('isReady', () => {
  test('is ready after first call', async () => {
    fetchMock.get('https://api.tggl.io/config', '[]', { delay: 100 });

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    assert.equal(client.isReady(), false);
    await client.waitReady();
    assert.equal(client.isReady(), true);
  });

  test('all onReady callbacks are called after first call', async () => {
    fetchMock.get('https://api.tggl.io/config', '[]', { delay: 50 });

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    const callback1 = mock.fn();
    const callback2 = mock.fn();

    client.onReady(callback1);
    client.onReady(callback2);

    assert.equal(callback1.mock.callCount(), 0);
    assert.equal(callback2.mock.callCount(), 0);
    await client.waitReady();
    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);
  });

  test('onReady callback is called after first call that fails', async () => {
    fetchMock.get('https://api.tggl.io/config', 500);

    const client = new TgglLocalClient({
      maxRetries: 0,
      reporting: false,
      pollingIntervalMs: 0,
    });

    const callback = mock.fn();

    client.onReady(callback);

    await client.waitReady();
    assert.equal(callback.mock.callCount(), 1);
  });

  test('onReady callback is called after error is set', async () => {
    fetchMock.get('https://api.tggl.io/config', 500);

    const client = new TgglLocalClient({
      maxRetries: 0,
      reporting: false,
      pollingIntervalMs: 0,
    });

    let error: any = new Error('callback not called');
    client.onReady(() => (error = client.getError()));

    await client.waitReady();
    assert.equal(
      error.message,
      'Request failed with status code 500 Internal Server Error: GET https://api.tggl.io/config'
    );
  });

  test('onReady callback is called immediately if already ready', async () => {
    fetchMock.get('https://api.tggl.io/config', '[]', { delay: 50 });

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onReady(callback);

    assert.equal(callback.mock.callCount(), 1);
  });

  test('is ready after first call that fails', async () => {
    fetchMock.get('https://api.tggl.io/config', 500, { delay: 100 });

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    assert.equal(client.isReady(), false);
    await client.waitReady();
    assert.equal(client.isReady(), true);
  });
});

describe('refetch concurrency', () => {
  test('refetch resolves when last call resolves', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(0), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
      delay: 50,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2), {
      repeat: 1,
      delay: 100,
    });

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });
    await client.waitReady();

    const p1 = client.refetch();
    const p2 = client.refetch();

    await p1;
    assert.equal(client.get({}, 'flagA', 0), 2);
    await p2;
    assert.equal(client.get({}, 'flagA', 0), 2);
  });

  test('refetch resolves when last call resolves unordered responses', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(0), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
      delay: 100,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2), {
      repeat: 1,
      delay: 50,
    });

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });
    await client.waitReady();

    const p1 = client.refetch();
    const p2 = client.refetch();

    await p2;
    assert.equal(client.get({}, 'flagA', 0), 2);
    await p1;
    assert.equal(client.get({}, 'flagA', 0), 2);
  });
});

describe('get', () => {
  test('flags should be completely overwritten each time', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', '[]', { repeat: 1 });

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });
    await client.waitReady();

    assert.deepEqual(client.getAll({}), { flagA: 42 });
    await client.refetch();
    assert.deepEqual(client.getAll({}), {});
  });

  test('falsy values should be returned directly, not the default value', async () => {
    fetchMock.get(
      'https://api.tggl.io/config',
      JSON.stringify([
        {
          slug: 'flagA',
          conditions: [],
          defaultVariation: {
            active: true,
            value: null,
          },
        },
        {
          slug: 'flagB',
          conditions: [],
          defaultVariation: {
            active: true,
            value: false,
          },
        },
        {
          slug: 'flagC',
          conditions: [],
          defaultVariation: {
            active: true,
            value: 0,
          },
        },
        {
          slug: 'flagD',
          conditions: [],
          defaultVariation: {
            active: true,
            value: '',
          },
        },
      ])
    );

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });
    await client.waitReady();

    assert.equal(client.get({}, 'flagA', 'my_default'), null);
    assert.equal(client.get({}, 'flagB', 'my_default'), false);
    assert.equal(client.get({}, 'flagC', 'my_default'), 0);
    assert.equal(client.get({}, 'flagD', 'my_default'), '');
  });

  test('unknown flags should return the default value', async () => {
    fetchMock.get('https://api.tggl.io/config', '[]');

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });
    await client.waitReady();

    assert.equal(client.get({}, 'flagA', 'my_default'), 'my_default');
  });

  test('context should be taken into account', async () => {
    fetchMock.get(
      'https://api.tggl.io/config',
      JSON.stringify([
        {
          slug: 'flagA',
          conditions: [
            {
              rules: [
                {
                  operator: Operator.StrEqual,
                  key: 'foo',
                  values: ['bar'],
                  negate: false,
                },
              ],
              variation: {
                active: true,
                value: true,
              },
            },
          ],
          defaultVariation: {
            active: true,
            value: false,
          },
        } satisfies Flag & { slug: string },
      ])
    );
    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });
    await client.waitReady();

    assert.equal(client.get({}, 'flagA', 'my_default'), false);
    assert.equal(client.get({ foo: 'bar' }, 'flagA', 'my_default'), true);
  });

  test('should support inactive variations', async () => {
    fetchMock.get(
      'https://api.tggl.io/config',
      JSON.stringify([
        {
          slug: 'flagA',
          conditions: [],
          defaultVariation: {
            active: false,
            value: 'foo',
          },
        } satisfies Flag & { slug: string },
      ])
    );
    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });
    await client.waitReady();

    assert.equal(client.get({}, 'flagA', 'my_default'), 'my_default');
  });

  test('should support unknown flag', async () => {
    fetchMock.get('https://api.tggl.io/config', '[]');
    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });
    await client.waitReady();

    assert.equal(client.get({}, 'flagA', 'my_default'), 'my_default');
  });

  test('getAll context should be taken into account', async () => {
    fetchMock.get(
      'https://api.tggl.io/config',
      JSON.stringify([
        {
          slug: 'flagA',
          conditions: [
            {
              rules: [
                {
                  operator: Operator.StrEqual,
                  key: 'foo',
                  values: ['bar'],
                  negate: false,
                },
              ],
              variation: {
                active: true,
                value: true,
              },
            },
          ],
          defaultVariation: {
            active: true,
            value: false,
          },
        } satisfies Flag & { slug: string },
      ])
    );
    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });
    await client.waitReady();

    assert.deepEqual(client.getAll({}), { flagA: false });
    assert.deepEqual(client.getAll({ foo: 'bar' }), { flagA: true });
  });

  test('getAll should support inactive variations', async () => {
    fetchMock.get(
      'https://api.tggl.io/config',
      JSON.stringify([
        {
          slug: 'flagA',
          conditions: [],
          defaultVariation: {
            active: false,
            value: 'foo',
          },
        } satisfies Flag & { slug: string },
      ])
    );
    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });
    await client.waitReady();

    assert.deepEqual(client.getAll({}), {});
  });
});

describe('polling', () => {
  test('polling at specified interval', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(3), {
      repeat: 1,
    });

    const client = new TgglLocalClient({
      pollingIntervalMs: 100,
      reporting: false,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();
    assert.equal(
      client.get({}, 'flagA', 0),
      1,
      'Initial call should set flagA to 1'
    );

    // Wait for first poll
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      client.get({}, 'flagA', 0),
      2,
      'First poll should update flagA to 2'
    );

    // Wait for second poll
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      client.get({}, 'flagA', 0),
      3,
      'Second poll should update flagA to 3'
    );
  });

  test('stopPolling should stop polling', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });

    const client = new TgglLocalClient({
      pollingIntervalMs: 100,
      reporting: false,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 0), 1);

    client.stopPolling();

    // Wait to ensure no more polling happens
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(client.get({}, 'flagA', 0), 1);
  });

  test('startPolling should start polling immediately when previously disabled', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(3), {
      repeat: 1,
    });

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 0), 1);

    client.startPolling(100);

    // Wait for first poll
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(client.get({}, 'flagA', 0), 2);

    // Wait for first poll
    await new Promise((resolve) => setTimeout(resolve, 130));
    assert.equal(client.get({}, 'flagA', 0), 3);
  });

  test('startPolling with 0 or less should stop polling', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(3), {
      repeat: 1,
    });

    const client = new TgglLocalClient({
      pollingIntervalMs: 100,
      reporting: false,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 0), 1);

    client.startPolling(-1);

    // Wait to ensure no more polling happens
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(client.get({}, 'flagA', 0), 1);
  });

  test('changing polling interval should change after the next polling', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(3), {
      repeat: 1,
    });

    const client = new TgglLocalClient({
      pollingIntervalMs: 100,
      reporting: false,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 0), 1);

    // Change to faster polling
    client.startPolling(30);

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(client.get({}, 'flagA', 0), 1);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(client.get({}, 'flagA', 0), 2);

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(client.get({}, 'flagA', 0), 3);
  });

  test('refetch should cancel scheduled polling and reschedule', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(3), {
      repeat: 1,
    });

    const client = new TgglLocalClient({
      pollingIntervalMs: 200,
      reporting: false,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 0), 1);

    // Call refetch before the poll would happen
    await new Promise((resolve) => setTimeout(resolve, 150));
    await client.refetch();
    assert.equal(client.get({}, 'flagA', 0), 2);

    // Next poll should happen 200ms after refetch
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(client.get({}, 'flagA', 0), 2);

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(client.get({}, 'flagA', 0), 3);
  });

  test('polling should continue after errors', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', 500, { repeat: 1 });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(3), {
      repeat: 1,
    });

    const client = new TgglLocalClient({
      pollingIntervalMs: 100,
      maxRetries: 0,
      reporting: false,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 0), 1);
    assert.equal(client.getError(), null);

    // Wait for error poll
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      client.get({}, 'flagA', 0),
      1,
      'Flags should not change on error'
    );
    assert.ok(client.getError() !== null, 'Should have an error');

    // Wait for next successful poll
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(client.get({}, 'flagA', 0), 3, 'Should recover after error');
    assert.equal(client.getError(), null, 'Error should be cleared');
  });
});

describe('reporting', () => {
  test('apiKey is passed down to reporting', () => {
    const client = new TgglLocalClient({
      apiKey: 'my_api_key',
      pollingIntervalMs: 0,
    });

    //@ts-expect-error
    assert.equal(client.getReporting()._apiKey, 'my_api_key');
  });

  test('passing true as reporting option enables reporting', () => {
    const client = new TgglLocalClient({
      reporting: true,
      pollingIntervalMs: 0,
    });

    assert.equal(client.getReporting().isActive(), true);
  });

  test('passing false as reporting option disables reporting', () => {
    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    assert.equal(client.getReporting().isActive(), false);
  });

  test('passing an existing reporting as option should work', () => {
    const reporting = new TgglReporting();
    const client = new TgglLocalClient({ reporting, pollingIntervalMs: 0 });

    assert.equal(client.getReporting(), reporting);
  });

  test('calling get should report flag and context', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig());
    fetchMock.post('https://api.tggl.io/report', 200, { name: 'reporting' });

    const client = new TgglLocalClient({
      reporting: {
        flushIntervalMs: 1,
      },
      pollingIntervalMs: 0,
    });
    await client.waitReady();

    client.get({ foo: 'bar' }, 'flagA', 'default_value');

    await new Promise((resolve) => setTimeout(resolve, 50));

    const actual = JSON.parse(
      fetchMock.callHistory.lastCall('reporting')?.options.body as string
    );

    assert.deepEqual(actual, {
      receivedProperties: {
        foo: [
          actual.receivedProperties.foo[0],
          actual.receivedProperties.foo[1],
        ],
      },
      receivedValues: {
        foo: [['bar']],
      },
      clients: [
        {
          id: `js-client:${PACKAGE_VERSION}/TgglLocalClient`,
          flags: {
            flagA: [{ value: 42, default: 'default_value', count: 1 }],
          },
        },
      ],
    });
  });

  test('appName should be passed down to reporting', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig());
    fetchMock.post('https://api.tggl.io/report', 200, { name: 'reporting' });

    const client = new TgglLocalClient({
      appName: 'MyApp',
      reporting: {
        flushIntervalMs: 1,
      },
      pollingIntervalMs: 0,
    });
    await client.waitReady();

    client.get({}, 'flagA', 'default_value');

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepEqual(
      JSON.parse(
        fetchMock.callHistory.lastCall('reporting')?.options.body as string
      ),
      {
        clients: [
          {
            id: `js-client:${PACKAGE_VERSION}/TgglLocalClient/MyApp`,
            flags: {
              flagA: [{ value: 42, default: 'default_value', count: 1 }],
            },
          },
        ],
      }
    );
  });

  test('getAll should report context only', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig());
    fetchMock.post('https://api.tggl.io/report', 200, { name: 'reporting' });

    const client = new TgglLocalClient({
      reporting: {
        flushIntervalMs: 1,
      },
      pollingIntervalMs: 0,
    });
    await client.waitReady();

    client.getAll({ foo: 'bar' });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const actual = JSON.parse(
      fetchMock.callHistory.lastCall('reporting')?.options.body as string
    );

    assert.deepEqual(actual, {
      receivedProperties: {
        foo: [
          actual.receivedProperties.foo[0],
          actual.receivedProperties.foo[1],
        ],
      },
      receivedValues: {
        foo: [['bar']],
      },
    });
  });
});

describe('config change events', () => {
  test('onConfigChange should be called when config changes via refetch', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    const callback = mock.fn();
    client.onConfigChange(callback);

    await client.waitReady();
    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA']);

    callback.mock.resetCalls();
    await client.refetch();
    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA']);
  });

  test('onConfigChange should be called with only changed flags', async () => {
    fetchMock.get(
      'https://api.tggl.io/config',
      JSON.stringify([
        {
          slug: 'flagA',
          conditions: [],
          defaultVariation: {
            active: true,
            value: 1,
          },
        },
        {
          slug: 'flagB',
          conditions: [],
          defaultVariation: {
            active: true,
            value: 2,
          },
        },
        {
          slug: 'flagC',
          conditions: [],
          defaultVariation: {
            active: true,
            value: 3,
          },
        },
      ]),
      { repeat: 1 }
    );
    fetchMock.get(
      'https://api.tggl.io/config',
      JSON.stringify([
        {
          slug: 'flagB',
          conditions: [],
          defaultVariation: {
            active: true,
            value: 5,
          },
        },
        {
          slug: 'flagA',
          conditions: [],
          defaultVariation: {
            active: true,
            value: 1,
          },
        },
        {
          slug: 'flagD',
          conditions: [],
          defaultVariation: {
            active: true,
            value: 4,
          },
        },
      ])
    );

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onConfigChange(callback);

    await client.refetch();

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], [
      'flagB',
      'flagC',
      'flagD',
    ]);
  });

  test('onConfigChange should be called when flags are removed', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', '[]');

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onConfigChange(callback);

    await client.refetch();

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA']);
  });

  test('onConfigChange should not be called when flags do not change', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(), {
      repeat: 1,
    });

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onConfigChange(callback);

    await client.refetch();

    assert.equal(callback.mock.callCount(), 0);
  });

  test('onConfigChange should handle multiple callbacks', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback1 = mock.fn();
    const callback2 = mock.fn();
    client.onConfigChange(callback1);
    client.onConfigChange(callback2);

    await client.refetch();

    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);
    assert.deepEqual(callback1.mock.calls[0].arguments[0], ['flagA']);
    assert.deepEqual(callback2.mock.calls[0].arguments[0], ['flagA']);
  });

  test('onConfigChange unsubscribe should work correctly', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(3));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback1 = mock.fn();
    const callback2 = mock.fn();
    client.onConfigChange(callback1);
    const unsubscribe = client.onConfigChange(callback2);

    // First change - both callbacks called
    await client.refetch();
    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);

    // Unsubscribe callback2
    unsubscribe();

    // Second change - only callback1 called
    await client.refetch();
    assert.equal(callback1.mock.callCount(), 2);
    assert.equal(callback2.mock.callCount(), 1);
  });

  test('onConfigChange should be called on initial call', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(), {
      repeat: 1,
    });

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    const callback = mock.fn();
    client.onConfigChange(callback);

    await client.waitReady();

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA']);
  });

  test('onConfigChange should be called once new values are ready', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    let flagValue = 'callback never called';
    client.onConfigChange(() => {
      flagValue = client.get({}, 'flagA', 'default value used in callback');
    });

    await client.waitReady();

    assert.equal(flagValue, 1);
  });

  test('onConfigChange should be called once error has been reset', async () => {
    fetchMock.get('https://api.tggl.io/config', 500, { repeat: 1 });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(), {
      repeat: 1,
    });

    const client = new TgglLocalClient({
      maxRetries: 0,
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
    assert.notEqual(client.getError(), null);

    let error: any = 'callback never called';
    client.onConfigChange(() => {
      error = client.getError();
    });

    await client.refetch();

    assert.equal(error, null);
  });

  test('onConfigChange should be called once ready has been set', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(), {
      repeat: 1,
    });

    const client = new TgglLocalClient({
      maxRetries: 0,
      reporting: false,
      pollingIntervalMs: 0,
    });

    let ready: any = 'callback never called';
    client.onConfigChange(() => {
      ready = client.isReady();
    });

    await client.waitReady();

    assert.equal(ready, true);
  });

  test('onConfigChange should be called when flags change via setConfig', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig());

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onConfigChange(callback);

    client.setConfig(new Map());

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA']);
  });

  test('onConfigChange should not be called when error occurs during refetch', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', 500);

    const client = new TgglLocalClient({
      maxRetries: 0,
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onConfigChange(callback);

    await client.refetch();

    assert.equal(callback.mock.callCount(), 0);
  });

  test('onConfigChange should work with polling', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2));

    const client = new TgglLocalClient({
      pollingIntervalMs: 100,
      reporting: false,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onConfigChange(callback);

    assert.equal(callback.mock.callCount(), 0);

    // Wait for polling to trigger
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA']);

    client.stopPolling();
  });

  test('onConfigChange should handle empty flags', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', '[]');

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onConfigChange(callback);

    await client.refetch();

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA']);
  });

  test('onConfigChange callback should handle exceptions gracefully', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback1 = mock.fn(() => {
      throw new Error('Callback error');
    });
    const callback2 = mock.fn();

    client.onConfigChange(callback1);
    client.onConfigChange(callback2);

    // Should not throw even if callback1 throws
    await client.refetch();

    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);
  });

  test('onConfigChange callback should handle async exceptions gracefully', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback1 = mock.fn(async () => {
      throw new Error('Callback error');
    });
    const callback2 = mock.fn();

    client.onConfigChange(callback1);
    client.onConfigChange(callback2);

    // Should not throw even if callback1 throws
    await client.refetch();

    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);
  });
});

describe('storages', () => {
  test('should load flags from storage on initialization but still use network', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig('from-network'), {
      delay: 100,
    });

    const storage: TgglStorage = {
      get: () =>
        Promise.resolve(
          TgglLocalClientStateSerializer.serialize({
            date: Date.now(),
            config: flagAConfigMap('from-storage'),
          })
        ),
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 'default'), 'from-storage');
    await new Promise((resolve) => setTimeout(resolve, 110));
    assert.equal(client.get({}, 'flagA', 'default'), 'from-network');
  });

  test('should use most recent storage when multiple storages provided', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      delay: 100,
    });

    const storage1: TgglStorage = {
      get: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve(
              TgglLocalClientStateSerializer.serialize({
                date: 1000,
                config: flagAConfigMap('storage-1'),
              })
            );
          }, 10)
        ),
      set: () => Promise.resolve(),
    };

    const storage2: TgglStorage = {
      get: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve(
              TgglLocalClientStateSerializer.serialize({
                date: 2000,
                config: flagAConfigMap('storage-2'),
              })
            );
          }, 50)
        ),
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage1, storage2],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(client.get({}, 'flagA', 'default'), 'storage-2');
  });

  test('should use most recent storage when multiple storages provided out of order', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      delay: 100,
    });

    const storage1: TgglStorage = {
      get: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve(
              TgglLocalClientStateSerializer.serialize({
                date: 1000,
                config: flagAConfigMap('storage-1'),
              })
            );
          }, 50)
        ),
      set: () => Promise.resolve(),
    };

    const storage2: TgglStorage = {
      get: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve(
              TgglLocalClientStateSerializer.serialize({
                date: 2000,
                config: flagAConfigMap('storage-2'),
              })
            );
          }, 10)
        ),
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage1, storage2],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(client.get({}, 'flagA', 'default'), 'storage-2');
  });

  test('should handle storage returning null gracefully', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const storage: TgglStorage = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 'default'), 1);
  });

  test('should handle storage returning undefined gracefully', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const storage: TgglStorage = {
      // @ts-expect-error
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 'default'), 1);
  });

  test('should handle storage throwing async errors gracefully', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const storage: TgglStorage = {
      get: () => Promise.reject(new Error('Storage error')),
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 'default'), 1);
  });

  test('should handle storage throwing errors gracefully', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const storage: TgglStorage = {
      get: () => {
        throw new Error('Storage error');
      },
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 'default'), 1);
  });

  test('should handle storage returning invalid JSON gracefully', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const storage: TgglStorage = {
      get: () => Promise.resolve('invalid json {'),
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 'default'), 1);
  });

  test('should handle storage with missing config field', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const storage: TgglStorage = {
      get: () => Promise.resolve(JSON.stringify({ date: Date.now() })),
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 'default'), 1);
  });

  test('should handle multiple storages with errors', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const storage1: TgglStorage = {
      get: () => Promise.reject(new Error('Error 1')),
      set: () => Promise.resolve(),
    };

    const storage2: TgglStorage = {
      get: () => Promise.reject(new Error('Error 2')),
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage1, storage2],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 'default'), 1);
  });

  test('should handle mix of working and failing storages', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      delay: 100,
    });

    const storage1: TgglStorage = {
      get: () => Promise.reject(new Error('Storage error')),
      set: () => Promise.resolve(),
    };

    const storage2: TgglStorage = {
      get: () =>
        Promise.resolve(
          TgglLocalClientStateSerializer.serialize({
            date: Date.now(),
            config: flagAConfigMap('from-storage'),
          })
        ),
      set: () => Promise.resolve(),
    };

    const storage3: TgglStorage = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage1, storage2, storage3],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(client.get({}, 'flagA', 'default'), 'from-storage');
  });

  test('should handle storage data loaded after initial fetch completes', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig('from-api'));

    const storage: TgglStorage = {
      get: () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                TgglLocalClientStateSerializer.serialize({
                  date: Date.now(),
                  config: flagAConfigMap('from-storage'),
                })
              ),
            100
          )
        ),
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 'default'), 'from-api');

    // Storage loads after initial fetch
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(client.get({}, 'flagA', 'default'), 'from-api');
  });

  test('should trigger onConfigChange when storage loads flags', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      delay: 100,
    });

    const storage: TgglStorage = {
      get: () =>
        Promise.resolve(
          TgglLocalClientStateSerializer.serialize({
            date: Date.now(),
            config: flagAConfigMap('from-storage'),
          })
        ),
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage],
      reporting: false,
      pollingIntervalMs: 0,
    });

    const callback = mock.fn();
    client.onConfigChange(callback);

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA']);
  });

  test('should handle empty config from storage', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const storage: TgglStorage = {
      get: () =>
        Promise.resolve(
          TgglLocalClientStateSerializer.serialize({
            date: Date.now(),
            config: new Map(),
          })
        ),
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
  });

  test('should handle synchronous storage', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      delay: 100,
    });

    const storage: TgglStorage = {
      get: () =>
        TgglLocalClientStateSerializer.serialize({
          date: Date.now(),
          config: flagAConfigMap('from-storage'),
        }),
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(client.get({}, 'flagA', 'default'), 'from-storage');
  });

  test('should call set on all storage after successful network', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const setter = mock.fn();
    const storage: TgglStorage = {
      get: () => null,
      set: setter as any,
    };

    const client = new TgglLocalClient({
      storages: [storage],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
    assert.equal(setter.mock.callCount(), 1);
    const state = TgglLocalClientStateSerializer.deserialize(
      setter.mock.calls[0].arguments[0]
    );
    assert.equal(state?.config.has('flagA'), true);
  });

  test('should not call set on all storage after failed network', async () => {
    fetchMock.get('https://api.tggl.io/config', 500);

    const setter = mock.fn();
    const storage: TgglStorage = {
      get: () => null,
      set: setter as any,
    };

    const client = new TgglLocalClient({
      storages: [storage],
      maxRetries: 0,
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
    assert.equal(setter.mock.callCount(), 0);
  });

  test('should not call set on all storage after successful storage get', async () => {
    fetchMock.get('https://api.tggl.io/config', 500);

    const setter = mock.fn();
    const storage1: TgglStorage = {
      get: () =>
        Promise.resolve(
          TgglLocalClientStateSerializer.serialize({
            date: Date.now(),
            config: flagAConfigMap('from-storage'),
          })
        ),
      set: setter as any,
    };
    const storage2: TgglStorage = {
      get: () =>
        Promise.resolve(
          TgglLocalClientStateSerializer.serialize({
            date: Date.now(),
            config: flagAConfigMap('from-storage'),
          })
        ),
      set: setter as any,
    };

    const client = new TgglLocalClient({
      storages: [storage1, storage2],
      maxRetries: 0,
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
    assert.equal(setter.mock.callCount(), 0);
  });

  test('should handle throwing set storages', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const setter = mock.fn();
    const storage1: TgglStorage = {
      get: () => null,
      set: () => {
        throw new Error('test');
      },
    };
    const storage2: TgglStorage = {
      get: () => null,
      set: setter as any,
    };

    new TgglLocalClient({
      storages: [storage1, storage2],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(setter.mock.callCount(), 1);
  });

  test('should handle async throwing set storages', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const setter = mock.fn();
    const storage1: TgglStorage = {
      get: () => null,
      set: async () => {
        throw new Error('test');
      },
    };
    const storage2: TgglStorage = {
      get: () => null,
      set: setter as any,
    };

    new TgglLocalClient({
      storages: [storage1, storage2],
      reporting: false,
      pollingIntervalMs: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(setter.mock.callCount(), 1);
  });
});

describe('close', () => {
  test('should stop polling when close is called', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), {
      repeat: 1,
    });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2));

    const client = new TgglLocalClient({
      pollingIntervalMs: 100,
      reporting: false,
    });

    await client.waitReady();
    assert.equal(client.get({}, 'flagA', 0), 1);

    await client.close();

    // Wait to ensure no polling happens after close
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(client.get({}, 'flagA', 0), 1);
  });

  test('should stop reporting when close is called', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));
    fetchMock.post('https://api.tggl.io/reporting', 200, { name: 'reporting' });

    const client = new TgglLocalClient({
      reporting: {
        flushIntervalMs: 100,
      },
    });

    await client.waitReady();
    await client.close();

    // Verify reporting is stopped
    assert.equal(client.getReporting().isActive(), false);
  });

  test('should flush reporting when close is called', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));
    fetchMock.post('https://api.tggl.io/report', 200, { name: 'reporting' });

    const client = new TgglLocalClient({
      reporting: {
        flushIntervalMs: 0, // Manual flush is needed
      },
    });

    await client.waitReady();
    client.get({}, 'flagA', 'default');

    await client.close();

    const reportingCall = fetchMock.callHistory.lastCall('reporting');
    assert.notEqual(reportingCall, undefined);
  });

  test('should call close on all storages', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const closer1 = mock.fn();
    const closer2 = mock.fn();

    const storage1: TgglStorage = {
      get: () => null,
      set: () => Promise.resolve(),
      close: closer1 as any,
    };

    const storage2: TgglStorage = {
      get: () => null,
      set: () => Promise.resolve(),
      close: closer2 as any,
    };

    const client = new TgglLocalClient({
      storages: [storage1, storage2],
      reporting: false,
    });

    await client.waitReady();
    await client.close();

    assert.equal(closer1.mock.callCount(), 1);
    assert.equal(closer2.mock.callCount(), 1);
  });

  test('should handle storages without close method', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const storage: TgglStorage = {
      get: () => null,
      set: () => Promise.resolve(),
    };

    const client = new TgglLocalClient({
      storages: [storage],
      reporting: false,
    });

    await client.waitReady();
    await client.close(); // Should not throw
  });

  test('should handle throwing close storages', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const closer = mock.fn();
    const storage1: TgglStorage = {
      get: () => null,
      set: () => Promise.resolve(),
      close: () => {
        throw new Error('Close error');
      },
    };

    const storage2: TgglStorage = {
      get: () => null,
      set: () => Promise.resolve(),
      close: closer as any,
    };

    const client = new TgglLocalClient({
      storages: [storage1, storage2],
      reporting: false,
    });

    await client.waitReady();
    await client.close(); // Should not throw

    assert.equal(closer.mock.callCount(), 1);
  });

  test('should handle async throwing close storages', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const closer = mock.fn();
    const storage1: TgglStorage = {
      get: () => null,
      set: () => Promise.resolve(),
      close: async () => {
        throw new Error('Close error');
      },
    };

    const storage2: TgglStorage = {
      get: () => null,
      set: () => Promise.resolve(),
      close: closer as any,
    };

    const client = new TgglLocalClient({
      storages: [storage1, storage2],
      reporting: false,
    });

    await client.waitReady();
    await client.close(); // Should not throw

    assert.equal(closer.mock.callCount(), 1);
  });
});

describe('onFlagEval', () => {
  test('should be called when flag is evaluated with get', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(42));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFlagEval(callback);

    client.get({}, 'flagA', 'default_value');

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], {
      value: 42,
      default: 'default_value',
      slug: 'flagA',
    });
  });

  test('should be called with default value when flag does not exist', async () => {
    fetchMock.get('https://api.tggl.io/config', '[]');

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFlagEval(callback);

    client.get({}, 'nonExistentFlag', 'default_value');

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], {
      value: 'default_value',
      default: 'default_value',
      slug: 'nonExistentFlag',
    });
  });

  test('should be called multiple times for multiple flag evaluations', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFlagEval(callback);

    client.get({}, 'flagA', 0);
    client.get({}, 'flagA', 'default');

    assert.equal(callback.mock.callCount(), 2);
    assert.deepEqual(callback.mock.calls[0].arguments[0], {
      value: 1,
      default: 0,
      slug: 'flagA',
    });
    assert.deepEqual(callback.mock.calls[1].arguments[0], {
      value: 1,
      default: 'default',
      slug: 'flagA',
    });
  });

  test('should handle multiple callbacks', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(42));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback1 = mock.fn();
    const callback2 = mock.fn();
    client.onFlagEval(callback1);
    client.onFlagEval(callback2);

    client.get({}, 'flagA', 'default');

    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);
    assert.deepEqual(callback1.mock.calls[0].arguments[0], {
      value: 42,
      default: 'default',
      slug: 'flagA',
    });
    assert.deepEqual(callback2.mock.calls[0].arguments[0], {
      value: 42,
      default: 'default',
      slug: 'flagA',
    });
  });

  test('unsubscribe should stop callback from being called', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(42));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback = mock.fn();
    const unsubscribe = client.onFlagEval(callback);

    client.get({}, 'flagA', 'default');
    assert.equal(callback.mock.callCount(), 1);

    unsubscribe();
    callback.mock.resetCalls();

    client.get({}, 'flagA', 'default');
    assert.equal(callback.mock.callCount(), 0);
  });

  test('should handle callbacks with complex flag values', async () => {
    fetchMock.get(
      'https://api.tggl.io/config',
      flagAConfig({ nested: { value: 123 } })
    );

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFlagEval(callback);

    client.get({}, 'flagA', { default: 'object' });

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], {
      value: { nested: { value: 123 } },
      default: { default: 'object' },
      slug: 'flagA',
    });
  });

  test('should handle callback exceptions gracefully', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(42));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback1 = mock.fn(() => {
      throw new Error('Callback error');
    });
    const callback2 = mock.fn();

    client.onFlagEval(callback1);
    client.onFlagEval(callback2);

    // Should not throw even if callback1 throws
    client.get({}, 'flagA', 'default');

    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);
  });

  test('should handle async callback exceptions gracefully', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(42));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback1 = mock.fn(async () => {
      throw new Error('Callback error');
    });
    const callback2 = mock.fn();

    client.onFlagEval(callback1);
    client.onFlagEval(callback2);

    // Should not throw even if callback1 throws
    client.get({}, 'flagA', 'default');

    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);
  });
});

describe('onFetchSuccessful', () => {
  test('should be called after initial successful fetch', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(42));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    const callback = mock.fn();
    client.onFetchSuccessful(callback);

    assert.equal(callback.mock.callCount(), 0);

    await client.waitReady();

    assert.equal(callback.mock.callCount(), 1);
  });

  test('should not be called on fetch error', async () => {
    fetchMock.get('https://api.tggl.io/config', 500);

    const client = new TgglLocalClient({
      maxRetries: 0,
      reporting: false,
      pollingIntervalMs: 0,
    });

    const callback = mock.fn();
    client.onFetchSuccessful(callback);

    await client.waitReady();

    assert.equal(callback.mock.callCount(), 0);
  });

  test('should be called after successful refetch', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), { repeat: 1 });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFetchSuccessful(callback);

    await client.refetch();

    assert.equal(callback.mock.callCount(), 1);
  });

  test('should handle multiple callbacks', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(42));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    const callback1 = mock.fn();
    const callback2 = mock.fn();
    client.onFetchSuccessful(callback1);
    client.onFetchSuccessful(callback2);

    await client.waitReady();

    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);
  });

  test('unsubscribe should stop callback from being called', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), { repeat: 1 });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback = mock.fn();
    const unsubscribe = client.onFetchSuccessful(callback);

    await client.refetch();
    assert.equal(callback.mock.callCount(), 1);

    unsubscribe();
    callback.mock.resetCalls();

    await client.refetch();
    assert.equal(callback.mock.callCount(), 0);
  });

  test('should be called on successful polling', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), { repeat: 1 });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2));

    const client = new TgglLocalClient({
      pollingIntervalMs: 100,
      reporting: false,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFetchSuccessful(callback);

    // Wait for polling to trigger
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.equal(callback.mock.callCount(), 1);
  });

  test('should not be called on failed polling', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), { repeat: 1 });
    fetchMock.get('https://api.tggl.io/config', 500);

    const client = new TgglLocalClient({
      pollingIntervalMs: 100,
      maxRetries: 0,
      reporting: false,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFetchSuccessful(callback);

    // Wait for polling to trigger
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.equal(callback.mock.callCount(), 0);
  });

  test('should be called after error is cleared', async () => {
    fetchMock.get('https://api.tggl.io/config', 500, { repeat: 1 });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(42));

    const client = new TgglLocalClient({
      maxRetries: 0,
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
    assert.notEqual(client.getError(), null);

    const callback = mock.fn();
    client.onFetchSuccessful(callback);

    await client.refetch();

    assert.equal(callback.mock.callCount(), 1);
    assert.equal(client.getError(), null);
  });

  test('should be called once error has been reset', async () => {
    fetchMock.get('https://api.tggl.io/config', 500, { repeat: 1 });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const client = new TgglLocalClient({
      maxRetries: 0,
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();
    assert.notEqual(client.getError(), null);

    let error: any = 'callback never called';
    client.onFetchSuccessful(() => {
      error = client.getError();
    });

    await client.refetch();

    assert.equal(error, null);
  });

  test('should be called once ready has been set', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    let ready: any = 'callback never called';
    client.onFetchSuccessful(() => {
      ready = client.isReady();
    });

    await client.waitReady();

    assert.equal(ready, true);
  });

  test('should handle callback exceptions gracefully', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(42));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    const callback1 = mock.fn(() => {
      throw new Error('Callback error');
    });
    const callback2 = mock.fn();

    client.onFetchSuccessful(callback1);
    client.onFetchSuccessful(callback2);

    // Should not throw even if callback1 throws
    await client.waitReady();

    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);
  });

  test('should handle async callback exceptions gracefully', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(42));

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    const callback1 = mock.fn(async () => {
      throw new Error('Callback error');
    });
    const callback2 = mock.fn();

    client.onFetchSuccessful(callback1);
    client.onFetchSuccessful(callback2);

    // Should not throw even if callback1 throws
    await client.waitReady();

    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);
  });

  test('should be called after successful retry', async () => {
    fetchMock.get('https://api.tggl.io/config', 500, { repeat: 2 });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(42));

    const client = new TgglLocalClient({
      maxRetries: 2,
      reporting: false,
      pollingIntervalMs: 0,
    });

    const callback = mock.fn();
    client.onFetchSuccessful(callback);

    await client.waitReady();

    assert.equal(callback.mock.callCount(), 1);
  });

  test('should be called multiple times for multiple successful fetches', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), { repeat: 1 });
    fetchMock.get('https://api.tggl.io/config', flagAConfig(2), { repeat: 1 });
    fetchMock.get('https://api.tggl.io/config', '{"flagA": 3}');

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    const callback = mock.fn();
    client.onFetchSuccessful(callback);

    await client.waitReady();
    assert.equal(callback.mock.callCount(), 1);

    await client.refetch();
    assert.equal(callback.mock.callCount(), 2);
  });

  test('should be called even when flags do not change', async () => {
    fetchMock.get('https://api.tggl.io/config', flagAConfig(1), { repeat: 2 });

    const client = new TgglLocalClient({
      reporting: false,
      pollingIntervalMs: 0,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFetchSuccessful(callback);

    await client.refetch();

    assert.equal(callback.mock.callCount(), 1);
  });
});
