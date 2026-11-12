import type { NetworkInterfaceInfo } from 'node:os';
import { expect, it } from '@rstest/core';
import {
  phoneAddresses,
  wifiHardwarePorts,
} from '../src/network/phone-addresses.js';
const ipv4 = (address: string, netmask = '255.255.255.0') =>
  ({
    address,
    netmask,
    family: 'IPv4',
    internal: false,
    mac: '00:00:00:00:00:00',
    cidr: `${address}/24`,
  }) as NetworkInterfaceInfo;
it('selects the phone Wi-Fi despite Ethernet enumeration order and a VPN default route', () => {
  expect(
    phoneAddresses({
      interfaces: {
        en13: [ipv4('192.168.2.2', '255.255.255.255')],
        utun8: [ipv4('198.18.0.1')],
        en0: [ipv4('192.168.1.50')],
      },
      wifiInterfaces: ['en0'],
      controllerHost: '192.168.2.6',
    }),
  ).toEqual([{ address: '192.168.1.50', name: 'Wi-Fi' }]);
});
it('reads Wi-Fi identities without assuming an enX number', () => {
  expect(
    wifiHardwarePorts(
      'Hardware Port: USB LAN\nDevice: en0\n\nHardware Port: Wi-Fi\nDevice: en7\nEthernet Address: aa:bb:cc:dd:ee:ff\n',
    ),
  ).toEqual(['en7']);
  expect(
    phoneAddresses({
      interfaces: { en0: [ipv4('192.168.2.2')], en7: [ipv4('192.168.1.50')] },
      wifiInterfaces: ['en7'],
    }).map((entry) => entry.address),
  ).toEqual(['192.168.1.50']);
});
it('excludes controller aliases, link-local, virtual and loopback addresses from the automatic fallback', () => {
  expect(
    phoneAddresses({
      interfaces: {
        en13: [ipv4('192.168.2.2', '255.255.255.255'), ipv4('169.254.1.2')],
        lo0: [{ ...ipv4('127.0.0.1'), internal: true }],
        bridge0: [ipv4('192.168.64.1')],
        en4: [ipv4('10.0.0.5')],
      },
      controllerHost: '192.168.2.6',
    }),
  ).toEqual([{ address: '10.0.0.5', name: 'en4' }]);
});
it('does not fall back to the robot cable when it is the only usable interface', () => {
  expect(
    phoneAddresses({
      interfaces: { en13: [ipv4('192.168.2.2')] },
      controllerHost: '192.168.2.6',
    }),
  ).toEqual([]);
});
it('recognizes named wireless interfaces on Linux and Windows and observes address changes', () => {
  for (const name of ['wlan0', 'wlp2s0', 'Wi-Fi', 'WLAN', '无线网络连接'])
    expect(
      phoneAddresses({
        interfaces: {
          Ethernet: [ipv4('192.168.2.2')],
          [name]: [ipv4('192.168.1.45')],
        },
      }).map((entry) => entry.address),
    ).toEqual(['192.168.1.45']);
});
