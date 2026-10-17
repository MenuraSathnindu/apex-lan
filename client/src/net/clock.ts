const SAMPLES = 9;

/**
 * Estimates the server's clock from ping/pong. Each pong gives
 * offset = serverTime − (sendTime + rtt/2); we keep the samples with the lowest RTT
 * (least queueing noise) and use their median.
 */
export class ServerClock {
  private samples: { offset: number; rtt: number }[] = [];
  private offset = 0;
  rttMs: number | null = null;

  get synced(): boolean {
    return this.samples.length > 0;
  }

  onPong(clientSendTime: number, serverTime: number, clientRecvTime: number = performance.now()): void {
    const rtt = clientRecvTime - clientSendTime;
    this.rttMs = rtt;
    this.samples.push({ offset: serverTime - (clientSendTime + rtt / 2), rtt });
    if (this.samples.length > SAMPLES * 2) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, SAMPLES);
    const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
    this.offset = offsets[Math.floor(offsets.length / 2)]!;
  }

  /** Current server time in ms. */
  now(clientTime: number = performance.now()): number {
    return clientTime + this.offset;
  }

  reset(): void {
    this.samples = [];
    this.rttMs = null;
  }
}
