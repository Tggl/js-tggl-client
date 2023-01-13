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
  if (context === undefined || context === null) {
    throw new Error('Invalid Tggl context, context is missing')
  }

  if (typeof context !== 'object') {
    throw new Error('Invalid Tggl context, context must be an object')
  }

  if (Array.isArray(context)) {
    throw new Error('Invalid Tggl context, context cannot be an array')
  }
}

const checkApiKey = (apiKey: any) => {
  if (apiKey === undefined) {
    console.error('Could not properly create Tggl client, missing API Key')
  }

  if (typeof apiKey !== 'string') {
    console.error(
      'Could not properly create Tggl client, API Key must be a string'
    )
  }

  if (!apiKey) {
    console.error(
      'Could not properly create Tggl client, API Key cannot be empty'
    )
  }
}

export class TgglClient extends TgglResponse {
  private context: Context = {}
  private url: string
  private loader: DataLoader<Context, ActiveFlags>

  constructor(private apiKey: string, options: { url?: string } = {}) {
    super()
    checkApiKey(apiKey)

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

          return response.data
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
    try {
      assertValidContext(context)
      const response = await this.loader.load(context)

      this.context = context
      this.flags = response
    } catch (error) {
      console.error(error)
    }
  }

  async evalContext(context: Context) {
    const responses = await this.evalContexts([context])

    return responses[0]
  }

  async evalContexts(contexts: Context[]) {
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
