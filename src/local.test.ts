import { TgglLocalClient } from './index'
import { evalFlag } from 'tggl-core'
import axios from 'axios'

jest.mock('tggl-core')
jest.mock('axios')

test('Not initialized', () => {
  const client = new TgglLocalClient('API_KEY')

  expect(client.get({}, 'foo')).toBe(undefined)
  expect(client.isActive({}, 'foo')).toBe(false)
  expect(evalFlag).not.toHaveBeenCalled()
})

test('Invalid context', () => {
  const client = new TgglLocalClient('API_KEY')

  // @ts-ignore
  expect(() => client.get(null, 'foo')).toThrow()
  expect(() => client.isActive([], 'foo')).toThrow()
})

test('fetchConfig', async () => {
  // @ts-ignore
  axios.mockResolvedValue({
    data: [
      {
        slug: 'flagA',
        conditions: [
          {
            rules: [
              {
                key: 'userId',
                operator: 'STR_EQUAL',
                negate: false,
                values: ['u1', 'u2'],
              },
            ],
            variation: {
              active: true,
              value: 'foo',
            },
          },
        ],
        defaultVariation: {
          active: false,
          value: null,
        },
      },
      {
        slug: 'flagB',
        conditions: [],
        defaultVariation: {
          active: true,
          value: 'bar',
        },
      },
    ],
  })

  const client = new TgglLocalClient('API_KEY')
  await client.fetchConfig()

  expect(axios).toHaveBeenCalledWith({
    headers: {
      'x-tggl-api-key': 'API_KEY',
    },
    url: 'https://api.tggl.io/config',
  })

  // @ts-ignore
  evalFlag.mockReturnValue(true)

  client.isActive({ foo: 'bar' }, 'flagC')
  client.get({ foo: 'bar' }, 'flagC')
  expect(evalFlag).not.toHaveBeenCalled()

  client.isActive({ foo: 'bar' }, 'flagA')
  expect(evalFlag).toHaveBeenCalledWith(
    { foo: 'bar' },
    {
      slug: 'flagA',
      conditions: [
        {
          rules: [
            {
              key: 'userId',
              operator: 'STR_EQUAL',
              negate: false,
              values: ['u1', 'u2'],
            },
          ],
          variation: {
            active: true,
            value: 'foo',
          },
        },
      ],
      defaultVariation: {
        active: false,
        value: null,
      },
    }
  )

  client.get({ foo: 'baz' }, 'flagB')
  expect(evalFlag).toHaveBeenCalledWith(
    { foo: 'baz' },
    {
      slug: 'flagB',
      conditions: [],
      defaultVariation: {
        active: true,
        value: 'bar',
      },
    }
  )
})

test('isActive falsy values', async () => {
  // @ts-ignore
  axios.mockResolvedValue({
    data: [
      {
        slug: 'flagB',
        conditions: [],
        defaultVariation: {
          active: true,
          value: 'bar',
        },
      },
    ],
  })

  const client = new TgglLocalClient('API_KEY')
  await client.fetchConfig()

  // @ts-ignore
  evalFlag.mockReturnValue(0)
  expect(client.isActive({ foo: 'bar' }, 'flagB')).toBe(true)

  // @ts-ignore
  evalFlag.mockReturnValue(false)
  expect(client.isActive({ foo: 'baz' }, 'flagB')).toBe(true)

  // @ts-ignore
  evalFlag.mockReturnValue('')
  expect(client.isActive({ foo: 'baz' }, 'flagB')).toBe(true)

  // @ts-ignore
  evalFlag.mockReturnValue(null)
  expect(client.isActive({ foo: 'baz' }, 'flagB')).toBe(true)

  // @ts-ignore
  evalFlag.mockReturnValue('foo')
  expect(client.isActive({ foo: 'baz' }, 'flagB')).toBe(true)

  // @ts-ignore
  evalFlag.mockReturnValue(undefined)
  expect(client.isActive({ foo: 'baz' }, 'flagB')).toBe(false)
})

test('get falsy values', async () => {
  // @ts-ignore
  axios.mockResolvedValue({
    data: [
      {
        slug: 'flagB',
        conditions: [],
        defaultVariation: {
          active: true,
          value: 'bar',
        },
      },
    ],
  })

  const client = new TgglLocalClient('API_KEY')
  await client.fetchConfig()

  // @ts-ignore
  evalFlag.mockReturnValue(0)
  expect(client.get({ foo: 'bar' }, 'flagB', 'defaultV')).toBe(0)

  // @ts-ignore
  evalFlag.mockReturnValue(false)
  expect(client.get({ foo: 'baz' }, 'flagB', 'defaultV')).toBe(false)

  // @ts-ignore
  evalFlag.mockReturnValue('')
  expect(client.get({ foo: 'baz' }, 'flagB', 'defaultV')).toBe('')

  // @ts-ignore
  evalFlag.mockReturnValue(null)
  expect(client.get({ foo: 'baz' }, 'flagB', 'defaultV')).toBe(null)

  // @ts-ignore
  evalFlag.mockReturnValue('foo')
  expect(client.get({ foo: 'baz' }, 'flagB', 'defaultV')).toBe('foo')

  // @ts-ignore
  evalFlag.mockReturnValue(undefined)
  expect(client.get({ foo: 'baz' }, 'flagB')).toBe(undefined)
  expect(client.get({ foo: 'baz' }, 'flagB', 'defaultV')).toBe('defaultV')
})
