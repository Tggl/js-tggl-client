export interface TgglContext {}

export interface TgglFlags {}

export type TgglFlagSlug<TFlags extends TgglFlags = TgglFlags> =
  keyof TFlags extends never ? string : keyof TFlags

export type TgglFlagValue<TSlug, TFlags extends TgglFlags = TgglFlags> =
  TSlug extends keyof TFlags ? TFlags[TSlug] : any
