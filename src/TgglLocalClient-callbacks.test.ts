import { evalFlag } from 'tggl-core'
import { apiCall } from './apiCall'
import { TgglLocalClient } from './TgglLocalClient'

jest.mock('./apiCall')
jest.mock('./TgglReporting')

test('Callback should not be called when manually setting config', () => {
  const client = new TgglLocalClient('API_KEY')

  const callback = jest.fn()
  client.onConfigChange(callback)

  const config = new Map()
  config.set('flagA', {})
  client.setConfig(config)

  expect(callback).toHaveBeenCalledTimes(0)
})

test('Callback should not be called if config does not change', async () => {
  const client = new TgglLocalClient('API_KEY')

  const callback = jest.fn()
  client.onConfigChange(callback)

  // @ts-ignore
  apiCall.mockResolvedValueOnce([])

  await client.fetchConfig()

  expect(callback).toHaveBeenCalledTimes(0)

  const config = new Map()
  config.set('flagA', {
    slug: 'flagA',
    conditions: [],
    defaultVariation: {
      active: true,
      value: 'bar',
    },
  })
  client.setConfig(config)

  // @ts-ignore
  apiCall.mockResolvedValueOnce([
    {
      slug: 'flagA',
      conditions: [],
      defaultVariation: {
        active: true,
        value: 'bar',
      },
    },
  ])

  await client.fetchConfig()

  expect(callback).toHaveBeenCalledTimes(0)
})

test('Callback should be called if config changes', async () => {
  const client = new TgglLocalClient('API_KEY')

  const callback = jest.fn()
  client.onConfigChange(callback)

  // @ts-ignore
  apiCall.mockResolvedValueOnce([
    {
      slug: 'flagA',
      conditions: [],
      defaultVariation: {
        active: true,
        value: 'bar',
      },
    },
  ])

  await client.fetchConfig()

  const config = new Map()
  config.set('flagA', {
    slug: 'flagA',
    conditions: [],
    defaultVariation: {
      active: true,
      value: 'bar',
    },
  })

  expect(callback).toHaveBeenCalledWith(config)
})

test('Callback should be cancellable', async () => {
  const client = new TgglLocalClient('API_KEY')

  const callback = jest.fn()
  const cancelCallback = client.onConfigChange(callback)
  cancelCallback()

  // @ts-ignore
  apiCall.mockResolvedValueOnce([
    {
      slug: 'flagA',
      conditions: [],
      defaultVariation: {
        active: true,
        value: 'bar',
      },
    },
  ])

  await client.fetchConfig()

  expect(callback).toHaveBeenCalledTimes(0)
})

test('Callback should be called once when fetching multiple times in parallel', async () => {
  const client = new TgglLocalClient('API_KEY')

  const callback = jest.fn()
  client.onConfigChange(callback)

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

  await Promise.all([
    client.fetchConfig(),
    client.fetchConfig(),
    client.fetchConfig(),
    client.fetchConfig().catch((err) => err),
  ])

  expect(callback).toHaveBeenCalledTimes(1)
  expect(callback).toHaveBeenCalledWith(config)
})

test('Callback should be called once when fetching multiple times in parallel with error in the middle', async () => {
  const client = new TgglLocalClient('API_KEY')

  const callback = jest.fn()
  client.onConfigChange(callback)

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

  await Promise.all([
    client.fetchConfig(),
    client.fetchConfig().catch((err) => err),
    client.fetchConfig(),
    client.fetchConfig(),
  ])

  expect(callback).toHaveBeenCalledTimes(1)
  expect(callback).toHaveBeenCalledWith(config)
})

test('Fetch success callback should only be called on success', async () => {
  const client = new TgglLocalClient('API_KEY')

  const callback = jest.fn()
  client.onFetchSuccessful(callback)

  // @ts-ignore
  apiCall.mockRejectedValueOnce({ error: 'API error' })
  await client.fetchConfig().catch(() => null)

  expect(callback).toHaveBeenCalledTimes(0)

  // @ts-ignore
  apiCall.mockResolvedValueOnce([])
  await client.fetchConfig()

  expect(callback).toHaveBeenCalledTimes(1)

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
  await client.fetchConfig()

  expect(callback).toHaveBeenCalledTimes(2)
})

test('Fetch success callback should be cancellable', async () => {
  const client = new TgglLocalClient('API_KEY')

  const callback = jest.fn()
  const cancelCallback = client.onFetchSuccessful(callback)
  cancelCallback()

  // @ts-ignore
  apiCall.mockResolvedValueOnce([])
  await client.fetchConfig()

  expect(callback).toHaveBeenCalledTimes(0)
})

test('Fetch success callback should be called on every success', async () => {
  const client = new TgglLocalClient('API_KEY')

  const callback = jest.fn()
  client.onFetchSuccessful(callback)

  // @ts-ignore
  apiCall.mockResolvedValue([])
  await Promise.all([
    client.fetchConfig(),
    client.fetchConfig(),
    client.fetchConfig(),
  ])

  expect(callback).toHaveBeenCalledTimes(3)
})

test('Fetch failure callback should only be called on failure', async () => {
  const client = new TgglLocalClient('API_KEY')

  const callback = jest.fn()
  client.onFetchFail(callback)

  // @ts-ignore
  apiCall.mockResolvedValueOnce([])
  await client.fetchConfig()

  expect(callback).toHaveBeenCalledTimes(0)

  // @ts-ignore
  apiCall.mockRejectedValueOnce({ error: 'API error' })
  await client.fetchConfig().catch(() => null)

  expect(callback).toHaveBeenCalledTimes(1)
  expect(callback).toHaveBeenCalledWith({ error: 'API error' })

  // @ts-ignore
  apiCall.mockRejectedValueOnce({ error: 'Other API error' })
  await client.fetchConfig().catch(() => null)

  expect(callback).toHaveBeenCalledTimes(2)
  expect(callback).toHaveBeenCalledWith({ error: 'Other API error' })
})

test('Fetch failure callback should be cancellable', async () => {
  const client = new TgglLocalClient('API_KEY')

  const callback = jest.fn()
  const cancelCallback = client.onFetchFail(callback)
  cancelCallback()

  // @ts-ignore
  apiCall.mockRejectedValueOnce({ error: 'API error' })
  await client.fetchConfig().catch(() => null)

  expect(callback).toHaveBeenCalledTimes(0)
})

test('Fetch failure callback should be called on every fail', async () => {
  const client = new TgglLocalClient('API_KEY')

  const callback = jest.fn()
  client.onFetchFail(callback)

  // @ts-ignore
  apiCall.mockRejectedValue({ error: 'API error' })
  await Promise.all([
    client.fetchConfig().catch(() => null),
    client.fetchConfig().catch(() => null),
    client.fetchConfig().catch(() => null),
  ])

  expect(callback).toHaveBeenCalledTimes(3)
})
