/* eslint-disable @typescript-eslint/ban-ts-comment */
import { TgglClient } from './TgglClient.js';
import { before, beforeEach, test, after, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import fetchMock from 'fetch-mock';
import { PACKAGE_VERSION } from './version.js';
import { TgglReporting } from './TgglReporting.js';
import { TgglStorage } from './types.js';
import { TgglClientStateSerializer } from './serializers.js';

before(() => {
  fetchMock.mockGlobal();
});

beforeEach(() => {
  fetchMock.clearHistory();
  fetchMock.removeRoutes();
});

describe('API call specs', () => {
  test('check API call headers and content', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{}');

    const client = new TgglClient({
      initialContext: { foo: 'bar' },
      reporting: false,
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
      headers.has('content-length'),
      true,
      'Content-Length header should be present'
    );
    assert.equal(
      headers.has('x-tggl-api-key'),
      false,
      'X-Tggl-Api-Key header should not be present'
    );
    assert.equal(
      headers.get('content-type'),
      'application/json',
      'Content-Type should be application/json'
    );
    assert.equal(
      call.options.body,
      '{"foo":"bar"}',
      'Request body should match'
    );
  });

  test('passing apiKey to constructor should add header', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{}');

    const client = new TgglClient({
      apiKey: 'my_api_key',
      reporting: false,
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
    fetchMock.post('https://api.tggl.io/flags', 500, { repeat: 2 });
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 42 }');

    const client = new TgglClient({
      maxRetries: 2,
      reporting: false,
    });

    await client.waitReady();

    const calls = fetchMock.callHistory.callLogs;
    assert.equal(calls.length, 3);

    assert.equal(client.get('flagA', 'my_default'), 42);
    assert.equal(client.get('flagB', 'my_default'), 'my_default');
  });

  test('max retry taken into account', async () => {
    fetchMock.post('https://api.tggl.io/flags', 500);

    const client = new TgglClient({
      maxRetries: 2,
      reporting: false,
    });

    await client.waitReady();

    const calls = fetchMock.callHistory.callLogs;
    assert.equal(calls.length, 3);
  });

  test('retry after timeout', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 42 ', {
      delay: 1_000,
      repeat: 2,
    });
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 42 }');

    const client = new TgglClient({
      maxRetries: 2,
      timeoutMs: 200,
      reporting: false,
    });

    await client.waitReady();

    const calls = fetchMock.callHistory.callLogs;
    assert.equal(calls.length, 3);

    assert.equal(client.get('flagA', 'my_default'), 42);
    assert.equal(client.get('flagB', 'my_default'), 'my_default');
  });

  test('do not retry on invalid json', async () => {
    fetchMock.post('https://api.tggl.io/flags', 'Hello World');

    const client = new TgglClient({
      maxRetries: 2,
      reporting: false,
    });

    await client.waitReady();

    const calls = fetchMock.callHistory.callLogs;
    assert.equal(calls.length, 1);

    assert.equal(
      client.getError()?.message,
      'Unexpected token \'H\', "Hello World" is not valid JSON'
    );
  });

  test('fallback urls with retry', async () => {
    fetchMock.post('https://my-proxy.com/api/flags', 500);
    fetchMock.post('https://api.tggl.io/flags', 500, { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', JSON.stringify({ flagA: 42 }));

    const client = new TgglClient({
      maxRetries: 2,
      baseUrls: ['https://my-proxy.com/api'],
      reporting: false,
    });

    await client.waitReady();

    const calls = fetchMock.callHistory.callLogs;
    assert.equal(calls.length, 5);

    assert.equal(client.get('flagA', 'my_default'), 42);
    assert.equal(client.get('flagB', 'my_default'), 'my_default');
  });
});

