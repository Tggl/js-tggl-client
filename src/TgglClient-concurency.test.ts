jest.mock('./apiCall')
jest.mock('./TgglReporting')

class DL {
  constructor(private batch: (contexts: any[]) => any) {}
  async load(context: any) {
    return (await this.batch([context]))[0]
  }
  loadMany(contexts: any[]) {
    return this.batch(contexts)
  }
}

jest.mock('dataloader', () => DL)

import { apiCall } from './apiCall'
import { TgglClient } from './TgglClient'

jest.useFakeTimers()

const runTimers = async (ms?: number) => {
  await Promise.resolve()
  if (ms) {
    jest.advanceTimersByTime(ms)
  } else {
    jest.runAllTimers()
    await Promise.resolve()
    await Promise.resolve()
    jest.runAllTimers()
  }
  await Promise.resolve()
}

test('Client should not fetch automatically', async () => {
  // @ts-ignore
  apiCall.mockResolvedValue([{}])

  new TgglClient('API_KEY')

  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(0)
})

test('Polling should start immediately if pollingInterval is set', async () => {
  // @ts-ignore
  apiCall.mockResolvedValue([{}])

  const client = new TgglClient('API_KEY', { pollingInterval: 1000 })

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

  const client = new TgglClient('API_KEY', { pollingInterval: 1000 })

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

  const client = new TgglClient('API_KEY')

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
  apiCall.mockResolvedValue([{}])

  const client = new TgglClient('API_KEY')

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
  apiCall.mockResolvedValue([{}])

  const client = new TgglClient('API_KEY', { pollingInterval: 5000 })

  expect(apiCall).toHaveBeenCalledTimes(1)
  await runTimers(2000)
  client.stopPolling()
  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(1)
})

test('Calling stopPolling should have no effect on client that is not polling already', async () => {
  // @ts-ignore
  apiCall.mockResolvedValue([{}])

  const client = new TgglClient('API_KEY')

  client.stopPolling()
  await runTimers()
  expect(apiCall).toHaveBeenCalledTimes(0)
})

test('Start polling should start immediately', async () => {
  // @ts-ignore
  apiCall.mockResolvedValue([{}])

  const client = new TgglClient('API_KEY')

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
  apiCall.mockResolvedValue([{}])

  const client = new TgglClient('API_KEY', { pollingInterval: 1000 })

  expect(apiCall).toHaveBeenCalledTimes(1)
  await runTimers(900)
  expect(apiCall).toHaveBeenCalledTimes(1)
  await runTimers(1000)
  expect(apiCall).toHaveBeenCalledTimes(2)
  await client.setContext({})
  expect(apiCall).toHaveBeenCalledTimes(3)
  await runTimers(950)
  expect(apiCall).toHaveBeenCalledTimes(3)
  await runTimers(1000)
  expect(apiCall).toHaveBeenCalledTimes(4)
  await runTimers(1000)
  expect(apiCall).toHaveBeenCalledTimes(5)

  client.stopPolling()
})
