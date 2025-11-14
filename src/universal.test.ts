import getTests from '../testData/get.json';
import reportingTests from '../testData/reporting.json';
import { before, beforeEach, describe, test } from 'node:test';
import { TgglStaticClient } from './TgglStaticClient';
import { TgglReporting } from './TgglReporting';
import assert from 'node:assert/strict';
import fetchMock from 'fetch-mock';

before(() => {
  fetchMock.mockGlobal();
});

beforeEach(() => {
  fetchMock.clearHistory();
  fetchMock.removeRoutes();
});

describe('get tests', () => {
  for (const { name, value, response, defaultValue, flag } of getTests) {
    test('get ' + name, async () => {
      const client = new TgglStaticClient<any>({
        flags: response,
        reporting: new TgglReporting({
          flushIntervalMs: 0,
        }),
      });

      assert.deepEqual(client.get(flag, defaultValue) ?? null, value);
    });
  }
});

describe('get tests', () => {
  Date.now = () => 123456789000;

  for (const { name, clientId, calls, result } of reportingTests) {
    test(name, async () => {
      const reporting = new TgglReporting({ flushIntervalMs: 0 });

      for (const call of calls as any[]) {
        if (call.type === 'flag') {
          reporting.reportFlag({
            value: call.value,
            default: call.defaultValue,
            slug: call.slug,
            clientId: clientId,
          });
        }

        if (call.type === 'context') {
          reporting.reportContext(call.context);
        }
      }

      fetchMock.post('https://api.tggl.io/report', 200);
      await reporting.flush();

      const call = fetchMock.callHistory.callLogs[0];
      if (result) {
        assert.equal(
          fetchMock.callHistory.callLogs.length,
          1,
          'API should be called once'
        );
        assert.deepEqual(JSON.parse(call.options.body as string), result);
      } else {
        assert.equal(
          fetchMock.callHistory.callLogs.length,
          0,
          'API should not have been called'
        );
      }
    });
  }
});
