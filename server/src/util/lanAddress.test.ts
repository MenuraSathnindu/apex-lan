import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { lanAddresses } from './lanAddress.ts';

const v4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal }) as NetworkInterfaceInfo;

describe('lanAddresses', () => {
  it('lists Wi-Fi first, then Ethernet, then VPN/VM adapters, skipping loopback and link-local', () => {
    const list = lanAddresses({
      'vEthernet (WSL)': [v4('172.20.0.1')],
      'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
      Ethernet: [v4('10.0.0.5')],
      'Ethernet 2': [v4('169.254.3.4')],
      'Wi-Fi': [v4('192.168.1.10'), { address: 'fe80::1', family: 'IPv6', internal: false } as NetworkInterfaceInfo],
      CloudflareWARP: [v4('172.16.0.2')],
    });
    expect(list.map((a) => a.address)).toEqual(['192.168.1.10', '10.0.0.5', '172.20.0.1', '172.16.0.2']);
    expect(list.map((a) => a.virtual)).toEqual([false, false, true, true]);
  });
});
