import { TgglConfig, TgglStorage } from './types';
import { TgglLocalClientStateSerializer } from './serializers.js';

export class TgglLocalClientStaticStorage implements TgglStorage {
  private data: string;

  constructor(config: TgglConfig) {
    this.data = TgglLocalClientStateSerializer.serialize({
      config: config,
      date: Date.now(),
    });
  }

  get(): string {
    return this.data;
  }

  set(): void {}
}
