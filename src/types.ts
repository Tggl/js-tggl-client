import { Flag } from 'tggl-core';

export interface TgglContext {}

export interface TgglFlags {}

export interface TgglStorage {
  get(): string | null | Promise<string | null>;
  set(value: string): void | Promise<void>;
  close?(): void | Promise<void>;
}

export type TgglFlagSlug<TFlags extends TgglFlags = TgglFlags> =
  keyof TFlags extends never ? string : keyof TFlags;

export type TgglFlagValue<
  TSlug,
  TFlags extends TgglFlags = TgglFlags,
> = TSlug extends keyof TFlags ? TFlags[TSlug] : any;

export type TgglConfig<TFlags extends TgglFlags = TgglFlags> = Map<
  TgglFlagSlug<TFlags>,
  Flag
>;
