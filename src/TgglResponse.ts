import { TgglFlags, TgglFlagSlug, TgglFlagValue } from './types'
import { TgglReporting } from './TgglReporting'

export class TgglResponse<TFlags extends TgglFlags = TgglFlags> {
  protected reporting: TgglReporting | null

  constructor(
    protected flags: Partial<TFlags> = {},
    options: {
      reporting?: TgglReporting | null
    } = {}
  ) {
    this.reporting = options.reporting ?? null
  }

  disableReporting() {
    this.reporting?.disable()
    this.reporting = null
  }

  detachReporting() {
    const reporting = this.reporting
    this.reporting = null
    return reporting
  }

  isActive(slug: TgglFlagSlug<TFlags>): boolean {
    const active = this.flags[slug as keyof TFlags] !== undefined

    this.reporting?.reportFlag(String(slug), {
      active,
      value: this.flags[slug as keyof TFlags],
    })

    return active
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
    const value =
      this.flags[slug as keyof TFlags] === undefined
        ? defaultValue
        : this.flags[slug as keyof TFlags]

    this.reporting?.reportFlag(String(slug), {
      active: value !== undefined,
      default: defaultValue,
      value,
    })

    // @ts-ignore
    return value
  }

  getActiveFlags() {
    return this.flags
  }
}
