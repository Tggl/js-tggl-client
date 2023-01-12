import axios, { AxiosError } from 'axios'
import DataLoader from 'dataloader'

type Context = Record<string, any>
type ActiveFlags = Record<string, any>

export class TgglResponse {
  constructor(protected flags: ActiveFlags = {}) {}

  isActive(slug: string) {
    return this.flags[slug] !== undefined
  }

  get<T>(slug: string): T | undefined
  get<T>(slug: string, defaultValue: T): T
  get<T>(slug: string, defaultValue?: T): T {
    return this.flags[slug] === undefined ? defaultValue : this.flags[slug]
  }
}

const assertValidContext = (context: any) => {
  if (context === undefined) {
    throw new Error('Could not set Tggl context, context is missing')
  }

  if (typeof context !== 'object' || context === null) {
    throw new Error('Could not set Tggl context, context must be an object')
  }

  if (Array.isArray(context)) {
    throw new Error('Could not set Tggl context, context cannot be an array')
  }
}

const assertValidApiKey = (apiKey: any) => {
  if (apiKey === undefined) {
    throw new Error('Could not create Tggl client, missing API Key')
  }

  if (typeof apiKey !== 'string') {
    throw new Error('Could not create Tggl client, API Key must be a string')
  }

  if (!apiKey) {
    throw new Error('Could not create Tggl client, API Key cannot be empty')
  }
}

export class TgglClient extends TgglResponse {
  private context: Context = {}
  private url: string
  private loader: DataLoader<Context, ActiveFlags>

  constructor(private apiKey: string, options: { url?: string } = {}) {
    super()
    assertValidApiKey(apiKey)

    this.url = options.url ?? 'https://api.tggl.io/flags'

    this.loader = new DataLoader<Context, ActiveFlags>(
      async (contexts) => {
        try {
          const response = await axios({
            method: 'post',
            url: this.url,
            data: contexts,
            headers: {
              'x-tggl-api-key': this.apiKey,
            },
          })

          return (response.data as ActiveFlags[]).map((flags, i) => {
            try {
              assertValidContext(contexts[i])
              return flags
            } catch (error) {
              return error as Error
            }
          })
        } catch (error) {
          throw new Error(
            `Invalid response from Tggl: ${
              (error as AxiosError<{ error?: string }>).response?.data?.error ||
              (error as AxiosError).response?.statusText
            }`
          )
        }
      },
      { cache: false }
    )
  }

  async setContext(context: Context) {
    const response = await this.loader.load(context)

    this.context = context
    this.flags = response
  }

  async evalContext(context: Context) {
    const responses = await this.evalContexts([context])

    if (responses[0] instanceof Error) {
      throw responses[0]
    }

    return responses[0]
  }

  async evalContexts(contexts: Context[]) {
    const responses = await this.loader.loadMany(contexts)

    return responses.map((response) =>
      response instanceof Error ? response : new TgglResponse(response)
    )
  }
}
