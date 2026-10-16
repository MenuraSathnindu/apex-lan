import { connect } from './net/socket.ts';
import { createScene } from './render/scene.ts';
import { createNetStatus, type ConnState } from './ui/netStatus.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const status = createNetStatus(document.querySelector<HTMLElement>('#net-status')!);
const view = createScene(canvas);

let connState: ConnState = 'connecting';
let playerCount = 0;
let rttMs: number | null = null;
const refreshStatus = () => status.update(connState, playerCount, rttMs);

connect({
  onOpen() {
    connState = 'connected';
    refreshStatus();
  },
  onClose() {
    connState = 'disconnected';
    rttMs = null;
    refreshStatus();
  },
  onMessage(msg) {
    switch (msg.t) {
      case 'welcome':
        playerCount = msg.playerCount;
        break;
      case 'playerCount':
        playerCount = msg.count;
        break;
      case 'pong':
        rttMs = performance.now() - msg.clientTime;
        break;
      case 'full':
        console.warn('server is full');
        break;
    }
    refreshStatus();
  },
});

let last = performance.now();
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  view.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
