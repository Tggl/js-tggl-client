import { TgglStorage } from './types.ts';

const hasLocalStorage = Boolean(
  // @ts-ignore
  typeof window !== 'undefined' && window.localStorage
);

export const localStorageStorage: TgglStorage = {
  get(): string | null {
    if (hasLocalStorage) {
      // @ts-ignore
      return window.localStorage.getItem('tggl-flags') as string;
    }

    return null;
  },
  set(value: string) {
    if (hasLocalStorage) {
      // @ts-ignore
      window.localStorage.setItem('tggl-flags', value);
    }
  },
};
