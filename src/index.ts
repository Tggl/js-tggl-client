import axios, { AxiosError } from 'axios'
import DataLoader from 'dataloader'
import { evalFlag, Flag } from 'tggl-core'

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

  constructor(
    private apiKey: string,
    options: { url?: string; initialActiveFlags?: ActiveFlags } = {}
  ) {
    super(options.initialActiveFlags)
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

export class TgglLocalClient {
  private url: string
  private config: Map<string, Flag>

  constructor(
    private apiKey: string,
    options: { url?: string; initialConfig?: Map<string, Flag> } = {}
  ) {
    checkApiKey(apiKey)

    this.url = options.url ?? 'https://api.tggl.io/config'
    this.config = options.initialConfig ?? new Map()
  }

  async fetchConfig() {
    const response = await axios({
      url: this.url,
      headers: {
        'x-tggl-api-key': this.apiKey,
      },
    })

    this.config.clear()
    for (const flag of response.data) {
      this.config.set(flag.slug, flag)
    }
  }

  isActive(context: Context, slug: string) {
    assertValidContext(context)
    const flag = this.config.get(slug)
    return flag ? evalFlag(context, flag) !== undefined : false
  }

  get<T>(context: Context, slug: string): T | undefined
  get<T>(context: Context, slug: string, defaultValue: T): T
  get<T>(context: Context, slug: string, defaultValue?: T): T {
    assertValidContext(context)
    const flag = this.config.get(slug)
    const result = flag ? evalFlag(context, flag) : undefined
    return result === undefined ? defaultValue : result
  }
}
