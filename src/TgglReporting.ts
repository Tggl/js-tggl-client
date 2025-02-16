import { apiCall } from './apiCall'
import { TgglReportingOptions } from './types'

export const PACKAGE_VERSION = '2.1.0'

const constantCase = (str: string) => {
  return str
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\W_]+/g, '_')
    .toUpperCase()
}

export class TgglReporting {
  private app: string | null
  public appPrefix: string | null
  private apiKey: string | null
  private url: string
  private disabled = false
  private reportInterval
  private flagsToReport: Record<
    string,
    Record<
      string,
      Map<
        string,
        {
          value?: any
          default?: any
          count: number
        }
      >
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
    baseUrl,
    reportInterval,
  }: TgglReportingOptions) {
    this.app = app ?? null
    this.appPrefix = appPrefix ?? null
    this.apiKey = apiKey ?? null
    this.reportInterval = reportInterval ?? 2000

    if (url) {
      this.url = url
    } else if (baseUrl) {
      this.url = baseUrl + '/report'
    } else {
      this.url = 'https://api.tggl.io/report'
    }

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

        payload.clients = []

        for (const [clientId, flags] of Object.entries(flagsToReport)) {
          payload.clients.push({
            id: clientId || undefined,
            flags: Object.entries(flags).reduce(
              (acc, [key, value]) => {
                acc[key] = [...value.values()]
                return acc
              },
              {} as Record<
                string,
                {
                  value?: any
                  default?: any
                  count: number
                }[]
              >
            ),
          })
        }
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
      }, this.reportInterval)
    }
  }

  reportFlag(
    slug: string,
    data: {
      value?: any
      default?: any
    }
  ) {
    try {
      this.incrementFlag(
        data,
        `${this.appPrefix ?? ''}${this.app && this.appPrefix ? '/' : ''}${
          this.app ?? ''
        }`,
        slug
      )
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

  mergeReport(report: {
    receivedProperties?: Record<string, [number, number]>
    receivedValues?: Record<string, Array<[string] | [string, string]>>
    clients?: Array<{
      id?: string
      flags: Record<
        string,
        Array<{
          value?: any
          default?: any
          count?: number
        }>
      >
    }>
  }) {
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
      return
    }

    try {
      if (report.receivedProperties) {
        for (const [key, [min, max]] of Object.entries(
          report.receivedProperties
        )) {
          if (this.receivedPropertiesToReport[key]) {
            this.receivedPropertiesToReport[key][0] = Math.min(
              this.receivedPropertiesToReport[key][0],
              min
            )
            this.receivedPropertiesToReport[key][1] = Math.max(
              this.receivedPropertiesToReport[key][1],
              max
            )
          } else {
            this.receivedPropertiesToReport[key] = [min, max]
          }
        }
      }

      if (report.receivedValues) {
        for (const [key, values] of Object.entries(report.receivedValues)) {
          for (const [value, label] of values) {
            this.receivedValuesToReport[key] ??= {}
            this.receivedValuesToReport[key][value] =
              label ?? this.receivedValuesToReport[key][value] ?? null
          }
        }
      }

      if (report.clients) {
        for (const client of report.clients) {
          for (const [slug, values] of Object.entries(client.flags)) {
            for (const data of values) {
              this.incrementFlag(data, client.id ?? '', slug)
            }
          }
        }
      }
    } catch (error) {
      // Do nothing
    }
  }

  private incrementFlag(
    data: { value?: any; default?: any; count?: number },
    clientId: string,
    slug: string
  ) {
    this.flagsToReport[clientId] ??= {}

    const key = `${JSON.stringify(data.value ?? null)}${JSON.stringify(
      data.default ?? null
    )}`

    this.flagsToReport[clientId][slug] ??= new Map()

    const value =
      this.flagsToReport[clientId][slug].get(key) ??
      this.flagsToReport[clientId][slug]
        .set(key, {
          value: data.value ?? null,
          default: data.default ?? null,
          count: 0,
        })
        .get(key)!

    value.count += data.count ?? 1
  }
}
