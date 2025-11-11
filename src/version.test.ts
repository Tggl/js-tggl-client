import { PACKAGE_VERSION } from './version.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';

test('version should match package.json', async () => {
  const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
  assert.equal(PACKAGE_VERSION, packageJson.version);
});
