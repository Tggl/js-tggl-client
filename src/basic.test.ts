import { TgglClient } from './index'

jest.mock('./apiCall')

import { apiCall } from './apiCall'

beforeAll(() => {
  console.error = jest.fn()
})

describe('stateful client', () => {
  test('Success', async () => {
    // @ts-ignore
    apiCall.mockResolvedValue([{ flagA: null, flagB: 'foo', flagC: false }])

    const client = new TgglClient('API_KEY')
    await expect(client.setContext({ foo: 'bar' })).resolves.toBeUndefined()

    expect(client.isActive('flagA')).toBe(true)
    expect(client.isActive('flagB')).toBe(true)
    expect(client.isActive('flagC')).toBe(true)
    expect(client.isActive('flagD')).toBe(false)

    expect(client.get('flagA')).toBe(null)
    expect(client.get('flagB')).toBe('foo')
    expect(client.get('flagC')).toBe(false)
    expect(client.get('flagD')).toBe(undefined)

    expect(client.get('flagA', 'bar')).toBe(null)
    expect(client.get('flagB', 'bar')).toBe('foo')
    expect(client.get('flagC', 'bar')).toBe(false)
    expect(client.get('flagD', 'bar')).toBe('bar')

    expect(apiCall).toHaveBeenCalledWith({
      body: [{ foo: 'bar' }],
      apiKey: 'API_KEY',
      method: 'post',
      url: 'https://api.tggl.io/flags',
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
