import { PACKAGE_VERSION } from './version.ts';
import packageJson from '../../js-tggl-client-v2/package.json';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('version should match package.json', () => {
  assert.equal(PACKAGE_VERSION, packageJson.version);
});
