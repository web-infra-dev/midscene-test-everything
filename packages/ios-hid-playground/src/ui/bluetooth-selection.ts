export type BluetoothChoice = {
  id: string;
  name: string;
  address?: string;
};

/** Keep the intended phone across SSE snapshots and temporary disconnects. */
export function resolveBluetoothSelection(
  preferred: string | undefined,
  hosts: BluetoothChoice[],
  reserved: string[],
): string | undefined {
  const available = hosts.filter((host) => !reserved.includes(host.id));
  if (preferred)
    return available.some((host) => host.id === preferred)
      ? preferred
      : undefined;
  return available.length === 1 ? available[0].id : undefined;
}

export function bluetoothLabel(
  peer: BluetoothChoice,
  hosts: BluetoothChoice[],
) {
  if (hosts.filter((host) => host.name === peer.name).length < 2)
    return peer.name;
  return `${peer.name} · ${peer.address?.slice(-5) || peer.id.slice(0, 8)}`;
}
