import { PACKAGE_VERSION, TgglReporting } from './TgglReporting'
import { version } from '../package.json'
import { apiCall } from './apiCall'
import reportingTests from '../testData/reporting.json'

jest.mock('./apiCall')
jest.useFakeTimers()

const expectReporting = (expected: any) => {
  jest.advanceTimersByTime(10_000)

  if (expected === null) {
    expect(apiCall).not.toHaveBeenCalled()
  } else {
    expect(apiCall).toHaveBeenCalledTimes(1)
    expect(apiCall).toHaveBeenCalledWith({
      apiKey: 'API_KEY',
      url: 'https://api.tggl.io/report',
      method: 'post',
      body: expected,
    })
  }
}

test('Check package version', () => {
  expect(PACKAGE_VERSION).toBe(version)
})

for (const { name, app, appPrefix, calls, result } of reportingTests) {
  test(name, () => {
    const reporting = new TgglReporting({ apiKey: 'API_KEY', app, appPrefix })
    jest.setSystemTime(123456789000)

    for (const call of calls as any[]) {
      if (call.type === 'flag') {
        reporting.reportFlag(call.slug, {
          active: call.active,
          value: call.value,
          default: call.defaultValue,
        })
      }

      if (call.type === 'context') {
        reporting.reportContext(call.context)
      }
    }

    expectReporting(result)
  })
}
