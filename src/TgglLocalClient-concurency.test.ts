import { evalFlag } from 'tggl-core'
import { apiCall } from './apiCall'
import { TgglLocalClient } from './TgglLocalClient'

jest.mock('tggl-core')
jest.mock('./apiCall')
jest.useFakeTimers()

const runTimers = async (ms?: number) => {
  await Promise.resolve()
  if (ms) {
    jest.advanceTimersByTime(ms)
  } else {
    jest.runAllTimers()
  }
  await Promise.resolve()
}

test('Parallel fetch should return the last success call', async () => {
  const client = new TgglLocalClient('API_KEY')

  // @ts-ignore
  apiCall.mockResolvedValueOnce([
    {
      slug: 'flagA',
      conditions: [],
      defaultVariation: {
        active: false,
        value: null,
      },
    },
  ])

  // @ts-ignore
  apiCall.mockResolvedValueOnce([
    {
      slug: 'flagB',
      conditions: [],
      defaultVariation: {
        active: true,
        value: 'bar',
      },
    },
  ])

  // @ts-ignore
  apiCall.mockResolvedValueOnce([
    {
      slug: 'flagC',
      conditions: [],
      defaultVariation: {
        active: true,
        value: 'foo',
      },
    },
  ])

  // @ts-ignore
  apiCall.mockRejectedValueOnce({ error: 'API error' })

  const config = new Map([
    [
      'flagC',
      {
        slug: 'flagC',
        conditions: [],
        defaultVariation: {
          active: true,
          value: 'foo',
        },
      },
    ],
  ])

  await expect(
    Promise.all([
      client.fetchConfig(),
      client.fetchConfig(),
      client.fetchConfig(),
      client.fetchConfig().catch((err) => err),
    ])
  ).resolves.toEqual([
    config,
    config,
    config,
    new Error('Invalid response from Tggl: API error'),
  ])
})

test('Parallel fetch should return the last success call with error in the middle', async () => {
  const client = new TgglLocalClient('API_KEY')

  // @ts-ignore
  apiCall.mockResolvedValueOnce([
    {
      slug: 'flagA',
      conditions: [],
      defaultVariation: {
        active: false,
        value: null,
      },
    },
  ])

  // @ts-ignore
  apiCall.mockRejectedValueOnce({ error: 'API error' })

  // @ts-ignore
  apiCall.mockResolvedValueOnce([
    {
      slug: 'flagB',
      conditions: [],
      defaultVariation: {
        active: true,
        value: 'bar',
      },
    },
  ])

  // @ts-ignore
  apiCall.mockResolvedValueOnce([
    {
      slug: 'flagC',
      conditions: [],
      defaultVariation: {
        active: true,
        value: 'foo',
      },
    },
  ])

  const config = new Map([
    [
      'flagC',
      {
        slug: 'flagC',
        conditions: [],
        defaultVariation: {
          active: true,
          value: 'foo',
        },
      },
    ],
  ])

  await expect(
    Promise.all([
      client.fetchConfig(),
      client.fetchConfig().catch((err) => err),
      client.fetchConfig(),
      client.fetchConfig(),
    ])
  ).resolves.toEqual([
    config,
    new Error('Invalid response from Tggl: API error'),
    config,
    config,
  ])
})

test('Client should not fetch config automatically', async () => {
  // @ts-ignore
  apiCall.mockResolvedValue([])

  new TgglLocalClient('API_KEY')

  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(0)
})

test('Polling should start immediately if pollingInterval is set', async () => {
  // @ts-ignore
  apiCall.mockResolvedValue([])

  const client = new TgglLocalClient('API_KEY', { pollingInterval: 1000 })

  expect(apiCall).toHaveBeenCalledTimes(1)
  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(2)
  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(3)

  client.stopPolling()
})

test('Client should keep polling even with errors', async () => {
  // @ts-ignore
  apiCall.mockRejectedValue({ error: 'API error' })

  const client = new TgglLocalClient('API_KEY', { pollingInterval: 1000 })

  expect(apiCall).toHaveBeenCalledTimes(1)
  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(2)
  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(3)

  client.stopPolling()
})

test('Client should keep polling even with errors when started manually', async () => {
  // @ts-ignore
  apiCall.mockRejectedValue({ error: 'API error' })

  const client = new TgglLocalClient('API_KEY')

  client.startPolling(1000)

  expect(apiCall).toHaveBeenCalledTimes(1)
  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(2)
  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(3)

  client.stopPolling()
})

test('Client should not start polling if interval is 0 or less', async () => {
  // @ts-ignore
  apiCall.mockRejectedValue({ error: 'API error' })

  const client = new TgglLocalClient('API_KEY')

  client.startPolling(0)

  expect(apiCall).toHaveBeenCalledTimes(0)
  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(0)
  client.startPolling(-1)
  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(0)
})

test('Client should stop polling immediately, canceling any planned request', async () => {
  // @ts-ignore
  apiCall.mockResolvedValue([])

  const client = new TgglLocalClient('API_KEY', { pollingInterval: 1000 })

  expect(apiCall).toHaveBeenCalledTimes(1)
  await runTimers(500)
  client.stopPolling()
  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(1)
})

test('Calling stopPolling should have no effect on client that is not polling already', async () => {
  // @ts-ignore
  apiCall.mockResolvedValue([])

  const client = new TgglLocalClient('API_KEY')

  client.stopPolling()
  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(0)
})

test('Start polling should start immediately', async () => {
  // @ts-ignore
  apiCall.mockResolvedValue([])

  const client = new TgglLocalClient('API_KEY')

  client.startPolling(1000)

  expect(apiCall).toHaveBeenCalledTimes(1)
  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(2)
  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(3)

  client.stopPolling()
})

test('Calling fetch in the middle of a polling interval should reset the interval', async () => {
  // @ts-ignore
  apiCall.mockResolvedValue([])

  const client = new TgglLocalClient('API_KEY', { pollingInterval: 1000 })

  expect(apiCall).toHaveBeenCalledTimes(1)
  await runTimers(50)
  expect(apiCall).toHaveBeenCalledTimes(1)
  await runTimers(1000)
  expect(apiCall).toHaveBeenCalledTimes(2)
  await client.fetchConfig()
  expect(apiCall).toHaveBeenCalledTimes(3)
  await runTimers(950)
  expect(apiCall).toHaveBeenCalledTimes(3)
  await runTimers(1000)
  expect(apiCall).toHaveBeenCalledTimes(4)
  await runTimers(1000)
  expect(apiCall).toHaveBeenCalledTimes(5)

  client.stopPolling()
})

test('Polling interval should be the time between done-fetching and start-fetching, not start-fetching and start-fetching', async () => {
  // @ts-ignore
  apiCall.mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve([]), 2000))
  )

  const client = new TgglLocalClient('API_KEY', { pollingInterval: 1000 })

  expect(apiCall).toHaveBeenCalledTimes(1)
  await runTimers(2500)
  expect(apiCall).toHaveBeenCalledTimes(1)
  await runTimers(1000)
  expect(apiCall).toHaveBeenCalledTimes(2)
  await runTimers(2000)
  expect(apiCall).toHaveBeenCalledTimes(2)
  await runTimers(1000)
  expect(apiCall).toHaveBeenCalledTimes(3)

  client.stopPolling()
})
