import { apiCall } from './apiCall'

export const PACKAGE_VERSION = '1.15.5'

const constantCase = (str: string) => {
  return str
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\W_]+/g, '_')
    .toUpperCase()
}

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
      }
    >
  > = {}
  private receivedPropertiesToReport: Record<string, [number, number]> = {}
  private receivedValuesToReport: Record<
    string,
    Record<string, string | null>
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
    try {
      const payload: Record<string, any> = {}

      if (Object.keys(this.flagsToReport).length) {
        const flagsToReport = { ...this.flagsToReport }
        this.flagsToReport = {}

        payload.clients = [
          {
            id:
              `${this.appPrefix ?? ''}${this.app && this.appPrefix ? '/' : ''}${
                this.app ?? ''
              }` || undefined,
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
                }[]
              >
            ),
          },
        ]
      }

      if (Object.keys(this.receivedPropertiesToReport).length) {
        const receivedProperties = this.receivedPropertiesToReport
        this.receivedPropertiesToReport = {}

        payload.receivedProperties = receivedProperties
      }

      if (Object.keys(this.receivedValuesToReport).length) {
        const receivedValues = this.receivedValuesToReport
        this.receivedValuesToReport = {}

        const data = Object.keys(receivedValues).reduce((acc, key) => {
          for (const value of Object.keys(receivedValues[key])) {
            const label = receivedValues[key][value]

            if (label) {
              acc.push([key, value, label])
            } else {
              acc.push([key, value])
            }
          }

          return acc
        }, [] as string[][])

        const pageSize = 2000

        payload.receivedValues = data.slice(0, pageSize).reduce((acc, cur) => {
          acc[cur[0]] ??= []
          acc[cur[0]].push(cur.slice(1).map((v) => v.slice(0, 240)))
          return acc
        }, {} as Record<string, string[][]>)

        for (let i = pageSize; i < data.length; i += pageSize) {
          await apiCall({
            url: this.url,
            apiKey: this.apiKey,
            method: 'post',
            body: {
              receivedValues: data.slice(i, i + pageSize).reduce((acc, cur) => {
                acc[cur[0]] ??= []
                acc[cur[0]].push(cur.slice(1).map((v) => v.slice(0, 240)))
                return acc
              }, {} as Record<string, string[][]>),
            },
          })
        }
      }

      if (Object.keys(payload).length) {
        await apiCall({
          url: this.url,
          apiKey: this.apiKey,
          method: 'post',
          body: payload,
        })
      }
    } catch (error) {
      // Do nothing
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
    }
  ) {
    try {
      const key = `${data.active ? '1' : '0'}${JSON.stringify(
        data.value ?? null
      )}${JSON.stringify(data.default ?? null)}`

      this.flagsToReport[slug] ??= new Map()

      const value =
        this.flagsToReport[slug].get(key) ??
        this.flagsToReport[slug]
          .set(key, {
            active: data.active,
            value: data.value ?? null,
            default: data.default ?? null,
            count: 0,
          })
          .get(key)!

      value.count++
    } catch (error) {
      // Do nothing
    }
  }

  reportContext(context: any) {
    try {
      const now = Math.round(Date.now() / 1000)

      for (const key of Object.keys(context)) {
        if (this.receivedPropertiesToReport[key]) {
          this.receivedPropertiesToReport[key][1] = now
        } else {
          this.receivedPropertiesToReport[key] = [now, now]
        }

        if (typeof context[key] === 'string' && context[key]) {
          const constantCaseKey = constantCase(key).replace(/_I_D$/, '_ID')
          const labelKeyTarget = constantCaseKey.endsWith('_ID')
            ? constantCaseKey.replace(/_ID$/, '_NAME')
            : null
          const labelKey = labelKeyTarget
            ? Object.keys(context).find(
                (k) => constantCase(k) === labelKeyTarget
              ) ?? null
            : null

          this.receivedValuesToReport[key] ??= {}
          this.receivedValuesToReport[key][context[key]] =
            labelKey && typeof context[labelKey] === 'string'
              ? context[labelKey] || null
              : null
        }
      }
    } catch (error) {
      // Do nothing
    }
  }
}
