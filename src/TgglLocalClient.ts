import { TgglContext, TgglFlags, TgglFlagSlug, TgglFlagValue } from './types'
import { evalFlag, Flag } from 'tggl-core'
import { assertValidContext, checkApiKey } from './validation'
import { apiCall } from './apiCall'

export class TgglLocalClient<
  TFlags extends TgglFlags = TgglFlags,
  TContext extends TgglContext = TgglContext
> {
  private url: string
  private config: Map<TgglFlagSlug<TFlags>, Flag>

  constructor(
    private apiKey: string,
    options: {
      url?: string
      initialConfig?: Map<TgglFlagSlug<TFlags>, Flag>
    } = {}
  ) {
    checkApiKey(apiKey)

    this.url = options.url ?? 'https://api.tggl.io/config'
    this.config = options.initialConfig ?? new Map()
  }

  async fetchConfig() {
    try {
      const response = await apiCall({
        url: this.url,
        apiKey: this.apiKey,
        method: 'get',
      })

      this.config.clear()
      for (const flag of response) {
        this.config.set(flag.slug, flag)
      }
    } catch (error) {
      throw new Error(
        // @ts-ignore
        `Invalid response from Tggl: ${error.error ?? error.message}`
      )
    }

    return this.config
  }

  getConfig() {
    return this.config
  }

  setConfig(config: Map<TgglFlagSlug<TFlags>, Flag>) {
    this.config = config
  }

  isActive(context: Partial<TContext>, slug: TgglFlagSlug<TFlags>) {
    assertValidContext(context)
    const flag = this.config.get(slug)
    return flag ? evalFlag(context, flag) !== undefined : false
  }

  get<TSlug extends TgglFlagSlug<TFlags>>(
    context: Partial<TContext>,
    slug: TSlug
  ): TgglFlagValue<TSlug, TFlags> | undefined
  get<
    TSlug extends TgglFlagSlug<TFlags>,
    TDefaultValue = TgglFlagValue<TSlug, TFlags>
  >(
    context: Partial<TContext>,
    slug: TSlug,
    defaultValue: TDefaultValue
  ): TgglFlagValue<TSlug, TFlags> | TDefaultValue
  get<
    TSlug extends TgglFlagSlug<TFlags>,
    TDefaultValue = TgglFlagValue<TSlug, TFlags>
  >(
    context: Partial<TContext>,
    slug: TSlug,
    defaultValue?: TDefaultValue
  ): TgglFlagValue<TSlug, TFlags> | TDefaultValue | undefined {
    assertValidContext(context)
    const flag = this.config.get(slug)
    const result = flag ? evalFlag(context, flag) : undefined
    return result === undefined ? defaultValue : result
  }
}
