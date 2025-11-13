export class EventEmitter {
  private _eventListeners = new Map<
    string,
    Map<number, (...args: any[]) => void>
  >();
  private _eventListenerId: number = 0;

  protected _registerEventListener(
    event: string,
    callback: (...args: any[]) => void
  ): () => void {
    const id = this._eventListenerId++;
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Map());
    }
    this._eventListeners.get(event)!.set(id, callback);
    return () => {
      this._eventListeners.get(event)!.delete(id);
    };
  }

  protected _emitEvent(event: string, ...args: any[]): void {
    for (const callback of this._eventListeners.get(event)?.values() ?? []) {
      try {
        Promise.resolve(callback(...args)).catch(() => null);
      } catch (error) {
        // Catch callback errors to prevent them from affecting other callbacks
      }
    }
  }
}