describe('error', () => {
  test('error should be last error', async () => {
    fetchMock.post('https://api.tggl.io/flags', 500, { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', 500, {
      repeat: 1,
      delay: 1_000,
    });
    fetchMock.post('https://api.tggl.io/flags', '{}', { repeat: 1 });

    const client = new TgglClient({
      maxRetries: 0,
      timeoutMs: 200,
      reporting: false,
    });

    await client.waitReady();

    assert.equal(
      client.getError()?.message,
      'Request failed with status code 500 Internal Server Error: POST https://api.tggl.io/flags'
    );

    await client.refetch();
    assert.equal(
      client.getError()?.message,
      'Request timed out: POST https://api.tggl.io/flags'
    );

    await client.refetch();
    assert.equal(client.getError(), null);
  });

  test('missing api key', async () => {
    fetchMock.post('https://api.tggl.io/flags', {
      body: '{"error":"Missing header X-Tggl-API-Key"}',
      status: 401,
    });

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    assert.equal(client.getError()?.message, 'Missing header X-Tggl-API-Key');
    assert.equal(fetchMock.callHistory.callLogs.length, 1);
  });

  test('onError callback should be called after each error until unsubscribe', async () => {
    fetchMock.post('https://api.tggl.io/flags', 500, { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', 500, {
      repeat: 1,
      delay: 1_000,
    });
    fetchMock.post('https://api.tggl.io/flags', 500, { repeat: 1 });

    const client = new TgglClient({
      maxRetries: 0,
      timeoutMs: 100,
      reporting: false,
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
      'Request failed with status code 500 Internal Server Error: POST https://api.tggl.io/flags'
    );

    assert.equal(callback2.mock.callCount(), 1);
    assert.equal(
      callback2.mock.calls[0].arguments[0].message,
      'Request failed with status code 500 Internal Server Error: POST https://api.tggl.io/flags'
    );

    // Second error
    callback1.mock.resetCalls();
    callback2.mock.resetCalls();

    await client.refetch();
    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(
      callback1.mock.calls[0].arguments[0].message,
      'Request timed out: POST https://api.tggl.io/flags'
    );

    assert.equal(callback2.mock.callCount(), 1);
    assert.equal(
      callback2.mock.calls[0].arguments[0].message,
      'Request timed out: POST https://api.tggl.io/flags'
    );

    // Third error after unsubscribing second callback
    unsub2();
    callback1.mock.resetCalls();
    callback2.mock.resetCalls();
    await client.refetch();
    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(
      callback1.mock.calls[0].arguments[0].message,
      'Request failed with status code 500 Internal Server Error: POST https://api.tggl.io/flags'
    );

    assert.equal(callback2.mock.callCount(), 0);
  });

  test('onError callback should be called after ready is set', async () => {
    fetchMock.post('https://api.tggl.io/flags', 500, { repeat: 1 });

    const client = new TgglClient({
      maxRetries: 0,
      reporting: false,
    });

    let ready: any = 'callback not called';
    client.onError(() => (ready = client.isReady()));

    await client.waitReady();
    assert.equal(ready, true);
  });

  test('onError callback should be called even if one throws', async () => {
    fetchMock.post('https://api.tggl.io/flags', 500, { repeat: 1 });

    const client = new TgglClient({
      maxRetries: 0,
      timeoutMs: 100,
      reporting: false,
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
    fetchMock.post('https://api.tggl.io/flags', 500, { repeat: 1 });

    const client = new TgglClient({
      maxRetries: 0,
      timeoutMs: 100,
      reporting: false,
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

describe('context persistence', () => {
  test('context should be persisted', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{}', { delay: 100 });
    const client = new TgglClient({
      initialContext: {
        foo: 'bar',
      },
      reporting: false,
    });

    assert.deepEqual(client.getContext(), { foo: 'bar' });

    await client.waitReady();
    assert.deepEqual(client.getContext(), { foo: 'bar' });

    const promise = client.setContext({ foo: 'quxx' });

    assert.deepEqual(client.getContext(), { foo: 'bar' });

    await promise;
    assert.deepEqual(client.getContext(), { foo: 'quxx' });
  });

  test('context should not be persisted on error', async () => {
    fetchMock.post('https://api.tggl.io/flags', 500);

    const client = new TgglClient({
      maxRetries: 0,
      initialContext: {
        foo: 'bar',
      },
      reporting: false,
    });

    await client.waitReady();

    assert.deepEqual(client.getContext(), { foo: 'bar' });

    await client.setContext({ foo: 'quxx' });

    assert.deepEqual(client.getContext(), { foo: 'bar' });
  });
});

describe('isReady', () => {
  test('is ready after first call', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{}', { delay: 100 });

    const client = new TgglClient({
      reporting: false,
    });

    assert.equal(client.isReady(), false);
    await client.waitReady();
    assert.equal(client.isReady(), true);
  });

  test('all onReady callbacks are called after first call', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{}', { delay: 50 });

    const client = new TgglClient({
      reporting: false,
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
    fetchMock.post('https://api.tggl.io/flags', 500);

    const client = new TgglClient({
      maxRetries: 0,
      reporting: false,
    });

    const callback = mock.fn();

    client.onReady(callback);

    await client.waitReady();
    assert.equal(callback.mock.callCount(), 1);
  });

  test('onReady callback is called after error is set', async () => {
    fetchMock.post('https://api.tggl.io/flags', 500);

    const client = new TgglClient({
      maxRetries: 0,
      reporting: false,
    });

    let error: any = new Error('callback not called');
    client.onReady(() => (error = client.getError()));

    await client.waitReady();
    assert.equal(
      error.message,
      'Request failed with status code 500 Internal Server Error: POST https://api.tggl.io/flags'
    );
  });

  test('onReady callback is called immediately if already ready', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{}', { delay: 50 });

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onReady(callback);

    assert.equal(callback.mock.callCount(), 1);
  });

  test('is ready after first call that fails', async () => {
    fetchMock.post('https://api.tggl.io/flags', 500, { delay: 100 });

    const client = new TgglClient({
      reporting: false,
    });

    assert.equal(client.isReady(), false);
    await client.waitReady();
    assert.equal(client.isReady(), true);
  });
});

describe('setContext concurrency', () => {
  test('setContext resolves when last call resolves', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 0}', { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', {
      repeat: 1,
      delay: 50,
    });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 2}', {
      repeat: 1,
      delay: 100,
    });

    const client = new TgglClient({
      reporting: false,
    });
    await client.waitReady();

    const p1 = client.setContext({});
    const p2 = client.setContext({});

    await p1;
    assert.equal(client.get('flagA', 0), 2);
    await p2;
    assert.equal(client.get('flagA', 0), 2);
  });

  test('setContext resolves when last call resolves unordered responses', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 0}', { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', {
      repeat: 1,
      delay: 100,
    });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 2}', {
      repeat: 1,
      delay: 50,
    });

    const client = new TgglClient({
      reporting: false,
    });
    await client.waitReady();

    const p1 = client.setContext({});
    const p2 = client.setContext({});

    await p2;
    assert.equal(client.get('flagA', 0), 2);
    await p1;
    assert.equal(client.get('flagA', 0), 2);
  });
});

