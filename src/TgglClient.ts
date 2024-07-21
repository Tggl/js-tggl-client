import { TgglContext, TgglFlags } from './types'
import { TgglResponse } from './TgglResponse'
import DataLoader from 'dataloader'
import { assertValidContext } from './validation'
import { apiCall } from './apiCall'
import { TgglReporting } from './TgglReporting'

export class TgglClient<
  TFlags extends TgglFlags = TgglFlags,
  TContext extends TgglContext = TgglContext
> extends TgglResponse<TFlags> {
  private context: Partial<TContext> = {}
  private url: string
  private loader: DataLoader<Partial<TContext>, Partial<TFlags>>
  private pollingInterval: number = 0
  private timeoutID?: ReturnType<typeof setTimeout>
  private fetchID = 0
  private fetchPromise?: Promise<number>
  private lastSuccessfulFetchID = 0
  private lastSuccessfulFetchResponse: {
    context: Partial<TContext>
    response: Partial<TFlags>
  } | null = null
  private onResultChangeCallbacks = new Map<
    number,
    (flags: Partial<TFlags>) => void
  >()
  private onFetchSuccessfulCallbacks = new Map<number, () => void>()
  private onFetchFailCallbacks = new Map<number, (error: Error) => void>()
  private log = true

  constructor(
    private apiKey?: string | null,
    options: {
      url?: string
      initialActiveFlags?: Partial<TFlags>
      pollingInterval?: number
      log?: boolean
      reporting?: boolean | { app?: string; url?: string }
    } = {}
  ) {
    super(options.initialActiveFlags, {
      reporting:
        options.reporting === false || !apiKey
          ? null
          : new TgglReporting({
              apiKey,
              app:
                typeof options.reporting === 'object'
                  ? `TgglClient/${options.reporting.app}`
                  : 'TgglClient',
              url:
                typeof options.reporting === 'object'
                  ? options.reporting.url
                  : undefined,
            }),
    })

    this.url = options.url ?? 'https://api.tggl.io/flags'
    this.log = options.log ?? true

    this.loader = new DataLoader<Partial<TContext>, Partial<TFlags>>(
      async (contexts) => {
        try {
          return (await apiCall({
            url: this.url,
            apiKey: this.apiKey,
            body: contexts,
            method: 'post',
          })) as Promise<any>
        } catch (error) {
          throw new Error(
            // @ts-ignore
            `Invalid response from Tggl: ${error.error ?? error.message}`
          )
        }
      },
      { cache: false }
    )

    this.startPolling(options.pollingInterval ?? 0)
  }

  onResultChange(callback: (flags: Partial<TFlags>) => void) {
    const id = Math.random()
    this.onResultChangeCallbacks.set(id, callback)

    return () => {
      this.onResultChangeCallbacks.delete(id)
    }
  }

  onFetchSuccessful(callback: () => void) {
    const id = Math.random()
    this.onFetchSuccessfulCallbacks.set(id, callback)

    return () => {
      this.onFetchSuccessfulCallbacks.delete(id)
    }
  }

  onFetchFail(callback: (error: Error) => void) {
    const id = Math.random()
    this.onFetchFailCallbacks.set(id, callback)

    return () => {
      this.onFetchFailCallbacks.delete(id)
    }
  }

  startPolling(pollingInterval: number) {
    this.pollingInterval = pollingInterval

    if (pollingInterval > 0) {
      this.setContext(this.context)
    } else {
      this.cancelNextPolling()
    }
  }

  stopPolling() {
    this.startPolling(0)
  }

  private planNextPolling() {
    if (this.pollingInterval > 0 && !this.timeoutID) {
      this.timeoutID = setTimeout(async () => {
        await this.setContext(this.context)
      }, this.pollingInterval)
    }
  }

  private cancelNextPolling() {
    if (this.timeoutID) {
      clearTimeout(this.timeoutID)
      this.timeoutID = undefined
    }
  }

  private async waitForLastFetchToFinish() {
    while (this.fetchPromise && this.fetchID !== (await this.fetchPromise)) {}
  }

  async setContext(context: Partial<TContext>) {
    const fetchID = ++this.fetchID

    let done: () => void = () => null
    this.fetchPromise = new Promise((resolve) => {
      done = () => resolve(fetchID)
    })

    try {
      this.cancelNextPolling()

      assertValidContext(context)

      const response = await this.loader.load(context)

      for (const callback of this.onFetchSuccessfulCallbacks.values()) {
        callback()
      }

      if (fetchID > this.lastSuccessfulFetchID) {
        this.lastSuccessfulFetchID = fetchID
        this.lastSuccessfulFetchResponse = { context, response }
      }

      // If another fetch was started while this one was running
      if (fetchID !== this.fetchID) {
        await this.waitForLastFetchToFinish()

        return
      }
    } catch (error) {
      for (const callback of this.onFetchFailCallbacks.values()) {
        callback(error as Error)
      }
      if (this.log) {
        console.error(error)
      }
    } finally {
      // If this is the last fetch that was started, we can update the config
      if (fetchID === this.fetchID && this.lastSuccessfulFetchResponse) {
        this.setRawFlags(this.lastSuccessfulFetchResponse)
      }

      done()
      this.planNextPolling()
    }
  }

  private setRawFlags({
    context,
    response,
  }: {
    context: Partial<TContext>
    response: Partial<TFlags>
  }) {
    const resultChanged =
      this.onResultChangeCallbacks.size > 0 &&
      (Object.keys(response).length !== Object.keys(this.flags).length ||
        !Object.keys(response).every(
          (key: string) =>
            JSON.stringify(this.flags[key as keyof TFlags]) ===
            JSON.stringify(response[key as keyof TFlags])
        ))

    this.context = context
    this.flags = response

    if (resultChanged) {
      for (const callback of this.onResultChangeCallbacks.values()) {
        callback(this.flags)
      }
    }
  }

  async evalContext(context: Partial<TContext>) {
    const responses = await this.evalContexts([context])

    return responses[0]
  }

  async evalContexts(
    contexts: Partial<TContext>[]
  ): Promise<TgglResponse<TFlags>[]> {
    try {
      contexts.forEach(assertValidContext)
      const responses = await this.loader.loadMany(contexts)

      return responses.map((response) => {
        if (response instanceof Error) {
          throw response
        }

        return new TgglResponse(response, { reporting: this.reporting })
      })
    } catch (error) {
      if (this.log) {
        console.error(error)
      }

      return contexts.map(
        () => new TgglResponse({}, { reporting: this.reporting })
      )
    }
  }
}
