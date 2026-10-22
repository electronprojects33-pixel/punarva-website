// Screen Wake Lock API Manager to prevent sleep/dimming during camera operation

export class WakeLockManager {
  private wakeLockSentinel: any = null;
  private isRequested: boolean = false;
  private onStatusChangeCallback: ((active: boolean) => void) | null = null;

  constructor() {
    // Re-acquire lock if tab becomes visible again
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.isRequested) {
          this.requestLock();
        }
      });
    }
  }

  public onStatusChange(cb: (active: boolean) => void) {
    this.onStatusChangeCallback = cb;
  }

  public async requestLock(): Promise<boolean> {
    this.isRequested = true;
    if ('wakeLock' in navigator) {
      try {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        this.wakeLockSentinel.addEventListener('release', () => {
          this.wakeLockSentinel = null;
          this.notify(false);
        });
        this.notify(true);
        return true;
      } catch (err) {
        console.warn('Wake Lock request rejected:', err);
        this.notify(false);
        return false;
      }
    } else {
      console.info('Screen Wake Lock API not supported on this platform');
      this.notify(false);
      return false;
    }
  }

  public async releaseLock() {
    this.isRequested = false;
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch (err) {
        console.warn('Error releasing wake lock:', err);
      }
      this.wakeLockSentinel = null;
      this.notify(false);
    }
  }

  public isActive(): boolean {
    return this.wakeLockSentinel !== null && !this.wakeLockSentinel.released;
  }

  private notify(active: boolean) {
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback(active);
    }
  }
}

export const wakeLockManager = new WakeLockManager();
