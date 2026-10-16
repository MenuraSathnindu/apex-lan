import { networkInterfaces } from 'node:os';

export interface LanAddress {
  address: string;
  iface: string;
  /** Likely a VPN / VM / container adapter rather than the real network. */
  virtual: boolean;
}

const VIRTUAL_IFACE = /vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|warp|tailscale|zerotier|vpn|tun|tap|utun|br-|veth/i;

/** Every non-internal IPv4 address, real adapters (Wi-Fi/Ethernet) first. */
export function lanAddresses(): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // 169.254.x.x is link-local (adapter with no network) — nobody can join through it.
      if (a.address.startsWith('169.254.')) continue;
      out.push({ address: a.address, iface, virtual: VIRTUAL_IFACE.test(iface) });
    }
  }
  return out.sort((a, b) => Number(a.virtual) - Number(b.virtual));
}