describe('get', () => {
  test('flags should be completely overwritten each time', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{"flagB": 2}', { repeat: 1 });

    const client = new TgglClient({
      reporting: false,
    });
    await client.waitReady();

    assert.deepEqual(client.getAll(), { flagA: 1 });
    await client.setContext({});
    assert.deepEqual(client.getAll(), { flagB: 2 });
  });

  test('falsy values should be returned directly, not the default value', async () => {
    fetchMock.post(
      'https://api.tggl.io/flags',
      '{"flagA": null, "flagB": false, "flagC": 0, "flagD": ""}'
    );

    const client = new TgglClient({
      reporting: false,
    });
    await client.waitReady();

    assert.equal(client.get('flagA', 'my_default'), null);
    assert.equal(client.get('flagB', 'my_default'), false);
    assert.equal(client.get('flagC', 'my_default'), 0);
    assert.equal(client.get('flagD', 'my_default'), '');
  });
  test('unknown flags should return the default value', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{}');

    const client = new TgglClient({
      reporting: false,
    });
    await client.waitReady();

    assert.equal(client.get('flagA', 'my_default'), 'my_default');
  });
});

describe('polling', () => {
  test('polling disabled by default', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const client = new TgglClient({
      reporting: false,
    });
    await client.waitReady();

    fetchMock.clearHistory();

    // Wait a bit to ensure no polling happens
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.equal(
      fetchMock.callHistory.callLogs.length,
      0,
      'Should not poll when polling is disabled'
    );
  });

  test('polling at specified interval', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 1 }', {
      repeat: 1,
    });
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 2 }', {
      repeat: 1,
    });
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 3 }', {
      repeat: 1,
    });

    const client = new TgglClient({
      pollingIntervalMs: 100,
      reporting: false,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();
    assert.equal(
      client.get('flagA', 0),
      1,
      'Initial call should set flagA to 1'
    );

    // Wait for first poll
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      client.get('flagA', 0),
      2,
      'First poll should update flagA to 2'
    );

    // Wait for second poll
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      client.get('flagA', 0),
      3,
      'Second poll should update flagA to 3'
    );
  });

  test('stopPolling should stop polling', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 1 }', {
      repeat: 1,
    });
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 2 }', {
      repeat: 1,
    });
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 3 }', {
      repeat: 1,
    });

    const client = new TgglClient({
      pollingIntervalMs: 100,
      reporting: false,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 0), 1);

    client.stopPolling();

    // Wait to ensure no more polling happens
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(client.get('flagA', 0), 1);
  });

  test('startPolling should start polling immediately when previously disabled', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 1 }', {
      repeat: 1,
    });
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 2 }', {
      repeat: 1,
    });
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 3 }', {
      repeat: 1,
    });

    const client = new TgglClient({
      reporting: false,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 0), 1);

    client.startPolling(100);

    // Wait for first poll
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(client.get('flagA', 0), 2);

    // Wait for first poll
    await new Promise((resolve) => setTimeout(resolve, 130));
    assert.equal(client.get('flagA', 0), 3);
  });

  test('startPolling with 0 or less should stop polling', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 1 }', {
      repeat: 1,
    });
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 2 }', {
      repeat: 1,
    });
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 3 }', {
      repeat: 1,
    });

    const client = new TgglClient({
      pollingIntervalMs: 100,
      reporting: false,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 0), 1);

    client.startPolling(-1);

    // Wait to ensure no more polling happens
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(client.get('flagA', 0), 1);
  });

  test('changing polling interval should change after the next polling', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 1 }', {
      repeat: 1,
    });
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 2 }', {
      repeat: 1,
    });
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 3 }', {
      repeat: 1,
    });

    const client = new TgglClient({
      pollingIntervalMs: 100,
      reporting: false,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 0), 1);

    // Change to faster polling
    client.startPolling(30);

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(client.get('flagA', 0), 1);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(client.get('flagA', 0), 2);

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(client.get('flagA', 0), 3);
  });

  test('setContext should cancel scheduled polling and reschedule', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 1 }', {
      repeat: 1,
    });
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 2 }', {
      repeat: 1,
    });
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 3 }', {
      repeat: 1,
    });

    const client = new TgglClient({
      pollingIntervalMs: 200,
      initialContext: { userId: '1' },
      reporting: false,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 0), 1);

    // Call setContext before the poll would happen
    await new Promise((resolve) => setTimeout(resolve, 150));
    await client.refetch();
    assert.equal(client.get('flagA', 0), 2);

    // Next poll should happen 200ms after setContext
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(client.get('flagA', 0), 2);

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(client.get('flagA', 0), 3);
  });

  test('polling should continue after errors', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 1 }', {
      repeat: 1,
    });
    fetchMock.post('https://api.tggl.io/flags', 500, { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{ "flagA": 3 }', {
      repeat: 1,
    });

    const client = new TgglClient({
      pollingIntervalMs: 100,
      maxRetries: 0,
      reporting: false,
    });

    after(() => {
      client.stopPolling();
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 0), 1);
    assert.equal(client.getError(), null);

    // Wait for error poll
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(client.get('flagA', 0), 1, 'Flags should not change on error');
    assert.ok(client.getError() !== null, 'Should have an error');

    // Wait for next successful poll
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(client.get('flagA', 0), 3, 'Should recover after error');
    assert.equal(client.getError(), null, 'Error should be cleared');
  });
});

