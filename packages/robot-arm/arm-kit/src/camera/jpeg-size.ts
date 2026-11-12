import { RobotArmError } from '../contracts.js';

/** Parse the actual JPEG SOF dimensions, rather than trusting requested dimensions. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new RobotArmError('VISION_IMAGE_INVALID', 'Expected JPEG');
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff)
      throw new RobotArmError('VISION_IMAGE_INVALID', 'Malformed JPEG marker');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const size = (bytes[offset] << 8) | bytes[offset + 1];
    if (size < 2 || offset + size > bytes.length)
      throw new RobotArmError('VISION_IMAGE_INVALID', 'Truncated JPEG');
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    ) {
      if (size < 8) break;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width && height) return { width, height };
      break;
    }
    offset += size;
  }
  throw new RobotArmError(
    'VISION_IMAGE_INVALID',
    'JPEG dimensions unavailable',
  );
}
