import {
  TgglConfig,
  TgglContext,
  TgglFlags,
  TgglFlagSlug,
  TgglFlagValue,
  TgglStorage,
} from './types';
import { TgglReporting, TgglReportingOptions } from './TgglReporting';
import ky from 'ky';
import { evalFlag, Flag } from 'tggl-core';
import { PACKAGE_VERSION } from './version';
import { TgglLocalClientStateSerializer } from './serializers';

export type TgglLocalClientOptions = {
  apiKey?: string | null;
  baseUrls?: string[];
  maxRetries?: number;
  timeoutMs?: number;
  pollingIntervalMs?: number;
  storages?: TgglStorage[];
  reporting?: TgglReportingOptions | TgglReporting | boolean;
  appName?: string | null;
};

export class TgglLocalClient<
  TFlags extends TgglFlags = TgglFlags,
  TContext extends TgglContext = TgglContext,
> {
  private _apiKey: string | null;
  private _baseUrls: string[];
  private _reporting: TgglReporting;
  private _config: TgglConfig<TFlags> = new Map();
  private _maxRetries: number;
  private _timeoutMs: number;
  private _error: Error | null = null;
  private _storages: TgglStorage[];
  private _clientId: string;
  private _pollingIntervalMs: number = 0;
  private _nextPolling: number | null = null;
  private _fetchVersion: number = 1;
  private _ready: boolean = false;
  private _resolveReady: (() => void) | null = null;
  private _readyPromise: Promise<void> = new Promise((resolve) => {
    this._resolveReady = resolve;
  });
  private _fetching: boolean = false;
  private _resolveFetching: (() => void) | null = null;
  private _fetchingPromise: Promise<void> = Promise.resolve();
  private _eventListeners = new Map<
    string,
    Map<number, (...args: any[]) => void>
  >();
  private _eventListenerId: number = 0;
  private _fetchedOnce: boolean = false;

  constructor({
    apiKey = null,
    baseUrls = [],
    maxRetries = 3,
    timeoutMs = 8_000,
    pollingIntervalMs = 5_000,
    storages = [],
    reporting = true,
    appName = null,
  }: TgglLocalClientOptions = {}) {
    this._apiKey = apiKey;
    this._maxRetries = maxRetries;
    this._timeoutMs = timeoutMs;

    this._baseUrls = baseUrls;
    if (!this._baseUrls.includes('https://api.tggl.io')) {
      this._baseUrls.push('https://api.tggl.io');
    }

    this._clientId = `js-client:${PACKAGE_VERSION}/TgglLocalClient`;
    if (appName) {
      this._clientId += `/${appName}`;
    }

    const defaultReportingOptions: TgglReportingOptions = {
      apiKey: apiKey,
      baseUrls: this._baseUrls,
      flushIntervalMs: 10_000,
    };

    if (reporting === false) {
      this._reporting = new TgglReporting({
        ...defaultReportingOptions,
        flushIntervalMs: 0,
      });
    } else if (reporting === true) {
      this._reporting = new TgglReporting(defaultReportingOptions);
    } else if (reporting instanceof TgglReporting) {
      this._reporting = reporting;
    } else {
      this._reporting = new TgglReporting({
        ...defaultReportingOptions,
        ...reporting,
      });
    }

    let latestDate = 0;
    for (const storage of storages) {
      try {
        Promise.resolve(storage.get())
          .then((value) => {
            if (this._fetchedOnce || value == null) {
              return;
            }
            const parsed =
              TgglLocalClientStateSerializer.deserialize<TFlags>(value);
            if (!parsed) {
              return;
            }
            if (parsed.date > latestDate) {
              latestDate = parsed.date;
              this.setConfig(parsed.config);
            }
          })
          .catch(() => null);
      } catch {
        // ignore
      }
    }
    this.onConfigChange(() => {
      if (!this._fetchedOnce) {
        return;
      }
      const serialized = TgglLocalClientStateSerializer.serialize<TFlags>({
        date: Date.now(),
        config: this._config,
      });
      for (const storage of storages) {
        try {
          Promise.resolve(storage.set(serialized)).catch(() => null);
        } catch {
          // ignore
        }
      }
    });
    this._storages = storages;

    this.startPolling(pollingIntervalMs);
    if (pollingIntervalMs <= 0) {
      this.refetch();
    }
  }

  get<
    TSlug extends TgglFlagSlug<TFlags>,
    TDefaultValue = TgglFlagValue<TSlug, TFlags>,
  >(
    context: TContext,
    slug: TSlug,
    defaultValue: TDefaultValue
  ): TgglFlagValue<TSlug, TFlags> | TDefaultValue {
    let value = !this._config.has(slug)
      ? defaultValue
      : evalFlag(context, this._config.get(slug) as Flag);

    if (value === undefined) {
      value = defaultValue;
    }

    this._reporting.reportFlag({
      value,
      slug: slug as string,
      default: defaultValue,
      clientId: this._clientId,
    });

    this._reporting.reportContext(context);

    return value;
  }

  getAll(context: TContext): Partial<TFlags> {
    const result: Partial<TFlags> = {};
    for (const slug of this._config.keys()) {
      const value = evalFlag(context, this._config.get(slug) as Flag);

      if (value !== undefined) {
        result[slug as keyof TFlags] = value;
      }
    }

    this._reporting.reportContext(context);

    return result;
  }

  private _registerEventListener(
    event: string,
    callback: (...args: any[]) => void
  ): () => void {
    const id = this._eventListenerId++;
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Map());
    }
    this._eventListeners.get(event)!.set(id, callback);
    return () => {
      this._eventListeners.get(event)!.delete(id);
    };
  }

  private _emitEvent(event: string, ...args: any[]): void {
    for (const callback of this._eventListeners.get(event)?.values() ?? []) {
      try {
        Promise.resolve(callback(...args)).catch(() => null);
      } catch (error) {
        // Catch callback errors to prevent them from affecting other callbacks
      }
    }
  }

  onConfigChange(
    callback: (flags: TgglFlagSlug<TFlags>[]) => void
  ): () => void {
    return this._registerEventListener('configChange', callback);
  }

  startPolling(pollingIntervalMs: number): void {
    // start
    if (this._pollingIntervalMs === 0 && pollingIntervalMs > 0) {
      this._pollingIntervalMs = pollingIntervalMs;
      this.refetch();
    }
    // stop
    else if (this._pollingIntervalMs > 0 && pollingIntervalMs <= 0) {
      this._pollingIntervalMs = 0;
      if (this._nextPolling) {
        clearTimeout(this._nextPolling);
        this._nextPolling = null;
      }
    }
    // change interval
    else {
      this._pollingIntervalMs = Math.max(0, pollingIntervalMs);
    }
  }

  stopPolling(): void {
    this.startPolling(0);
  }

  getConfig(): TgglConfig<TFlags> {
    return this._config;
  }

  setConfig(config: TgglConfig<TFlags>): void {
    this._error = null;
    this._ready = true;

    const oldConfig = this._config;
    this._config = config;

    const changedFlags: TgglFlagSlug<TFlags>[] = [];
    const allKeys = new Set([...oldConfig.keys(), ...config.keys()]);
    for (const key of allKeys) {
      const oldFlag = oldConfig.get(key);
      const newFlag = config.get(key);
      if (
        !oldFlag ||
        !newFlag ||
        JSON.stringify(oldFlag) !== JSON.stringify(newFlag)
      ) {
        changedFlags.push(key);
      }
    }

    if (changedFlags.length > 0) {
      this._emitEvent('configChange', changedFlags);
    }

    if (this._resolveReady) {
      this._resolveReady();
      this._resolveReady = null;
    }
  }

  async refetch(): Promise<void> {
    if (this._nextPolling) {
      clearTimeout(this._nextPolling);
      this._nextPolling = null;
    }

    if (!this._fetching) {
      this._fetching = true;
      this._fetchingPromise = new Promise((resolve) => {
        this._resolveFetching = resolve;
      });
    }

    this._fetchVersion++;
    const version = this._fetchVersion;

    const headers: Record<string, string | undefined> = {
      'Content-Type': 'application/json',
    };

    if (this._apiKey) {
      headers['x-tggl-api-key'] = this._apiKey;
    }

    let lastError: any = null;
    let response: ({ slug: TgglFlagSlug<TFlags> } & Flag)[] | null = null;
    for (const baseUrl of this._baseUrls) {
      try {
        response = await ky
          .get(baseUrl + '/config', {
            headers,
            retry: {
              limit: this._maxRetries,
              retryOnTimeout: true,
              backoffLimit: 500,
            },
            hooks: {
              beforeError: [
                async (error) => {
                  try {
                    const response: any = await error.response?.json();
                    if ('error' in response) {
                      error.message = response.error as string;
                    }
                  } catch {
                    // ignore
                  }
                  return error;
                },
              ],
            },
            timeout: this._timeoutMs,
          })
          .json<({ slug: TgglFlagSlug<TFlags> } & Flag)[]>();
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (version !== this._fetchVersion) {
      return this._fetchingPromise;
    }

    this._ready = true;

    if (response !== null && !Array.isArray(response)) {
      response = null;
      lastError = new Error('Invalid response from Tggl, malformed config');
    }

    if (response === null) {
      this._error = lastError;
      this._emitEvent('error', lastError);
    } else {
      this._fetchedOnce = true;
      const config: TgglConfig<TFlags> = new Map();
      for (const flag of response) {
        config.set(flag.slug as TgglFlagSlug<TFlags>, flag);
      }
      this.setConfig(config);
    }

    if (this._resolveReady) {
      this._resolveReady();
      this._resolveReady = null;
    }

    this._fetching = false;
    if (this._resolveFetching) {
      this._resolveFetching();
      this._resolveFetching = null;
    }

    if (this._pollingIntervalMs > 0) {
      this._nextPolling = setTimeout(() => {
        this.refetch();
      }, this._pollingIntervalMs) as unknown as number;
    }
  }

  async close(): Promise<void> {
    this.stopPolling();
    this._reporting.stop();
    await this._reporting.flush();
    for (const storage of this._storages) {
      try {
        await storage.close?.();
      } catch {
        // ignore
      }
    }
  }

  isReady(): boolean {
    return this._ready;
  }

  waitReady(): Promise<void> {
    return this._readyPromise;
  }

  onReady(callback: () => void): void {
    if (this._ready) {
      callback();
    } else {
      this._readyPromise.then(() => {
        callback();
      });
    }
  }

  getError(): Error | null {
    return this._error;
  }

  onError(callback: (error: Error) => void): () => void {
    return this._registerEventListener('error', callback);
  }

  getReporting(): TgglReporting {
    return this._reporting;
  }
}
