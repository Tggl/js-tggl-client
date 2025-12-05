import type { TgglStorage } from './types';
import { TgglClientStateSerializer } from './serializers.js';

export class TgglClientStaticStorage implements TgglStorage {
  private data: string;

  constructor(flags: Record<string, unknown>) {
    this.data = TgglClientStateSerializer.serialize({
      flags: flags,
      date: Date.now(),
    });
  }

  get(): string {
    return this.data;
  }

  set(): void {}
}
