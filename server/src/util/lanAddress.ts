import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

export interface LanAddress {
  address: string;
  iface: string;
  /** Likely a VPN / VM / container adapter rather than the real network. */
  virtual: boolean;
}

const VIRTUAL_IFACE = /vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|warp|tailscale|zerotier|vpn|tun|tap|utun|br-|veth/i;
const WIFI_IFACE = /wi-?fi|wlan|wireless|^wl/i;

/** Every non-internal IPv4 address: Wi-Fi first, then other real adapters (Ethernet), then VPN/VM ones. */
export function lanAddresses(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [iface, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // 169.254.x.x is link-local (adapter with no network) — nobody can join through it.
      if (a.address.startsWith('169.254.')) continue;
      out.push({ address: a.address, iface, virtual: VIRTUAL_IFACE.test(iface) });
    }
  }
  const rank = (a: LanAddress) => (a.virtual ? 2 : WIFI_IFACE.test(a.iface) ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}
