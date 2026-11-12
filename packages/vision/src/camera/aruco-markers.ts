import aruco from 'js-aruco2';
import sharp from 'sharp';

const dictionaryName = 'ARUCO_MIP_36h12';
const dictionary = new aruco.AR.Dictionary(dictionaryName);

export const markerSvg = (id: number) => dictionary.generateSVG(id);

export async function decodeArucoMarkers(jpeg: Buffer, enhanced = false) {
  const image = sharp(jpeg, { limitInputPixels: 16_777_216 }).toColourspace(
    'srgb',
  );
  if (enhanced) image.normalise().sharpen();
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const detector = new aruco.AR.Detector({
    dictionaryName,
    maxHammingDistance: 5,
  });
  return detector.detect({ data, width: info.width, height: info.height });
}
