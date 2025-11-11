import ky from 'ky';

export type TgglReportingOptions = {
  apiKey?: string | null;
  baseUrls?: string[];
  flushIntervalMs?: number;
};

export type TgglReport = {
  receivedProperties?: Record<string, [number, number]>;
  receivedValues?: Record<string, Array<[string] | [string, string]>>;
  clients?: Array<{
    id?: string;
    flags: Record<
      string,
      Array<{
        value?: any;
        default?: any;
        count?: number;
      }>
    >;
  }>;
};

const constantCase = (str: string): string => {
  return str
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\W_]+/g, '_')
    .toUpperCase();
};

export class TgglReporting {
  private _flushIntervalMs: number = 0;
  private _apiKey: string | null;
  private _baseUrls: string[];
  private _nextFlush: number | null = null;
  private _reportFlags: Record<
    string,
    Record<
      string,
      Map<
        string,
        {
          value: any;
          default: any;
          count: number;
        }
      >
    >
  > = {};
  private _reportProperties: Record<string, [number, number]> = {};
  private _reportValues: Record<string, Record<string, string | null>> = {};

  constructor({
    apiKey = null,
    baseUrls = [],
    flushIntervalMs = 5_000,
  }: TgglReportingOptions = {}) {
    this._apiKey = apiKey;

    this._baseUrls = baseUrls;
    if (!this._baseUrls.includes('https://api.tggl.io')) {
      this._baseUrls.push('https://api.tggl.io');
    }

    this.start(flushIntervalMs);
  }

  stop(): void {
    this.start(0);
  }

  start(flushIntervalMs: number = 5_000): void {
    this._flushIntervalMs = Math.max(0, flushIntervalMs);

    if (flushIntervalMs <= 0 && this._nextFlush) {
      clearTimeout(this._nextFlush);
      this._nextFlush = null;
    }

    this._scheduleNextFlush();
  }

  isActive(): boolean {
    return this._flushIntervalMs > 0;
  }

