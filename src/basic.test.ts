import { TgglClient } from './index'

jest.mock('axios')

import axios from 'axios'

test('stateful client', async () => {
  // @ts-ignore
  axios.mockResolvedValue({
    data: [{ flagA: null, flagB: 'foo', flagC: false }],
  })

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

  expect(axios).toHaveBeenCalledWith({
    data: [{ foo: 'bar' }],
    headers: {
      'x-tggl-api-key': 'API_KEY',
    },
    method: 'post',
    url: 'https://api.tggl.io/flags',
  })
})

test('stateless client', async () => {
  // @ts-ignore
  axios.mockResolvedValue({
    data: [{ flagA: null, flagB: 'foo', flagC: false }],
  })

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

  expect(axios).toHaveBeenCalledWith({
    data: [{ foo: 'bar' }],
    headers: {
      'x-tggl-api-key': 'API_KEY',
    },
    method: 'post',
    url: 'https://api.tggl.io/flags',
  })
})