describe('reporting', () => {
  test('apiKey is passed down to reporting', () => {
    const client = new TgglClient({ apiKey: 'my_api_key' });

    //@ts-expect-error
    assert.equal(client.getReporting()._apiKey, 'my_api_key');
  });

  test('passing true as reporting option enables reporting', () => {
    const client = new TgglClient({ reporting: true });

    assert.equal(client.getReporting().isActive(), true);
  });

  test('passing false as reporting option disables reporting', () => {
    const client = new TgglClient({ reporting: false });

    assert.equal(client.getReporting().isActive(), false);
  });

  test('passing an existing reporting as option should work', () => {
    const reporting = new TgglReporting();
    const client = new TgglClient({ reporting });

    assert.equal(client.getReporting(), reporting);
  });

  test('calling get should report usage', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 42}');
    fetchMock.post('https://api.tggl.io/report', 200, { name: 'reporting' });

    const client = new TgglClient({
      reporting: {
        flushIntervalMs: 1,
      },
    });
    await client.waitReady();

    client.get('flagA', 'default_value');

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepEqual(
      JSON.parse(
        fetchMock.callHistory.lastCall('reporting')?.options.body as string
      ),
      {
        clients: [
          {
            id: `js-client:${PACKAGE_VERSION}/TgglClient`,
            flags: {
              flagA: [{ value: 42, default: 'default_value', count: 1 }],
            },
          },
        ],
      }
    );
  });

  test('appName should be passed down to reporting', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 42}');
    fetchMock.post('https://api.tggl.io/report', 200, { name: 'reporting' });

    const client = new TgglClient({
      appName: 'MyApp',
      reporting: {
        flushIntervalMs: 1,
      },
    });
    await client.waitReady();

    client.get('flagA', 'default_value');

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepEqual(
      JSON.parse(
        fetchMock.callHistory.lastCall('reporting')?.options.body as string
      ),
      {
        clients: [
          {
            id: `js-client:${PACKAGE_VERSION}/TgglClient/MyApp`,
            flags: {
              flagA: [{ value: 42, default: 'default_value', count: 1 }],
            },
          },
        ],
      }
    );
  });
});

