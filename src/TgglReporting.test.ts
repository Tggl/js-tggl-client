import { PACKAGE_VERSION, TgglReporting } from './TgglReporting'
import { version } from '../package.json'
import { apiCall } from './apiCall'

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

test('Nothing should happen', () => {
  new TgglReporting({ apiKey: 'API_KEY' })

  expectReporting(null)
})

test('Report single flag', () => {
  const reporting = new TgglReporting({ apiKey: 'API_KEY' })

  reporting.reportFlag('flagA', { active: true })

  expectReporting({
    clients: [
      {
        flags: {
          flagA: [
            {
              active: true,
              count: 1,
            },
          ],
        },
      },
    ],
  })
})

test('Report single flag with app', () => {
  const reporting = new TgglReporting({ apiKey: 'API_KEY', app: 'MyApp' })

  reporting.reportFlag('flagA', { active: true })

  expectReporting({
    clients: [
      {
        id: 'MyApp',
        flags: {
          flagA: [
            {
              active: true,
              count: 1,
            },
          ],
        },
      },
    ],
  })
})

test('Report single flag with app prefix', () => {
  const reporting = new TgglReporting({
    apiKey: 'API_KEY',
    appPrefix: 'client:1.2.3',
  })

  reporting.reportFlag('flagA', { active: true })

  expectReporting({
    clients: [
      {
        id: 'client:1.2.3',
        flags: {
          flagA: [
            {
              active: true,
              count: 1,
            },
          ],
        },
      },
    ],
  })
})

test('Report single flag with app and app prefix', () => {
  const reporting = new TgglReporting({
    apiKey: 'API_KEY',
    app: 'MyApp',
    appPrefix: 'client:1.2.3',
  })

  reporting.reportFlag('flagA', { active: true })

  expectReporting({
    clients: [
      {
        id: 'client:1.2.3/MyApp',
        flags: {
          flagA: [
            {
              active: true,
              count: 1,
            },
          ],
        },
      },
    ],
  })
})

test('Report single flag with value and default', () => {
  const reporting = new TgglReporting({ apiKey: 'API_KEY' })

  reporting.reportFlag('flagA', { active: true, value: 'foo', default: 'bar' })

  expectReporting({
    clients: [
      {
        flags: {
          flagA: [
            {
              active: true,
              count: 1,
              value: 'foo',
              default: 'bar',
            },
          ],
        },
      },
    ],
  })
})

test('Report multiple flags', () => {
  const reporting = new TgglReporting({ apiKey: 'API_KEY' })

  reporting.reportFlag('flagA', { active: true })
  reporting.reportFlag('flagB', { active: false })
  reporting.reportFlag('flagC', { active: true })

  expectReporting({
    clients: [
      {
        flags: {
          flagA: [
            {
              active: true,
              count: 1,
            },
          ],
          flagB: [
            {
              active: false,
              count: 1,
            },
          ],
          flagC: [
            {
              active: true,
              count: 1,
            },
          ],
        },
      },
    ],
  })
})

test('Report same flag, multiple times', () => {
  const reporting = new TgglReporting({ apiKey: 'API_KEY' })

  reporting.reportFlag('flagA', { active: true })
  reporting.reportFlag('flagA', { active: false })
  reporting.reportFlag('flagA', { active: false })
  reporting.reportFlag('flagA', { active: true })
  reporting.reportFlag('flagA', { active: true })
  reporting.reportFlag('flagA', { active: true })

  expectReporting({
    clients: [
      {
        flags: {
          flagA: [
            {
              active: true,
              count: 4,
            },
            {
              active: false,
              count: 2,
            },
          ],
        },
      },
    ],
  })
})

test('Report same flag, multiple times, with value an default', () => {
  const reporting = new TgglReporting({ apiKey: 'API_KEY' })

  reporting.reportFlag('flagA', { active: true })
  reporting.reportFlag('flagA', { active: true, value: null, default: null })
  reporting.reportFlag('flagA', { active: true, value: 'foo', default: 'bar' })
  reporting.reportFlag('flagA', { active: true, value: 'foo', default: 'bar' })
  reporting.reportFlag('flagA', { active: true, value: 'foo', default: 'baz' })
  reporting.reportFlag('flagA', { active: true, value: 'baz', default: 'bar' })

  expectReporting({
    clients: [
      {
        flags: {
          flagA: [
            {
              active: true,
              count: 1,
            },
            {
              active: true,
              count: 1,
              value: null,
              default: null,
            },
            {
              active: true,
              count: 2,
              value: 'foo',
              default: 'bar',
            },
            {
              active: true,
              count: 1,
              value: 'foo',
              default: 'baz',
            },
            {
              active: true,
              count: 1,
              value: 'baz',
              default: 'bar',
            },
          ],
        },
      },
    ],
  })
})

test('Report context with string value', () => {
  const reporting = new TgglReporting({ apiKey: 'API_KEY' })

  reporting.reportContext({ foo: 'bar' })

  expectReporting({
    receivedProperties: { foo: [expect.any(Number), expect.any(Number)] },
    receivedValues: { foo: [['bar']] },
  })
})

test('Report context with string value and label', () => {
  const reporting = new TgglReporting({ apiKey: 'API_KEY' })

  reporting.reportContext({ userId: 'abc', userName: 'Elon Musk' })

  expectReporting({
    receivedProperties: {
      userId: [expect.any(Number), expect.any(Number)],
      userName: [expect.any(Number), expect.any(Number)],
    },
    receivedValues: {
      userId: [['abc', 'Elon Musk']],
      userName: [['Elon Musk']],
    },
  })
})

test('Report context with non-string value', () => {
  const reporting = new TgglReporting({ apiKey: 'API_KEY' })

  reporting.reportContext({ foo: 0, bar: true, baz: null })

  expectReporting({
    receivedProperties: {
      foo: [expect.any(Number), expect.any(Number)],
      bar: [expect.any(Number), expect.any(Number)],
      baz: [expect.any(Number), expect.any(Number)],
    },
  })
})

test('Report multiple contexts', () => {
  const reporting = new TgglReporting({ apiKey: 'API_KEY' })

  reporting.reportContext({ foo: 0 })
  reporting.reportContext({ foo: 'bar' })
  reporting.reportContext({ foo: 'bar' })
  reporting.reportContext({ foo: 'baz' })

  expectReporting({
    receivedProperties: {
      foo: [expect.any(Number), expect.any(Number)],
    },
    receivedValues: {
      foo: [['bar'], ['baz']],
    },
  })
})

test('Report multiple contexts with labels', () => {
  const reporting = new TgglReporting({ apiKey: 'API_KEY' })

  reporting.reportContext({ userId: 'abc', userName: 'Elon Musk' })
  reporting.reportContext({ userId: 'def', userName: 'Jeff Bezos' })
  reporting.reportContext({ userId: 42, userName: 'Buzz Aldrin' })
  reporting.reportContext({ userId: 'abc', userName: 'Alan Turing' })

  expectReporting({
    receivedProperties: {
      userId: [expect.any(Number), expect.any(Number)],
      userName: [expect.any(Number), expect.any(Number)],
    },
    receivedValues: {
      userId: [
        ['abc', 'Alan Turing'],
        ['def', 'Jeff Bezos'],
      ],
      userName: [
        ['Elon Musk'],
        ['Jeff Bezos'],
        ['Buzz Aldrin'],
        ['Alan Turing'],
      ],
    },
  })
})
