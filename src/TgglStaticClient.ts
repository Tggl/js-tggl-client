import {
  TgglContext,
  TgglFlags,
  TgglFlagSlug,
  TgglFlagValue,
} from './types.js';
import { TgglReporting } from './TgglReporting.js';
import { PACKAGE_VERSION } from './version.js';
import { EventEmitter } from './EventEmitter.js';

export type TgglStaticClientOptions<
  TFlags extends TgglFlags = TgglFlags,
  TContext extends TgglContext = TgglContext,
> = {
  context?: Partial<TContext>;
  flags?: Partial<TFlags>;
  reporting: TgglReporting;
  appName?: string | null;
};

export class TgglStaticClient<
  TFlags extends TgglFlags = TgglFlags,
  TContext extends TgglContext = TgglContext,
> extends EventEmitter {
  protected _context: Partial<TContext>;
  protected _flags: Partial<TFlags> = {};
  protected _reporting: TgglReporting;
  protected _clientId: string;

  constructor({
    context = {},
    flags = {},
    reporting,
    appName = null,
  }: TgglStaticClientOptions<TFlags, TContext>) {
    super();
    this._clientId = `js-client:${PACKAGE_VERSION}/TgglStaticClient`;
    if (appName) {
      this._clientId += `/${appName}`;
    }

    this._context = context;
    this._flags = flags;
    this._reporting = reporting;
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

    this._emitEvent('flagEval', {
      value,
      default: defaultValue,
      slug,
    });

    return value;
  }

  onFlagEval(
    callback: (data: { value: unknown; default: unknown; slug: string }) => void
  ): () => void {
    return this._registerEventListener('flagEval', callback);
  }

  getAll(): Partial<TFlags> {
    return this._flags;
  }

  getContext(): Partial<TContext> {
    return this._context;
  }

  getReporting(): TgglReporting {
    return this._reporting;
  }
}
