import {
  TgglConfig,
  TgglContext,
  TgglFlags,
  TgglFlagSlug,
  TgglFlagValue,
  TgglLocalClientOptions,
} from './types'
import { evalFlag, Flag } from 'tggl-core'
import { assertValidContext } from './validation'
import { apiCall } from './apiCall'
import { PACKAGE_VERSION, TgglReporting } from './TgglReporting'

export class TgglLocalClient<
  TFlags extends TgglFlags = TgglFlags,
  TContext extends TgglContext = TgglContext
> {
  private url: string
  private config: TgglConfig<TFlags>
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
    (config: TgglConfig<TFlags>) => void
  >()
  private onFetchSuccessfulCallbacks = new Map<number, () => void>()
  private onFetchFailCallbacks = new Map<number, (error: Error) => void>()
  private log: boolean = true
  protected reporting: TgglReporting | null

  constructor(
    private apiKey?: string | null,
    options: TgglLocalClientOptions<TFlags> = {}
  ) {
    if (options.url) {
      this.url = options.url
    } else if (options.baseUrl) {
      this.url = options.baseUrl + '/config'
    } else {
      this.url = 'https://api.tggl.io/config'
    }
    this.config = options.initialConfig ?? new Map()
    this.log = options.log ?? true

    const reportingOptions =
      options.reporting && typeof options.reporting === 'object'
        ? options.reporting
        : {}

    this.reporting =
      options.reporting === false
        ? null
        : new TgglReporting({
            apiKey: reportingOptions.apiKey ?? apiKey,
            app: reportingOptions.app,
            appPrefix:
              reportingOptions.appPrefix ??
              `js-client:${PACKAGE_VERSION}/TgglLocalClient`,
            url: reportingOptions.url,
            baseUrl: reportingOptions.baseUrl ?? options.baseUrl,
          })

    this.startPolling(options.pollingInterval ?? 0)
  }

  onConfigChange(callback: (config: TgglConfig<TFlags>) => void) {
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

  setConfig(config: TgglConfig<TFlags>) {
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
    })
    this.reporting?.reportContext(context)

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
    const rawValue = flag ? evalFlag(context, flag) : undefined
    const value = rawValue === undefined ? defaultValue : rawValue

    this.reporting?.reportFlag(String(slug), {
      active: value !== undefined,
      default: defaultValue,
      value,
    })
    this.reporting?.reportContext(context)

    return value
  }

  getActiveFlags(context: Partial<TContext>): Partial<TFlags> {
    const result: Partial<TFlags> = {}

    for (const [slug, flag] of this.config.entries()) {
      const value = evalFlag(context, flag)
      if (value !== undefined) {
        result[slug as keyof TFlags] = value
      }
    }
    this.reporting?.reportContext(context)

    return result
  }
}
