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
  private pollingInterval?: number
  private timeoutID?: ReturnType<typeof setTimeout>
  private fetchID = 0
  private onConfigChangeCallbacks = new Map<
    number,
    (config: Map<TgglFlagSlug<TFlags>, Flag>) => void
  >()

  constructor(
    private apiKey: string,
    options: {
      url?: string
      initialConfig?: Map<TgglFlagSlug<TFlags>, Flag>
      pollingInterval?: number
    } = {}
  ) {
    checkApiKey(apiKey)

    this.url = options.url ?? 'https://api.tggl.io/config'
    this.config = options.initialConfig ?? new Map()
    this.pollingInterval = options.pollingInterval
  }

  onConfigChange(callback: (config: Map<TgglFlagSlug<TFlags>, Flag>) => void) {
    const id = Math.random()
    this.onConfigChangeCallbacks.set(id, callback)

    return () => {
      this.onConfigChangeCallbacks.delete(id)
    }
  }

  startPolling(pollingInterval: number) {
    this.pollingInterval = pollingInterval
    this.fetchConfig()
  }

  stopPolling() {
    this.pollingInterval = undefined
    if (this.timeoutID) {
      clearTimeout(this.timeoutID)
      this.timeoutID = undefined
    }
  }

  async fetchConfig() {
    try {
      if (this.timeoutID) {
        clearTimeout(this.timeoutID)
        this.timeoutID = undefined
      }

      const fetchID = ++this.fetchID

      const response = await apiCall({
        url: this.url,
        apiKey: this.apiKey,
        method: 'get',
      })

      if (fetchID !== this.fetchID) {
        return
      }

      if (this.pollingInterval && this.pollingInterval > 0) {
        this.timeoutID = setTimeout(async () => {
          await this.fetchConfig().catch((err) => console.error(err))
        }, this.pollingInterval)
      }

      const configChanged =
        this.onConfigChangeCallbacks.size > 0 &&
        (response.length !== this.config.size ||
          !response.every(
            (flag: any) =>
              JSON.stringify(this.config.get(flag.slug)) ===
              JSON.stringify(flag)
          ))

      this.config.clear()
      for (const flag of response) {
        this.config.set(flag.slug, flag)
      }

      if (configChanged) {
        for (const callback of this.onConfigChangeCallbacks.values()) {
          callback(this.config)
        }
      }
    } catch (error) {
      if (this.pollingInterval && this.pollingInterval > 0 && !this.timeoutID) {
        this.timeoutID = setTimeout(async () => {
          await this.fetchConfig().catch((err) => console.error(err))
        }, this.pollingInterval)
      }

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
