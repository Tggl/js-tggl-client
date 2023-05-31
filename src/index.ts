import axios, { AxiosError } from 'axios'
import DataLoader from 'dataloader'
import { evalFlag, Flag } from 'tggl-core'

export interface TgglContext {}

export interface TgglFlags {}

type Slug<TFlags extends TgglFlags = TgglFlags> = keyof TFlags extends never
  ? string
  : keyof TFlags

type FlagValue<TFlags extends TgglFlags = TgglFlags, TSlug = string> =
  TSlug extends keyof TFlags ? TFlags[TSlug] : any

export class TgglResponse<TFlags extends TgglFlags = TgglFlags> {
  constructor(protected flags: Partial<TFlags> = {}) {}

  isActive(slug: Slug<TFlags>): boolean {
    return this.flags[slug as keyof TFlags] !== undefined
  }

  get<TSlug extends Slug<TFlags>>(
    slug: TSlug
  ): FlagValue<TFlags, TSlug> | undefined
  get<TSlug extends Slug<TFlags>, TDefaultValue = FlagValue<TFlags, TSlug>>(
    slug: TSlug,
    defaultValue: TDefaultValue
  ): FlagValue<TFlags, TSlug> | TDefaultValue
  get<TSlug extends keyof TFlags, TDefaultValue = FlagValue<TFlags, TSlug>>(
    slug: TSlug,
    defaultValue?: TDefaultValue
  ): FlagValue<TFlags, TSlug> | TDefaultValue | undefined {
    // @ts-ignore
    return this.flags[slug as keyof TFlags] === undefined
      ? defaultValue
      : this.flags[slug as keyof TFlags]
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

export class TgglClient<
  TFlags extends TgglFlags = TgglFlags,
  TContext extends TgglContext = TgglContext
> extends TgglResponse<TFlags> {
  private context: Partial<TContext> = {}
  private url: string
  private loader: DataLoader<Partial<TContext>, Partial<TFlags>>

  constructor(
    private apiKey: string,
    options: { url?: string; initialActiveFlags?: Partial<TFlags> } = {}
  ) {
    super(options.initialActiveFlags)
    checkApiKey(apiKey)

    this.url = options.url ?? 'https://api.tggl.io/flags'

    this.loader = new DataLoader<Partial<TContext>, Partial<TFlags>>(
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

  async setContext(context: Partial<TContext>) {
    try {
      assertValidContext(context)
      const response = await this.loader.load(context)

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

export class TgglLocalClient<
  TFlags extends TgglFlags = TgglFlags,
  TContext extends TgglContext = TgglContext
> {
  private url: string
  private config: Map<Slug<TFlags>, Flag>

  constructor(
    private apiKey: string,
    options: { url?: string; initialConfig?: Map<Slug<TFlags>, Flag> } = {}
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

  isActive(context: Partial<TContext>, slug: Slug<TFlags>) {
    assertValidContext(context)
    const flag = this.config.get(slug)
    return flag ? evalFlag(context, flag) !== undefined : false
  }

  get<TSlug extends Slug<TFlags>>(
    context: Partial<TContext>,
    slug: TSlug
  ): FlagValue<TFlags, TSlug> | undefined
  get<TSlug extends Slug<TFlags>, TDefaultValue = FlagValue<TFlags, TSlug>>(
    context: Partial<TContext>,
    slug: TSlug,
    defaultValue: TDefaultValue
  ): FlagValue<TFlags, TSlug> | TDefaultValue
  get<TSlug extends Slug<TFlags>, TDefaultValue = FlagValue<TFlags, TSlug>>(
    context: Partial<TContext>,
    slug: TSlug,
    defaultValue?: TDefaultValue
  ): FlagValue<TFlags, TSlug> | TDefaultValue | undefined {
    assertValidContext(context)
    const flag = this.config.get(slug)
    const result = flag ? evalFlag(context, flag) : undefined
    return result === undefined ? defaultValue : result
  }
}
