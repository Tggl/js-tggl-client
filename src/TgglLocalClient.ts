import { TgglContext, TgglFlags, TgglFlagSlug, TgglFlagValue } from './types'
import { evalFlag, Flag } from 'tggl-core'
import { assertValidContext } from './validation'
import { apiCall } from './apiCall'
import { TgglReporting } from './TgglReporting'

export class TgglLocalClient<
  TFlags extends TgglFlags = TgglFlags,
  TContext extends TgglContext = TgglContext
> {
  private url: string
  private config: Map<TgglFlagSlug<TFlags>, Flag>
  private pollingInterval: number = 0
  private timeoutID?: ReturnType<typeof setTimeout>
  private fetchID = 0
  private lastSuccessfulFetchID = 0
  private lastSuccessfulFetchResponse:
    | ({ slug: TgglFlagSlug<TFlags> } & Flag)[]
    | null = null
  private fetchPromise?: Promise<number>
  private onConfigChangeCallbacks = new Map<
    number,
    (config: Map<TgglFlagSlug<TFlags>, Flag>) => void
  >()
  private onFetchSuccessfulCallbacks = new Map<number, () => void>()
  private onFetchFailCallbacks = new Map<number, (error: Error) => void>()
  private log: boolean = true
  protected reporting: TgglReporting | null

  constructor(
    private apiKey?: string | null,
    options: {
      url?: string
      initialConfig?: Map<TgglFlagSlug<TFlags>, Flag>
      pollingInterval?: number
      log?: boolean
      reporting?: boolean | { app?: string; url?: string }
    } = {}
  ) {
    this.url = options.url ?? 'https://api.tggl.io/config'
    this.config = options.initialConfig ?? new Map()
    this.log = options.log ?? true
    this.reporting =
      options.reporting === false || !apiKey
        ? null
        : new TgglReporting({
            apiKey,
            app:
              typeof options.reporting === 'object'
                ? `TgglLocalClient/${options.reporting.app}`
                : 'TgglLocalClient',
            url:
              typeof options.reporting === 'object'
                ? options.reporting.url
                : undefined,
          })

    this.startPolling(options.pollingInterval ?? 0)
  }

  onConfigChange(callback: (config: Map<TgglFlagSlug<TFlags>, Flag>) => void) {
    const id = Math.random()
    this.onConfigChangeCallbacks.set(id, callback)

    return () => {
      this.onConfigChangeCallbacks.delete(id)
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
      this.fetchConfig().catch((err) => {
        if (this.log) {
          console.error(err)
        }
      })
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
        await this.fetchConfig().catch((err) => {
          if (this.log) {
            console.error(err)
          }
        })
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

  async fetchConfig() {
    const fetchID = ++this.fetchID

    let done: () => void = () => null
    this.fetchPromise = new Promise((resolve) => {
      done = () => resolve(fetchID)
    })

    try {
      this.cancelNextPolling()

      const response: any = await apiCall({
        url: this.url,
        apiKey: this.apiKey,
        method: 'get',
      })

      for (const callback of this.onFetchSuccessfulCallbacks.values()) {
        callback()
      }

      if (fetchID > this.lastSuccessfulFetchID) {
        this.lastSuccessfulFetchID = fetchID
        this.lastSuccessfulFetchResponse = response
      }

      // If another fetch was started while this one was running
      if (fetchID !== this.fetchID) {
        await this.waitForLastFetchToFinish()

        return this.config
      }
    } catch (error) {
      for (const callback of this.onFetchFailCallbacks.values()) {
        callback(error as Error)
      }

      throw new Error(
        // @ts-ignore
        `Invalid response from Tggl: ${error.error ?? error.message}`
      )
    } finally {
      // If this is the last fetch that was started, we can update the config
      if (fetchID === this.fetchID && this.lastSuccessfulFetchResponse) {
        this.setRawConfig(this.lastSuccessfulFetchResponse)
      }

      done()
      this.planNextPolling()
    }

    return this.config
  }

  getConfig() {
    return this.config
  }

  setConfig(config: Map<TgglFlagSlug<TFlags>, Flag>) {
    this.config = config
  }

  private setRawConfig(flags: ({ slug: TgglFlagSlug<TFlags> } & Flag)[]) {
    const configChanged =
      this.onConfigChangeCallbacks.size > 0 &&
      (flags.length !== this.config.size ||
        !flags.every(
          (flag: any) =>
            JSON.stringify(this.config.get(flag.slug)) === JSON.stringify(flag)
        ))

    this.config.clear()

    for (const flag of flags) {
      this.config.set(flag.slug, flag)
    }

    if (configChanged) {
      for (const callback of this.onConfigChangeCallbacks.values()) {
        callback(this.config)
      }
    }
  }

  isActive(context: Partial<TContext>, slug: TgglFlagSlug<TFlags>) {
    assertValidContext(context)
    const flag = this.config.get(slug)
    const value = flag ? evalFlag(context, flag) : undefined
    const active = value !== undefined

    this.reporting?.reportFlag(String(slug), {
      active,
      value,
      stack: Error().stack?.split('\n').slice(2).join('\n'),
    })

    return active
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
    const value = flag ? evalFlag(context, flag) : undefined

    this.reporting?.reportFlag(String(slug), {
      active: value !== undefined,
      default: defaultValue,
      value,
      stack: Error().stack?.split('\n').slice(2).join('\n'),
    })

    return value === undefined ? defaultValue : value
  }
}
