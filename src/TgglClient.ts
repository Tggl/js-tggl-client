import {
  TgglContext,
  TgglFlags,
  TgglFlagSlug,
  TgglFlagValue,
  TgglStorage,
} from './types';
import { TgglReporting, TgglReportingOptions } from './TgglReporting';
import { PACKAGE_VERSION } from './version';
import ky from 'ky';
import { TgglClientStateSerializer } from './serializers';
import { localStorageStorage } from './TgglLocalStorageStorage';

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
};

export class TgglClient<
  TFlags extends TgglFlags = TgglFlags,
  TContext extends TgglContext = TgglContext,
> {
  private _apiKey: string | null;
  private _baseUrls: string[];
  private _context: Partial<TContext>;
  private _flags: Partial<TFlags> = {};
  private _reporting: TgglReporting;
  private _clientId: string;
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
    pollingIntervalMs = 0,
    storages = [localStorageStorage],
    initialContext = {},
    reporting = true,
    appName = null,
  }: TgglClientOptions<TContext> = {}) {
    this._apiKey = apiKey;
    this._maxRetries = maxRetries;
    this._timeoutMs = timeoutMs;

    this._baseUrls = baseUrls;
    if (!this._baseUrls.includes('https://api.tggl.io')) {
      this._baseUrls.push('https://api.tggl.io');
    }

    this._clientId = `js-client:${PACKAGE_VERSION}/TgglClient`;
    if (appName) {
      this._clientId += `/${appName}`;
    }

    this._context = initialContext;

    const defaultReportingOptions: TgglReportingOptions = {
      apiKey: apiKey,
      baseUrls: this._baseUrls,
      flushIntervalMs: 5_000,
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
    if (pollingIntervalMs <= 0) {
      this.refetch();
    }
  }

  get<
    TSlug extends TgglFlagSlug<TFlags>,
    TDefaultValue = TgglFlagValue<TSlug, TFlags>,
  >(
    slug: TSlug,
    defaultValue: TDefaultValue
  ): TgglFlagValue<TSlug, TFlags> | TDefaultValue {
    const value =
      this._flags[slug as keyof TFlags] === undefined
        ? defaultValue
        : (this._flags[slug as keyof TFlags] as TgglFlagValue<TSlug, TFlags>);

    this._reporting.reportFlag({
      value,
      slug: slug as string,
      default: defaultValue,
      clientId: this._clientId,
    });

    return value;
  }

  getAll(): Partial<TFlags> {
    return this._flags;
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

  onFlagsChange(callback: (flags: TgglFlagSlug<TFlags>[]) => void): () => void {
    return this._registerEventListener('flagsChange', callback);
  }

  onFlagChange(slug: TgglFlagSlug<TFlags>, callback: () => void): () => void {
    return this._registerEventListener('flagChange-' + String(slug), callback);
  }

  getContext(): Partial<TContext> {
    return this._context;
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

  getReporting(): TgglReporting {
    return this._reporting;
  }
}
