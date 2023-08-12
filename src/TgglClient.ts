import { TgglContext, TgglFlags } from './types'
import { TgglResponse } from './TgglResponse'
import DataLoader from 'dataloader'
import { assertValidContext, checkApiKey } from './validation'
import { apiCall } from './apiCall'

export class TgglClient<
  TFlags extends TgglFlags = TgglFlags,
  TContext extends TgglContext = TgglContext
> extends TgglResponse<TFlags> {
  private context: Partial<TContext> = {}
  private url: string
  private loader: DataLoader<Partial<TContext>, Partial<TFlags>>
  private pollingInterval?: number
  private timeoutID?: ReturnType<typeof setTimeout>
  private fetchID = 0

  constructor(
    private apiKey: string,
    options: {
      url?: string
      initialActiveFlags?: Partial<TFlags>
      pollingInterval?: number
    } = {}
  ) {
    super(options.initialActiveFlags)
    checkApiKey(apiKey)

    this.url = options.url ?? 'https://api.tggl.io/flags'
    this.pollingInterval = options.pollingInterval

    this.loader = new DataLoader<Partial<TContext>, Partial<TFlags>>(
      async (contexts) => {
        try {
          return await apiCall({
            url: this.url,
            apiKey: this.apiKey,
            body: contexts,
            method: 'post',
          })
        } catch (error) {
          throw new Error(
            // @ts-ignore
            `Invalid response from Tggl: ${error.error ?? error.message}`
          )
        }
      },
      { cache: false }
    )
  }

  startPolling(pollingInterval: number) {
    this.pollingInterval = pollingInterval
    this.setContext(this.context)
  }

  stopPolling() {
    this.pollingInterval = undefined
    if (this.timeoutID) {
      clearTimeout(this.timeoutID)
      this.timeoutID = undefined
    }
  }

  async setContext(context: Partial<TContext>) {
    try {
      if (this.timeoutID) {
        clearTimeout(this.timeoutID)
        this.timeoutID = undefined
      }

      assertValidContext(context)

      const fetchID = ++this.fetchID
      const response = await this.loader.load(context)
      if (fetchID !== this.fetchID) {
        return
      }

      if (this.pollingInterval && this.pollingInterval > 0) {
        this.timeoutID = setTimeout(async () => {
          await this.setContext(context)
        }, this.pollingInterval)
      }

      this.context = context
      this.flags = response
    } catch (error) {
      console.error(error)
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

        return new TgglResponse(response)
      })
    } catch (error) {
      console.error(error)

      return contexts.map(() => new TgglResponse())
    }
  }
}
