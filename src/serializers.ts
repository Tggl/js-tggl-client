import { TgglConfig, TgglFlags, TgglFlagSlug } from './types.ts';

type TgglClientState<TFlags extends TgglFlags = TgglFlags> = {
  flags: Partial<TFlags>;
  date: number;
};

export const TgglClientStateSerializer = {
  serialize(state: TgglClientState): string {
    return JSON.stringify({ type: 'TgglClientState', ...state });
  },
  deserialize<TFlags extends TgglFlags = TgglFlags>(
    str: string
  ): TgglClientState<TFlags> | null {
    let obj: any;
    try {
      obj = JSON.parse(str ?? '');
    } catch {
      return null;
    }

    if (
      !obj ||
      typeof obj !== 'object' ||
      Array.isArray(obj) ||
      obj.type !== 'TgglClientState'
    ) {
      return null;
    }

    return {
      flags: obj.flags ?? {},
      date: obj.date ?? 0,
    };
  },
};

type TgglLocalClientState<TFlags extends TgglFlags = TgglFlags> = {
  config: TgglConfig<TFlags>;
  date: number;
};

export const TgglLocalClientStateSerializer = {
  serialize<TFlags extends TgglFlags = TgglFlags>(
    state: TgglLocalClientState<TFlags>
  ): string {
    const config: Record<string, any> = {};
    for (const [key, value] of state.config.entries()) {
      config[key as string] = value;
    }
    return JSON.stringify({
      type: 'TgglLocalClientState',
      date: state.date,
      config,
    });
  },
  deserialize<TFlags extends TgglFlags = TgglFlags>(
    str: string
  ): TgglLocalClientState<TFlags> | null {
    let obj: any;
    try {
      obj = JSON.parse(str ?? '');
    } catch {
      return null;
    }

    if (
      !obj ||
      typeof obj !== 'object' ||
      Array.isArray(obj) ||
      obj.type !== 'TgglLocalClientState'
    ) {
      return null;
    }

    const config: TgglConfig<TFlags> = new Map();

    for (const key in obj.config ?? {}) {
      config.set(key as TgglFlagSlug<TFlags>, obj.config[key]);
    }

    return {
      config,
      date: obj.date ?? 0,
    };
  },
};
