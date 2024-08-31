jest.mock('./apiCall')
jest.mock('./TgglReporting')

import { apiCall } from './apiCall'
import { TgglClient } from './TgglClient'
import getTests from '../testData/get.json'
import isActiveTests from '../testData/isActive.json'

beforeAll(() => {
  console.error = jest.fn()
})

describe('stateful client', () => {
  for (const { name, value, response, defaultValue, flag } of getTests) {
    test('get ' + name, async () => {
      const client = new TgglClient<any>('API_KEY', {
        initialActiveFlags: response,
      })

      if (defaultValue !== undefined) {
        expect(client.get(flag, defaultValue) ?? null).toEqual(value)
      } else {
        expect(client.get(flag) ?? null).toEqual(value)
      }
    })
  }

  for (const { name, flag, response, active } of isActiveTests) {
    test('isActive ' + name, async () => {
      const client = new TgglClient<any>('API_KEY', {
        initialActiveFlags: response,
      })

      expect(client.isActive(flag)).toBe(active)
    })
  }

  test('Success', async () => {
    // @ts-ignore
    apiCall.mockResolvedValue([{ flagA: 'foo' }])

    const client = new TgglClient('API_KEY')
    await expect(client.setContext({ foo: 'bar' })).resolves.toBeUndefined()

    expect(client.isActive('flagA')).toBe(true)
    expect(client.get('flagA')).toBe('foo')

    expect(apiCall).toHaveBeenCalledTimes(1)
    expect(apiCall).toHaveBeenCalledWith({
      body: [{ foo: 'bar' }],
      apiKey: 'API_KEY',
      method: 'post',
      url: 'https://api.tggl.io/flags',
    })
  })

  test('Make API call to the right url', async () => {
    // @ts-ignore
    apiCall.mockResolvedValue([{ flagA: null, flagB: 'foo', flagC: false }])

    const client = new TgglClient('API_KEY', {
      url: 'http://my-domain.com/foo',
    })
    await expect(client.setContext({ foo: 'bar' })).resolves.toBeUndefined()

    expect(apiCall).toHaveBeenCalledTimes(1)
    expect(apiCall).toHaveBeenCalledWith({
      body: [{ foo: 'bar' }],
      apiKey: 'API_KEY',
      method: 'post',
      url: 'http://my-domain.com/foo',
    })
  })

  test('API error', async () => {
    // @ts-ignore
    apiCall.mockResolvedValue([{ flagA: null, flagB: 'foo', flagC: false }])

    const client = new TgglClient('API_KEY')
    await expect(client.setContext({ foo: 'bar' })).resolves.toBeUndefined()

    // @ts-ignore
    apiCall.mockRejectedValue({ error: 'Invalid API key' })
    await expect(client.setContext({ foo: 'baz' })).resolves.toBeUndefined()

    expect(client.isActive('flagA')).toBe(true)
    expect(console.error).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledWith(
      new Error('Invalid response from Tggl: Invalid API key')
    )
  })

  test('Invalid context', async () => {
    // @ts-ignore
    apiCall.mockResolvedValue([{ flagA: null, flagB: 'foo', flagC: false }])

    const client = new TgglClient('API_KEY')
    await expect(client.setContext({ foo: 'bar' })).resolves.toBeUndefined()
    await expect(client.setContext([{ foo: 'baz' }])).resolves.toBeUndefined()

    expect(client.isActive('flagA')).toBe(true)
    expect(console.error).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledWith(
      new Error('Invalid Tggl context, context cannot be an array')
    )
  })
})

describe('stateless client', () => {
  describe('evalContext', () => {
    test('Success', async () => {
      // @ts-ignore
      apiCall.mockResolvedValue([{ flagA: null, flagB: 'foo', flagC: false }])

      const client = new TgglClient('API_KEY')
      const response = await client.evalContext({ foo: 'bar' })

      expect(response.isActive('flagA')).toBe(true)
      expect(response.isActive('flagB')).toBe(true)
      expect(response.isActive('flagC')).toBe(true)
      expect(response.isActive('flagD')).toBe(false)

      expect(response.get('flagA')).toBe(null)
      expect(response.get('flagB')).toBe('foo')
      expect(response.get('flagC')).toBe(false)
      expect(response.get('flagD')).toBe(undefined)

      expect(response.get('flagA', 'bar')).toBe(null)
      expect(response.get('flagB', 'bar')).toBe('foo')
      expect(response.get('flagC', 'bar')).toBe(false)
      expect(response.get('flagD', 'bar')).toBe('bar')

      expect(apiCall).toHaveBeenCalledWith({
        body: [{ foo: 'bar' }],
        apiKey: 'API_KEY',
        method: 'post',
        url: 'https://api.tggl.io/flags',
      })
    })

    test('Calls are batched', async () => {
      // @ts-ignore
      apiCall.mockResolvedValue([
        { flagA: null, flagB: 'foo', flagC: false },
        { flagA: null },
        { flagC: true },
      ])

      const client = new TgglClient('API_KEY')
      await Promise.all([
        client.evalContext({ foo: 'bar' }),
        client.evalContext({ foo: 'baz' }),
        client.evalContext({ foo: 'bor' }),
      ])

      expect(apiCall).toHaveBeenCalledTimes(1)
      expect(apiCall).toHaveBeenCalledWith({
        body: [{ foo: 'bar' }, { foo: 'baz' }, { foo: 'bor' }],
        apiKey: 'API_KEY',
        method: 'post',
        url: 'https://api.tggl.io/flags',
      })
    })

    test('API error', async () => {
      // @ts-ignore
      apiCall.mockRejectedValue({ error: 'Invalid API key' })

      const client = new TgglClient('API_KEY')
      const response = await client.evalContext({ foo: 'bar' })

      expect(response.isActive('flagA')).toBe(false)
      expect(console.error).toHaveBeenCalledTimes(1)
      expect(console.error).toHaveBeenCalledWith(
        new Error('Invalid response from Tggl: Invalid API key')
      )
    })

    test('Invalid context', async () => {
      const client = new TgglClient('API_KEY')
      // @ts-ignore
      const response = await client.evalContext(null)

      expect(response.isActive('flagA')).toBe(false)
      expect(console.error).toHaveBeenCalledTimes(1)
      expect(console.error).toHaveBeenCalledWith(
        new Error('Invalid Tggl context, context is missing')
      )
    })
  })
})
