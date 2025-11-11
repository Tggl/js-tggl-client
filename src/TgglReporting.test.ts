import { before, beforeEach, describe, test } from 'node:test';
import fetchMock from 'fetch-mock';
import assert from 'node:assert/strict';
import { TgglReporting } from './TgglReporting';

before(() => {
  fetchMock.mockGlobal();
});

beforeEach(() => {
  fetchMock.clearHistory();
  fetchMock.removeRoutes();
});

describe('API call specs', () => {
  test('check API call headers', async () => {
    fetchMock.post('https://api.tggl.io/report', 200);

    const reporting = new TgglReporting();
    reporting.reportFlag({
      value: 42,
      default: 0,
      slug: 'flagA',
      clientId: 'my-client-id',
    });
    await reporting.flush();

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
  });

  test('passing apiKey to constructor should add header', async () => {
    fetchMock.post('https://api.tggl.io/report', 200);

    const reporting = new TgglReporting({
      apiKey: 'my_api_key',
    });
    reporting.reportFlag({
      value: 42,
      default: 0,
      slug: 'flagA',
      clientId: 'my-client-id',
    });
    await reporting.flush();

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
  test('should retry on failure', async () => {
    fetchMock.post('https://api.tggl.io/report', 500, { repeat: 1 });
    fetchMock.post('https://api.tggl.io/report', 500, { repeat: 1 });
    fetchMock.post('https://api.tggl.io/report', 200, { repeat: 1 });

    const reporting = new TgglReporting();
    reporting.reportFlag({
      value: 42,
      default: 0,
      slug: 'flagA',
      clientId: 'my-client-id',
    });
    await reporting.flush();

    assert.equal(fetchMock.callHistory.callLogs.length, 3);
  });

  test('fallback baseUrls', async () => {
    fetchMock.post('https://my-proxy.com/report', 500);
    fetchMock.post('https://api.tggl.io/report', 500, { repeat: 1 });
    fetchMock.post('https://api.tggl.io/report', 200);

    const reporting = new TgglReporting({
      baseUrls: ['https://my-proxy.com'],
    });
    reporting.reportFlag({
      value: 42,
      default: 0,
      slug: 'flagA',
      clientId: 'my-client-id',
    });
    await reporting.flush();

    assert.equal(fetchMock.callHistory.callLogs.length, 5);
  });

  test('should retry on next flush when too many failures', async () => {
    fetchMock.post('https://api.tggl.io/report', 500, { repeat: 1 });
    fetchMock.post('https://api.tggl.io/report', 500, { repeat: 1 });
    fetchMock.post('https://api.tggl.io/report', 500, { repeat: 1 });
    fetchMock.post('https://api.tggl.io/report', 200, { repeat: 1 });

    const reporting = new TgglReporting({
      apiKey: 'my_api_key',
    });
    reporting.reportFlag({
      value: 42,
      default: 0,
      slug: 'flagA',
      clientId: 'my-client-id',
    });
    await reporting.flush();

    assert.equal(fetchMock.callHistory.callLogs.length, 3);

    await reporting.flush();

    assert.equal(fetchMock.callHistory.callLogs.length, 4);
  });
});

describe('throttling flushes', () => {
  test('should flush only once when called multiple times rapidly', async () => {
    fetchMock.post('https://api.tggl.io/report', 200);

    const reporting = new TgglReporting({
      apiKey: 'my_api_key',
      flushIntervalMs: 50,
    });
    reporting.reportFlag({
      value: 42,
      default: 0,
      slug: 'flagA',
      clientId: 'my-client-id',
    });
    reporting.reportFlag({
      value: 3.14,
      default: 0,
      slug: 'flagB',
      clientId: 'my-client-id',
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(fetchMock.callHistory.callLogs.length, 1);
  });
});

describe('start/stop/isActive', () => {
  test('should start reporting when started', () => {
    const reporting = new TgglReporting();
    reporting.start();
    assert.equal(reporting.isActive(), true);
  });

  test('should stop reporting when stopped', () => {
    const reporting = new TgglReporting();
    reporting.start();
    reporting.stop();
    assert.equal(reporting.isActive(), false);
  });

  test('should still report when stopped but manually flushed', async () => {
    fetchMock.post('https://api.tggl.io/report', 200);
    const reporting = new TgglReporting();
    reporting.stop();
    reporting.reportFlag({
      value: 42,
      default: 0,
      slug: 'flagA',
      clientId: 'my-client-id',
    });
    await reporting.flush();
    assert.equal(fetchMock.callHistory.callLogs.length, 1);
  });
});

describe('reportFlag aggregation', () => {
  test('should aggregate multiple flags into one report', async () => {
    fetchMock.post('https://api.tggl.io/report', 200);
    const reporting = new TgglReporting({
      apiKey: 'my_api_key',
      flushIntervalMs: 50,
    });
    reporting.reportFlag({
      value: 42,
      default: 0,
      slug: 'flagA',
      clientId: 'my-client-id',
    });
    reporting.reportFlag({
      value: 3.14,
      default: 0,
      slug: 'flagB',
      clientId: 'my-client-id',
    });
    await reporting.flush();
    const call = fetchMock.callHistory.callLogs[0];
    assert.deepEqual(JSON.parse(call.options.body as string), {
      clients: [
        {
          id: 'my-client-id',
          flags: {
            flagA: [{ count: 1, default: 0, value: 42 }],
            flagB: [{ count: 1, default: 0, value: 3.14 }],
          },
        },
      ],
    });
  });

  test('should merge same flag reported multiple times', async () => {
    fetchMock.post('https://api.tggl.io/report', 200);
    const reporting = new TgglReporting({
      apiKey: 'my_api_key',
      flushIntervalMs: 50,
    });
    reporting.reportFlag({
      value: 42,
      default: 0,
      slug: 'flagA',
      clientId: 'my-client-id',
    });
    reporting.reportFlag({
      value: 42,
      default: 0,
      slug: 'flagA',
      clientId: 'my-client-id',
    });
    reporting.reportFlag({
      value: 3.14,
      default: 0,
      slug: 'flagA',
      clientId: 'my-client-id',
    });
    await reporting.flush();
    const call = fetchMock.callHistory.callLogs[0];
    assert.deepEqual(JSON.parse(call.options.body as string), {
      clients: [
        {
          id: 'my-client-id',
          flags: {
            flagA: [
              { count: 2, default: 0, value: 42 },
              { count: 1, default: 0, value: 3.14 },
            ],
          },
        },
      ],
    });
  });
});

describe('flush with no data', () => {
  test('should not call API if there is no data to report', async () => {
    fetchMock.post('https://api.tggl.io/report', 200);
    const reporting = new TgglReporting();
    await reporting.flush();
    assert.equal(fetchMock.callHistory.callLogs.length, 0);
  });
});