describe('flags change events', () => {
  test('onFlagsChange should be called when flags change via setContext', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });
    fetchMock.post(
      'https://api.tggl.io/flags',
      '{"flagA": 2, "flagB": "test"}'
    );

    const client = new TgglClient({
      reporting: false,
    });

    const callback = mock.fn();
    client.onFlagsChange(callback);

    await client.waitReady();
    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA']);

    callback.mock.resetCalls();
    await client.setContext({ userId: 123 });
    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA', 'flagB']);
  });

  test('onFlagsChange should be called with only changed flags', async () => {
    fetchMock.post(
      'https://api.tggl.io/flags',
      '{"flagA": 1, "flagB": {"foo":"bar"}}',
      { repeat: 1 }
    );
    fetchMock.post(
      'https://api.tggl.io/flags',
      '{"flagA": 2, "flagB": {"foo":"bar"}, "flagC": true}'
    );

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFlagsChange(callback);

    await client.setContext({ userId: 123 });

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA', 'flagC']);
  });

  test('onFlagsChange should be called when flags are removed', async () => {
    fetchMock.post(
      'https://api.tggl.io/flags',
      '{"flagA": 1, "flagB": "test", "flagC": null}',
      { repeat: 1 }
    );
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFlagsChange(callback);

    await client.setContext({ userId: 123 });

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagB', 'flagC']);
  });

  test('onFlagsChange should not be called when flags do not change', async () => {
    fetchMock.post(
      'https://api.tggl.io/flags',
      '{"flagA": 1, "flagB": "test"}',
      { repeat: 1 }
    );
    fetchMock.post(
      'https://api.tggl.io/flags',
      '{"flagB": "test", "flagA": 1}',
      { repeat: 1 }
    );

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFlagsChange(callback);

    await client.setContext({ userId: 123 });

    assert.equal(callback.mock.callCount(), 0);
  });

  test('onFlagsChange should handle multiple callbacks', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 2}');

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback1 = mock.fn();
    const callback2 = mock.fn();
    client.onFlagsChange(callback1);
    client.onFlagsChange(callback2);

    await client.setContext({ userId: 123 });

    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);
    assert.deepEqual(callback1.mock.calls[0].arguments[0], ['flagA']);
    assert.deepEqual(callback2.mock.calls[0].arguments[0], ['flagA']);
  });

  test('onFlagsChange unsubscribe should work correctly', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 2}', { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 3}');

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback1 = mock.fn();
    const callback2 = mock.fn();
    client.onFlagsChange(callback1);
    const unsubscribe = client.onFlagsChange(callback2);

    // First change - both callbacks called
    await client.setContext({ userId: 123 });
    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);

    // Unsubscribe callback2
    unsubscribe();

    // Second change - only callback1 called
    await client.setContext({ userId: 456 });
    assert.equal(callback1.mock.callCount(), 2);
    assert.equal(callback2.mock.callCount(), 1);
  });

  test('onFlagsChange should be called on initial call', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });

    const client = new TgglClient({
      reporting: false,
    });

    const callback = mock.fn();
    client.onFlagsChange(callback);

    await client.waitReady();

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA']);
  });

  test('onFlagsChange should be called once new values are ready', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });

    const client = new TgglClient({
      reporting: false,
    });

    let flagValue = 'callback never called';
    client.onFlagsChange(() => {
      flagValue = client.get('flagA', 'default value used in callback');
    });

    await client.waitReady();

    assert.equal(flagValue, 1);
  });

  test('onFlagsChange should be called once error has been reset', async () => {
    fetchMock.post('https://api.tggl.io/flags', 500, { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });

    const client = new TgglClient({
      maxRetries: 0,
      reporting: false,
    });

    await client.waitReady();
    assert.notEqual(client.getError(), null);

    let error: any = 'callback never called';
    client.onFlagsChange(() => {
      error = client.getError();
    });

    await client.refetch();

    assert.equal(error, null);
  });

  test('onFlagsChange should be called once ready has been set', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });

    const client = new TgglClient({
      maxRetries: 0,
      reporting: false,
    });

    let ready: any = 'callback never called';
    client.onFlagsChange(() => {
      ready = client.isReady();
    });

    await client.waitReady();

    assert.equal(ready, true);
  });

  test('onFlagChange should be called when specific flag changes', async () => {
    fetchMock.post(
      'https://api.tggl.io/flags',
      '{"flagA": 1, "flagB": "test"}',
      { repeat: 1 }
    );
    fetchMock.post(
      'https://api.tggl.io/flags',
      '{"flagA": 2, "flagB": "test"}'
    );

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callbackA = mock.fn();
    const callbackB = mock.fn();
    client.onFlagChange('flagA', callbackA);
    client.onFlagChange('flagB', callbackB);

    await client.setContext({ userId: 123 });

    assert.equal(callbackA.mock.callCount(), 1);
    assert.equal(callbackB.mock.callCount(), 0);
  });

  test('onFlagChange should be called when flag is added', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });
    fetchMock.post(
      'https://api.tggl.io/flags',
      '{"flagA": 1, "flagB": "test"}'
    );

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFlagChange('flagB', callback);

    await client.setContext({ userId: 123 });

    assert.equal(callback.mock.callCount(), 1);
  });

  test('onFlagChange should be called when flag is removed', async () => {
    fetchMock.post(
      'https://api.tggl.io/flags',
      '{"flagA": 1, "flagB": "test"}',
      { repeat: 1 }
    );
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback = mock.fn();

    client.onFlagChange('flagB', callback);
    await client.setContext({ userId: 123 });

    assert.equal(callback.mock.callCount(), 1);
  });

  test('onFlagChange should not be called when flag value stays the same', async () => {
    fetchMock.post(
      'https://api.tggl.io/flags',
      '{"flagA": 1, "flagB": "test"}',
      { repeat: 2 }
    );

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFlagChange('flagA', callback);

    await client.setContext({ userId: 123 });

    assert.equal(callback.mock.callCount(), 0);
  });

  test('onFlagChange should handle multiple listeners for same flag', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 2}');

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback1 = mock.fn();
    const callback2 = mock.fn();
    client.onFlagChange('flagA', callback1);
    client.onFlagChange('flagA', callback2);

    await client.setContext({ userId: 123 });

    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);
  });

  test('onFlagChange unsubscribe should work correctly', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 2}', { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 3}');

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback1 = mock.fn();
    const callback2 = mock.fn();
    client.onFlagChange('flagA', callback1);
    const unsubscribe = client.onFlagChange('flagA', callback2);

    // First change - both callbacks called
    await client.setContext({ userId: 123 });
    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);

    // Unsubscribe callback2
    unsubscribe();

    // Second change - only callback1 called
    await client.setContext({ userId: 456 });
    assert.equal(callback1.mock.callCount(), 2);
    assert.equal(callback2.mock.callCount(), 1);
  });

  test('onFlagsChange should be called when flags change via setFlags', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFlagsChange(callback);

    client.setFlags({ flagA: 2, flagB: 'test' });

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA', 'flagB']);
  });

  test('onFlagChange should be called when flag changes via setFlags', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFlagChange('flagA', callback);

    client.setFlags({ flagA: 2 });

    assert.equal(callback.mock.callCount(), 1);
  });

  test('onFlagsChange should handle complex value changes', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": {"nested": 1}}', {
      repeat: 1,
    });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": {"nested": 2}}');

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFlagsChange(callback);

    await client.setContext({ userId: 123 });

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA']);
  });

  test('onFlagsChange should not be called when error occurs during setContext', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', 500);

    const client = new TgglClient({
      maxRetries: 0,
      reporting: false,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFlagsChange(callback);

    await client.setContext({ userId: 123 });

    assert.equal(callback.mock.callCount(), 0);
  });

  test('onFlagsChange should work with polling', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 2}');

    const client = new TgglClient({
      pollingIntervalMs: 100,
      reporting: false,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFlagsChange(callback);

    assert.equal(callback.mock.callCount(), 0);

    // Wait for polling to trigger
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA']);

    client.stopPolling();
  });

  test('onFlagsChange should handle empty flags', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{}');

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback = mock.fn();
    client.onFlagsChange(callback);

    await client.setContext({ userId: 123 });

    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagA']);
  });

  test('onFlagsChange callback should handle exceptions gracefully', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 2}');

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback1 = mock.fn(() => {
      throw new Error('Callback error');
    });
    const callback2 = mock.fn();

    client.onFlagsChange(callback1);
    client.onFlagsChange(callback2);

    // Should not throw even if callback1 throws
    await client.setContext({ userId: 123 });

    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);
  });

  test('onFlagsChange callback should handle async exceptions gracefully', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 2}');

    const client = new TgglClient({
      reporting: false,
    });

    await client.waitReady();

    const callback1 = mock.fn(async () => {
      throw new Error('Callback error');
    });
    const callback2 = mock.fn();

    client.onFlagsChange(callback1);
    client.onFlagsChange(callback2);

    // Should not throw even if callback1 throws
    await client.setContext({ userId: 123 });

    assert.equal(callback1.mock.callCount(), 1);
    assert.equal(callback2.mock.callCount(), 1);
  });
});

