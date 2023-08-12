import { TgglFlags, TgglFlagSlug, TgglFlagValue } from './types'

export class TgglResponse<TFlags extends TgglFlags = TgglFlags> {
  constructor(protected flags: Partial<TFlags> = {}) {}

  isActive(slug: TgglFlagSlug<TFlags>): boolean {
    return this.flags[slug as keyof TFlags] !== undefined
  }

  get<TSlug extends TgglFlagSlug<TFlags>>(
    slug: TSlug
  ): TgglFlagValue<TSlug, TFlags> | undefined
  get<
    TSlug extends TgglFlagSlug<TFlags>,
    TDefaultValue = TgglFlagValue<TSlug, TFlags>
  >(
    slug: TSlug,
    defaultValue: TDefaultValue
  ): TgglFlagValue<TSlug, TFlags> | TDefaultValue
  get<TSlug extends keyof TFlags, TDefaultValue = TgglFlagValue<TSlug, TFlags>>(
    slug: TSlug,
    defaultValue?: TDefaultValue
  ): TgglFlagValue<TSlug, TFlags> | TDefaultValue | undefined {
    // @ts-ignore
    return this.flags[slug as keyof TFlags] === undefined
      ? defaultValue
      : this.flags[slug as keyof TFlags]
  }

  getActiveFlags() {
    return this.flags
  }
}