  async flush(): Promise<void> {
    if (this._nextFlush) {
      clearTimeout(this._nextFlush);
      this._nextFlush = null;
    }

    let report: TgglReport = {};

    if (Object.keys(this._reportFlags).length) {
      const flagsToReport = { ...this._reportFlags };
      this._reportFlags = {};

      report.clients = [];

      for (const [clientId, flags] of Object.entries(flagsToReport)) {
        report.clients.push({
          id: clientId || undefined,
          flags: Object.entries(flags).reduce(
            (acc, [key, value]) => {
              acc[key] = [...value.values()];
              return acc;
            },
            {} as Record<
              string,
              {
                value: any;
                default: any;
                count: number;
              }[]
            >
          ),
        });
      }
    }

    if (Object.keys(this._reportProperties).length) {
      const receivedProperties = this._reportProperties;
      this._reportProperties = {};

      report.receivedProperties = receivedProperties;
    }

    let values: ([string, string] | [string, string, string])[] = [];
    if (Object.keys(this._reportValues).length) {
      const receivedValues = this._reportValues;
      this._reportValues = {};

      values = Object.keys(receivedValues).reduce(
        (acc, key) => {
          for (const value of Object.keys(receivedValues[key])) {
            const label = receivedValues[key][value];

            if (label) {
              acc.push([key, value, label]);
            } else {
              acc.push([key, value]);
            }
          }

          return acc;
        },
        [] as typeof values
      );
    }

    for (
      let i = 0;
      i < values.length || report.clients || report.receivedProperties;
      i += 2000
    ) {
      report.receivedValues = values.slice(i, i + 2000).reduce(
        (acc, cur) => {
          acc[cur[0]] ??= [];
          acc[cur[0]].push(
            cur.slice(1).map((v) => v.slice(0, 240)) as [string]
          );
          return acc;
        },
        {} as Record<string, ([string] | [string, string])[]>
      );

      if (Object.keys(report.receivedValues).length === 0) {
        delete report.receivedValues;
      }

      const postData = JSON.stringify(report);
      const headers: Record<string, string | undefined> = {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(postData)),
      };

      if (this._apiKey) {
        headers['x-tggl-api-key'] = this._apiKey;
      }

      let lastError: any = null;
      for (const baseUrl of this._baseUrls) {
        try {
          await ky.post(baseUrl + '/report', {
            headers,
            body: postData,
            retry: {
              methods: ['post'],
              limit: 2,
              retryOnTimeout: true,
            },
            timeout: 10_000,
          });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (lastError) {
        this.mergeReport(report);
      }

      report = {};
    }

    this._scheduleNextFlush();
  }

  private _scheduleNextFlush(): void {
    if (this._flushIntervalMs <= 0 || this._nextFlush) {
      return;
    }

    if (
      Object.keys(this._reportFlags).length === 0 &&
      Object.keys(this._reportProperties).length === 0 &&
      Object.keys(this._reportValues).length === 0
    ) {
      return;
    }

    this._nextFlush = setTimeout(
      () => this.flush(),
      this._flushIntervalMs
    ) as unknown as number;
  }

  reportFlag(data: {
    value: any;
    default: any;
    count?: number;
    clientId: string;
    slug: string;
  }): void {
    try {
      this._reportFlags[data.clientId] ??= {};

      const key = `${JSON.stringify(data.value ?? null)}${JSON.stringify(
        data.default ?? null
      )}`;

      this._reportFlags[data.clientId][data.slug] ??= new Map();

      const value =
        this._reportFlags[data.clientId][data.slug].get(key) ??
        this._reportFlags[data.clientId][data.slug]
          .set(key, {
            value: data.value ?? null,
            default: data.default ?? null,
            count: 0,
          })
          .get(key)!;

      value.count += data.count ?? 1;
    } catch (error) {
      // Do nothing
    }

    this._scheduleNextFlush();
  }

  reportContext(context: any): void {
    try {
      const now = Math.round(Date.now() / 1000);

      for (const key of Object.keys(context)) {
        if (this._reportProperties[key]) {
          this._reportProperties[key][1] = now;
        } else {
          this._reportProperties[key] = [now, now];
        }

        if (typeof context[key] === 'string' && context[key]) {
          const constantCaseKey = constantCase(key).replace(/_I_D$/, '_ID');
          const labelKeyTarget = constantCaseKey.endsWith('_ID')
            ? constantCaseKey.replace(/_ID$/, '_NAME')
            : null;
          const labelKey = labelKeyTarget
            ? (Object.keys(context).find(
                (k) => constantCase(k) === labelKeyTarget
              ) ?? null)
            : null;

          this._reportValues[key] ??= {};
          this._reportValues[key][context[key]] =
            labelKey && typeof context[labelKey] === 'string'
              ? context[labelKey] || null
              : null;
        }
      }
    } catch (error) {
      // Do nothing
    }

    this._scheduleNextFlush();
  }

  mergeReport(report: TgglReport): void {
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
      return;
    }

    try {
      if (report.receivedProperties) {
        for (const [key, [min, max]] of Object.entries(
          report.receivedProperties
        )) {
          if (this._reportProperties[key]) {
            this._reportProperties[key][0] = Math.min(
              this._reportProperties[key][0],
              min
            );
            this._reportProperties[key][1] = Math.max(
              this._reportProperties[key][1],
              max
            );
          } else {
            this._reportProperties[key] = [min, max];
          }
        }
      }

      if (report.receivedValues) {
        for (const [key, values] of Object.entries(report.receivedValues)) {
          for (const [value, label] of values) {
            this._reportValues[key] ??= {};
            this._reportValues[key][value] =
              label ?? this._reportValues[key][value] ?? null;
          }
        }
      }

      if (report.clients) {
        for (const client of report.clients) {
          for (const [slug, values] of Object.entries(client.flags)) {
            for (const data of values) {
              this.reportFlag({
                value: data.value,
                default: data.default,
                count: data.count,
                clientId: client.id || '',
                slug,
              });
            }
          }
        }
      }
    } catch (error) {
      // Do nothing
    }

    this._scheduleNextFlush();
  }
}