describe('storages', () => {
  test('should load flags from storage on initialization but still use network', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": "from-network"}', {
      delay: 100,
    });

    const storage: TgglStorage = {
      get: () =>
        Promise.resolve(
          TgglClientStateSerializer.serialize({
            date: Date.now(),
            flags: { flagB: 'from-storage' },
          })
        ),
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage],
      reporting: false,
    });

    await client.waitReady();
    assert.equal(client.get('flagB', 'default'), 'from-storage');
    await new Promise((resolve) => setTimeout(resolve, 110));
    assert.equal(client.get('flagA', 'default'), 'from-network');
  });

  test('should use most recent storage when multiple storages provided', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', {
      delay: 100,
    });

    const storage1: TgglStorage = {
      get: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve(
              TgglClientStateSerializer.serialize({
                date: 1000,
                flags: { flagB: 'storage-1' },
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
              TgglClientStateSerializer.serialize({
                date: 2000,
                flags: { flagB: 'storage-2' },
              })
            );
          }, 50)
        ),
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage1, storage2],
      reporting: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(client.get('flagB', 'default'), 'storage-2');
  });

  test('should use most recent storage when multiple storages provided out of order', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', {
      delay: 100,
    });

    const storage1: TgglStorage = {
      get: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve(
              TgglClientStateSerializer.serialize({
                date: 1000,
                flags: { flagB: 'storage-1' },
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
              TgglClientStateSerializer.serialize({
                date: 2000,
                flags: { flagB: 'storage-2' },
              })
            );
          }, 10)
        ),
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage1, storage2],
      reporting: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(client.get('flagB', 'default'), 'storage-2');
  });

  test('should handle storage returning null gracefully', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const storage: TgglStorage = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage],
      reporting: false,
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 'default'), 1);
  });

  test('should handle storage returning undefined gracefully', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const storage: TgglStorage = {
      // @ts-expect-error
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage],
      reporting: false,
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 'default'), 1);
  });

  test('should handle storage throwing async errors gracefully', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const storage: TgglStorage = {
      get: () => Promise.reject(new Error('Storage error')),
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage],
      reporting: false,
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 'default'), 1);
  });

  test('should handle storage throwing errors gracefully', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const storage: TgglStorage = {
      get: () => {
        throw new Error('Storage error');
      },
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage],
      reporting: false,
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 'default'), 1);
  });

  test('should handle storage returning invalid JSON gracefully', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const storage: TgglStorage = {
      get: () => Promise.resolve('invalid json {'),
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage],
      reporting: false,
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 'default'), 1);
  });

  test('should handle storage with missing flags field', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const storage: TgglStorage = {
      get: () => Promise.resolve(JSON.stringify({ date: Date.now() })),
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage],
      reporting: false,
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 'default'), 1);
  });

  test('should handle storage with missing date field', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const storage: TgglStorage = {
      get: () =>
        Promise.resolve(JSON.stringify({ flags: { flagB: 'stored' } })),
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage],
      reporting: false,
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 'default'), 1);
  });

  test('should handle multiple storages with errors', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const storage1: TgglStorage = {
      get: () => Promise.reject(new Error('Error 1')),
      set: () => Promise.resolve(),
    };

    const storage2: TgglStorage = {
      get: () => Promise.reject(new Error('Error 2')),
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage1, storage2],
      reporting: false,
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 'default'), 1);
  });

  test('should handle mix of working and failing storages', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', {
      delay: 100,
    });

    const storage1: TgglStorage = {
      get: () => Promise.reject(new Error('Storage error')),
      set: () => Promise.resolve(),
    };

    const storage2: TgglStorage = {
      get: () =>
        Promise.resolve(
          TgglClientStateSerializer.serialize({
            date: Date.now(),
            flags: { flagB: 'from-storage' },
          })
        ),
      set: () => Promise.resolve(),
    };

    const storage3: TgglStorage = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage1, storage2, storage3],
      reporting: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(client.get('flagB', 'default'), 'from-storage');
  });

  test('should handle storage data loaded after initial fetch completes', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": "from-api"}');

    const storage: TgglStorage = {
      get: () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                TgglClientStateSerializer.serialize({
                  date: Date.now(),
                  flags: { flagA: 'from-storage' },
                })
              ),
            100
          )
        ),
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage],
      reporting: false,
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 'default'), 'from-api');

    // Storage loads after initial fetch
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(client.get('flagA', 'default'), 'from-api');
  });

  test('should trigger onFlagsChange when storage loads flags', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', {
      delay: 100,
    });

    const storage: TgglStorage = {
      get: () =>
        Promise.resolve(
          TgglClientStateSerializer.serialize({
            date: Date.now(),
            flags: { flagB: 'from-storage' },
          })
        ),
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage],
      reporting: false,
    });

    const callback = mock.fn();
    client.onFlagsChange(callback);

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(callback.mock.callCount(), 1);
    assert.deepEqual(callback.mock.calls[0].arguments[0], ['flagB']);
  });

  test('should handle empty flags from storage', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const storage: TgglStorage = {
      get: () =>
        Promise.resolve(
          TgglClientStateSerializer.serialize({
            date: Date.now(),
            flags: {},
          })
        ),
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage],
      reporting: false,
    });

    await client.waitReady();
  });

  test('should handle synchronous storage', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', {
      delay: 100,
    });

    const storage: TgglStorage = {
      get: () =>
        TgglClientStateSerializer.serialize({
          date: Date.now(),
          flags: { flagB: 'from-storage' },
        }),
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage],
      reporting: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(client.get('flagB', 'default'), 'from-storage');
  });

  test('should call set on all storage after successful network', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const setter = mock.fn();
    const storage: TgglStorage = {
      get: () => null,
      set: setter as any,
    };

    const client = new TgglClient({
      storages: [storage],
      reporting: false,
    });

    await client.waitReady();
    assert.equal(setter.mock.callCount(), 1);
    const state = TgglClientStateSerializer.deserialize(
      setter.mock.calls[0].arguments[0]
    );
    assert.deepEqual(state?.flags, { flagA: 1 });
  });

  test('should not call set on all storage after failed network', async () => {
    fetchMock.post('https://api.tggl.io/flags', 500);

    const setter = mock.fn();
    const storage: TgglStorage = {
      get: () => null,
      set: setter as any,
    };

    const client = new TgglClient({
      storages: [storage],
      maxRetries: 0,
      reporting: false,
    });

    await client.waitReady();
    assert.equal(setter.mock.callCount(), 0);
  });

  test('should not call set on all storage after successful storage get', async () => {
    fetchMock.post('https://api.tggl.io/flags', 500);

    const setter = mock.fn();
    const storage1: TgglStorage = {
      get: () =>
        Promise.resolve(
          TgglClientStateSerializer.serialize({
            date: Date.now(),
            flags: { flagB: 'from-storage' },
          })
        ),
      set: setter as any,
    };
    const storage2: TgglStorage = {
      get: () =>
        Promise.resolve(
          TgglClientStateSerializer.serialize({
            date: Date.now(),
            flags: { flagB: 'from-storage' },
          })
        ),
      set: setter as any,
    };

    const client = new TgglClient({
      storages: [storage1, storage2],
      maxRetries: 0,
      reporting: false,
    });

    await client.waitReady();
    assert.equal(setter.mock.callCount(), 0);
  });

  test('should handle throwing set storages', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

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

    new TgglClient({
      storages: [storage1, storage2],
      reporting: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(setter.mock.callCount(), 1);
  });

  test('should handle async throwing set storages', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

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

    new TgglClient({
      storages: [storage1, storage2],
      reporting: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(setter.mock.callCount(), 1);
  });
});

