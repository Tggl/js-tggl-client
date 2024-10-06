import { Flag } from 'tggl-core'

export interface TgglContext {}

export interface TgglFlags {}

export type TgglFlagSlug<TFlags extends TgglFlags = TgglFlags> =
  keyof TFlags extends never ? string : keyof TFlags

export type TgglFlagValue<TSlug, TFlags extends TgglFlags = TgglFlags> =
  TSlug extends keyof TFlags ? TFlags[TSlug] : any

export type TgglConfig<TFlags extends TgglFlags = TgglFlags> = Map<
  TgglFlagSlug<TFlags>,
  Flag
>

/**
 * Either define the entire path using `url` or just the base path using `baseUrl` so that default paths can be appended.
 * If both are defined, `url` will be used.
 */
type UrlOrBaseUrl = { url?: string; baseUrl?: string }

export type TgglReportingOptions = UrlOrBaseUrl & {
  app?: string
  appPrefix?: string
  apiKey?: string | null
  reportInterval?: number
}

export type TgglOptions<TFlags extends TgglFlags = TgglFlags> = UrlOrBaseUrl & {
  pollingInterval?: number
  log?: boolean
  reporting?: boolean | TgglReportingOptions
}

export type TgglLocalClientOptions<TFlags extends TgglFlags = TgglFlags> =
  TgglOptions & {
    initialConfig?: Map<TgglFlagSlug<TFlags>, Flag>
  }

export type TgglClientOptions<TFlags extends TgglFlags = TgglFlags> =
  TgglOptions & {
    initialActiveFlags?: Partial<TFlags>
  }
