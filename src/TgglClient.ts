import { TgglContext, TgglFlags, TgglFlagSlug, TgglStorage } from './types.js';
import { TgglReporting, TgglReportingOptions } from './TgglReporting.js';
import { PACKAGE_VERSION } from './version.js';
import ky from 'ky';
import { TgglClientStateSerializer } from './serializers.js';
import { localStorageStorage } from './TgglLocalStorageStorage.js';
import { TgglStaticClient } from './TgglStaticClient';

export type TgglClientOptions<TContext extends TgglContext = TgglContext> = {
  apiKey?: string | null;
  baseUrls?: string[];
  maxRetries?: number;
  timeoutMs?: number;
  pollingIntervalMs?: number;
  storages?: TgglStorage[];
  initialContext?: Partial<TContext>;
  reporting?: TgglReportingOptions | TgglReporting | boolean;
  appName?: string | null;
  initialFetch?: boolean;
};

export class TgglClient<
  TFlags extends TgglFlags = TgglFlags,
  TContext extends TgglContext = TgglContext,
> extends TgglStaticClient<TFlags, TContext> {
  private _apiKey: string | null;
  private _baseUrls: string[];
  private _pollingIntervalMs: number = 0;
  private _nextPolling: number | null = null;
  private _contextVersion: number = 1;
  private _maxRetries: number;
  private _timeoutMs: number;
  private _error: Error | null = null;
  private _storages: TgglStorage[];
  private _ready: boolean = false;
  private _resolveReady: (() => void) | null = null;
  private _readyPromise: Promise<void> = new Promise((resolve) => {
    this._resolveReady = resolve;
  });
  private _fetching: boolean = false;
  private _resolveFetching: (() => void) | null = null;
  private _fetchingPromise: Promise<void> = Promise.resolve();
  private _fetchedOnce: boolean = false;

  constructor({
    apiKey = null,
    baseUrls = [],
    maxRetries = 3,
    timeoutMs = 8_000,
    pollingIntervalMs = 0,
    storages = [localStorageStorage],
    initialContext = {},
    reporting = true,
    appName = null,
    initialFetch = true,
  }: TgglClientOptions<TContext> = {}) {
    if (!baseUrls.includes('https://api.tggl.io')) {
      baseUrls.push('https://api.tggl.io');
    }

    const defaultReportingOptions: TgglReportingOptions = {
      apiKey: apiKey,
      baseUrls,
      flushIntervalMs: 5_000,
    };

    let r: TgglReporting;
    if (reporting === false) {
      r = new TgglReporting({
        ...defaultReportingOptions,
        flushIntervalMs: 0,
      });
    } else if (reporting === true) {
      r = new TgglReporting(defaultReportingOptions);
    } else if (reporting instanceof TgglReporting) {
      r = reporting;
    } else {
      r = new TgglReporting({
        ...defaultReportingOptions,
        ...reporting,
      });
    }

    super({
      context: initialContext,
      reporting: r,
      appName,
      flags: {},
    });

    this._apiKey = apiKey;
    this._maxRetries = maxRetries;
    this._timeoutMs = timeoutMs;

    this._baseUrls = baseUrls;

    this._clientId = `js-client:${PACKAGE_VERSION}/TgglClient`;
    if (appName) {
      this._clientId += `/${appName}`;
    }

    let latestDate = 0;
    for (const storage of storages) {
      try {
        Promise.resolve(storage.get())
          .then((value) => {
            if (this._fetchedOnce || value == null) {
              return;
            }
            const parsed = TgglClientStateSerializer.deserialize<TFlags>(value);
            if (!parsed) {
              return;
            }
            if (parsed.date > latestDate) {
              latestDate = parsed.date;
              this.setFlags(parsed.flags);
            }
          })
          .catch(() => null);
      } catch {
        // ignore
      }
    }
    this.onFlagsChange(() => {
      if (!this._fetchedOnce) {
        return;
      }
      const serialized = TgglClientStateSerializer.serialize({
        date: Date.now(),
        flags: this._flags,
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
    if (pollingIntervalMs <= 0 && initialFetch) {
      this.refetch();
    }
  }

  onFetchSuccessful(callback: () => void): () => void {
    return this._registerEventListener('fetch', callback);
  }

  onFlagsChange(callback: (flags: TgglFlagSlug<TFlags>[]) => void): () => void {
    return this._registerEventListener('flagsChange', callback);
  }

  onFlagChange(slug: TgglFlagSlug<TFlags>, callback: () => void): () => void {
    return this._registerEventListener('flagChange-' + String(slug), callback);
  }

  async setContext(context: Partial<TContext>): Promise<void> {
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

    this._contextVersion++;
    const version = this._contextVersion;

    const postData = JSON.stringify(context);
    const headers: Record<string, string | undefined> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(postData)),
    };

    if (this._apiKey) {
      headers['x-tggl-api-key'] = this._apiKey;
    }

    let lastError: any = null;
    let response: Partial<TFlags> | null = null;
    for (const baseUrl of this._baseUrls) {
      try {
        response = await ky
          .post(baseUrl + '/flags', {
            headers,
            body: postData,
            retry: {
              methods: ['post'],
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
          .json<Partial<TFlags>>();
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (version !== this._contextVersion) {
      return this._fetchingPromise;
    }

    this._ready = true;

    if (response === null) {
      this._error = lastError;
      this._emitEvent('error', lastError);
    } else {
      this._fetchedOnce = true;
      this._context = { ...context };
      this.setFlags(response);
      this._emitEvent('fetch');
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

  setFlags(flags: Partial<TFlags>): void {
    this._error = null;
    this._ready = true;

    const oldFlags = this._flags;
    const changedFlags: TgglFlagSlug<TFlags>[] = [];
    const allKeys = new Set([...Object.keys(oldFlags), ...Object.keys(flags)]);
    this._flags = flags;

    for (const key of allKeys) {
      const oldValue = oldFlags[key as keyof TFlags];
      const newValue = flags[key as keyof TFlags];

      // Deep comparison for changes
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changedFlags.push(key as TgglFlagSlug<TFlags>);
        this._emitEvent('flagChange-' + key);
      }
    }

    if (changedFlags.length > 0) {
      this._emitEvent('flagsChange', changedFlags);
    }

    if (this._resolveReady) {
      this._resolveReady();
      this._resolveReady = null;
    }
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

  async refetch(): Promise<void> {
    await this.setContext(this.getContext());
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
}