describe('close', () => {
  test('should stop polling when close is called', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}', { repeat: 1 });
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 2}');

    const client = new TgglClient({
      pollingIntervalMs: 100,
      reporting: false,
    });

    await client.waitReady();
    assert.equal(client.get('flagA', 0), 1);

    await client.close();

    // Wait to ensure no polling happens after close
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(client.get('flagA', 0), 1);
  });

  test('should stop reporting when close is called', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');
    fetchMock.post('https://api.tggl.io/report', 200, { name: 'reporting' });

    const client = new TgglClient({
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
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');
    fetchMock.post('https://api.tggl.io/report', 200, { name: 'reporting' });

    const client = new TgglClient({
      reporting: {
        flushIntervalMs: 0, // Manual flush is needed
      },
    });

    await client.waitReady();
    client.get('flagA', 'default');

    await client.close();

    const reportingCall = fetchMock.callHistory.lastCall('reporting');
    assert.notEqual(reportingCall, undefined);
  });

  test('should call close on all storages', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

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

    const client = new TgglClient({
      storages: [storage1, storage2],
      reporting: false,
    });

    await client.waitReady();
    await client.close();

    assert.equal(closer1.mock.callCount(), 1);
    assert.equal(closer2.mock.callCount(), 1);
  });

  test('should handle storages without close method', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

    const storage: TgglStorage = {
      get: () => null,
      set: () => Promise.resolve(),
    };

    const client = new TgglClient({
      storages: [storage],
      reporting: false,
    });

    await client.waitReady();
    await client.close(); // Should not throw
  });

  test('should handle throwing close storages', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

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

    const client = new TgglClient({
      storages: [storage1, storage2],
      reporting: false,
    });

    await client.waitReady();
    await client.close(); // Should not throw

    assert.equal(closer.mock.callCount(), 1);
  });

  test('should handle async throwing close storages', async () => {
    fetchMock.post('https://api.tggl.io/flags', '{"flagA": 1}');

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

    const client = new TgglClient({
      storages: [storage1, storage2],
      reporting: false,
    });

    await client.waitReady();
    await client.close(); // Should not throw

    assert.equal(closer.mock.callCount(), 1);
  });
});
