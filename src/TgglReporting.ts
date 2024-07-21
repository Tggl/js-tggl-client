import { apiCall } from './apiCall'

export const PACKAGE_VERSION = '1.15.2'

export class TgglReporting {
  private app: string | null
  public appPrefix: string | null
  private apiKey: string
  private url: string
  private disabled = false
  private flagsToReport: Record<
    string,
    Map<
      string,
      {
        active: boolean
        value?: any
        default?: any
        count: number
        stack?: string
      }
    >
  > = {}

  constructor({
    app,
    appPrefix,
    apiKey,
    url,
  }: {
    app?: string
    appPrefix?: string
    apiKey: string
    url?: string
  }) {
    this.app = app ?? null
    this.appPrefix = appPrefix ?? null
    this.apiKey = apiKey
    this.url = url ?? 'https://api.tggl.io/report'

    this.sendReport()
  }

  disable() {
    this.disabled = true
  }

  private async sendReport() {
    const payload: Record<string, any> = {}

    if (Object.keys(this.flagsToReport).length) {
      const flagsToReport = { ...this.flagsToReport }
      this.flagsToReport = {}

      payload.clients = [
        {
          id: `${this.appPrefix ?? ''}${this.app && this.appPrefix ? '/' : ''}${
            this.app ?? ''
          }`,
          flags: Object.entries(flagsToReport).reduce(
            (acc, [key, value]) => {
              acc[key] = [...value.values()]
              return acc
            },
            {} as Record<
              string,
              {
                active: boolean
                value?: any
                default?: any
                count: number
                stack?: string
              }[]
            >
          ),
        },
      ]
    }

    if (Object.keys(payload).length) {
      await apiCall({
        url: this.url,
        apiKey: this.apiKey,
        method: 'post',
        body: payload,
      })
    }

    if (!this.disabled) {
      setTimeout(() => {
        this.sendReport()
      }, 2000)
    }
  }

  reportFlag(
    slug: string,
    data: {
      active: boolean
      value?: any
      default?: any
      stack?: string
    }
  ) {
    const key = `${data.active ? '1' : '0'}${JSON.stringify(
      data.value
    )}${JSON.stringify(data.default)}${data.stack}`

    this.flagsToReport[slug] ??= new Map()

    const value =
      this.flagsToReport[slug].get(key) ??
      this.flagsToReport[slug]
        .set(key, {
          active: data.active,
          value: data.value,
          default: data.default,
          count: 0,
          stack: data.stack,
        })
        .get(key)!

    value.count++
  }
}
