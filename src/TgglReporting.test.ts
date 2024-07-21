import { PACKAGE_VERSION } from './TgglReporting'
import { version } from '../package.json'

test('Check package version', () => {
  expect(PACKAGE_VERSION).toBe(version)
})
