// ProductType mappings verified against DeviceKit's device identifier catalog:
// https://github.com/devicekit/DeviceKit/blob/master/Source/Device.generated.swift
const iphoneModels: Record<string, string> = {
  'iPhone8,1': 'iPhone 6s',
  'iPhone8,2': 'iPhone 6s Plus',
  'iPhone8,4': 'iPhone SE (第 1 代)',
  'iPhone9,1': 'iPhone 7',
  'iPhone9,3': 'iPhone 7',
  'iPhone9,2': 'iPhone 7 Plus',
  'iPhone9,4': 'iPhone 7 Plus',
  'iPhone10,1': 'iPhone 8',
  'iPhone10,4': 'iPhone 8',
  'iPhone10,2': 'iPhone 8 Plus',
  'iPhone10,5': 'iPhone 8 Plus',
  'iPhone10,3': 'iPhone X',
  'iPhone10,6': 'iPhone X',
  'iPhone11,2': 'iPhone XS',
  'iPhone11,4': 'iPhone XS Max',
  'iPhone11,6': 'iPhone XS Max',
  'iPhone11,8': 'iPhone XR',
  'iPhone12,1': 'iPhone 11',
  'iPhone12,3': 'iPhone 11 Pro',
  'iPhone12,5': 'iPhone 11 Pro Max',
  'iPhone12,8': 'iPhone SE (第 2 代)',
  'iPhone13,1': 'iPhone 12 mini',
  'iPhone13,2': 'iPhone 12',
  'iPhone13,3': 'iPhone 12 Pro',
  'iPhone13,4': 'iPhone 12 Pro Max',
  'iPhone14,4': 'iPhone 13 mini',
  'iPhone14,5': 'iPhone 13',
  'iPhone14,2': 'iPhone 13 Pro',
  'iPhone14,3': 'iPhone 13 Pro Max',
  'iPhone14,6': 'iPhone SE (第 3 代)',
  'iPhone14,7': 'iPhone 14',
  'iPhone14,8': 'iPhone 14 Plus',
  'iPhone15,2': 'iPhone 14 Pro',
  'iPhone15,3': 'iPhone 14 Pro Max',
  'iPhone15,4': 'iPhone 15',
  'iPhone15,5': 'iPhone 15 Plus',
  'iPhone16,1': 'iPhone 15 Pro',
  'iPhone16,2': 'iPhone 15 Pro Max',
  'iPhone17,3': 'iPhone 16',
  'iPhone17,4': 'iPhone 16 Plus',
  'iPhone17,1': 'iPhone 16 Pro',
  'iPhone17,2': 'iPhone 16 Pro Max',
  'iPhone17,5': 'iPhone 16e',
  'iPhone18,3': 'iPhone 17',
  'iPhone18,1': 'iPhone 17 Pro',
  'iPhone18,2': 'iPhone 17 Pro Max',
  'iPhone18,4': 'iPhone Air',
};
export interface USBIdentity {
  id: string;
  name: string;
  productType: string;
}
interface CaptureIdentity {
  id: string;
  name: string;
  model: string;
}
const normalizedID = (id: string) =>
  id.replace(/[^a-z0-9]/gi, '').toLowerCase();
export function enrichUSBDevices<T extends CaptureIdentity>(
  captures: T[],
  identities: USBIdentity[],
): (T & { modelName?: string; productType?: string })[] {
  return captures.map((capture) => {
    const exact = identities.filter(
      (device) =>
        normalizedID(device.id).length >= 16 &&
        normalizedID(capture.id).includes(normalizedID(device.id)),
    );
    const sameName = identities.filter(
      (device) => device.name === capture.name,
    );
    const candidates =
      exact.length === 1
        ? exact
        : sameName.length
          ? sameName
          : captures.length === 1 && identities.length === 1
            ? identities
            : [];
    const models = new Set(candidates.map((device) => device.productType));
    if (models.size !== 1) return capture;
    const productType = candidates[0].productType;
    const trustedName =
      candidates.length === 1 ? candidates[0].name : capture.name;
    return {
      ...capture,
      name: trustedName,
      productType,
      modelName: iphoneModels[productType],
    };
  });
}
