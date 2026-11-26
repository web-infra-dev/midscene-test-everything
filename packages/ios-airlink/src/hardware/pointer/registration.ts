import type * as OpenCV from '@techstark/opencv-js';

// Allow small camera jitter, measured at the detector's resized resolution.
export const maxTranslation = 6;
export const registrationMargin = maxTranslation + 1;

let openCV: Promise<typeof OpenCV> | undefined;

export async function alignPointerFrame(
  before: Uint8Array,
  after: Uint8Array,
  width: number,
  height: number,
) {
  openCV ??= import('@techstark/opencv-js').then(
    (module) => module.default as unknown as typeof OpenCV,
  );
  const cv = await openCV;
  const reference = new cv.Mat(height, width, cv.CV_8UC1);
  const current = new cv.Mat(height, width, cv.CV_8UC1);
  const smallRef = new cv.Mat();
  const smallCur = new cv.Mat();
  const transform = cv.Mat.eye(2, 3, cv.CV_32F);
  const mask = new cv.Mat();
  const aligned = new cv.Mat();
  try {
    reference.data.set(before);
    current.data.set(after);
    // Estimate translation on a coarse pyramid level to avoid blocking WASM on full frames.
    const ratio = Math.min(1, 240 / Math.max(width, height));
    const useCoarse = ratio < 0.85 && Math.min(width, height) * ratio >= 48;
    if (useCoarse) {
      const sw = Math.round(width * ratio);
      const sh = Math.round(height * ratio);
      cv.resize(reference, smallRef, new cv.Size(sw, sh), 0, 0, cv.INTER_AREA);
      cv.resize(current, smallCur, new cv.Size(sw, sh), 0, 0, cv.INTER_AREA);
    }
    let correlation: number;
    try {
      correlation = cv.findTransformECC(
        useCoarse ? smallRef : reference,
        useCoarse ? smallCur : current,
        transform,
        cv.MOTION_TRANSLATION,
        new cv.TermCriteria(
          cv.TermCriteria_COUNT | cv.TermCriteria_EPS,
          20,
          1e-4,
        ),
        mask,
        5,
      );
    } catch {
      // ECC can fail to converge on flat screens or unrelated frames.
      return;
    }
    if (useCoarse) {
      transform.data32F[2] /= ratio;
      transform.data32F[5] /= ratio;
    }
    const dx = transform.data32F[2];
    const dy = transform.data32F[5];
    const shift = Math.hypot(dx, dy);
    if (!(correlation >= 0.9 && shift >= 0.5 && shift <= maxTranslation))
      return;
    cv.warpAffine(
      current,
      aligned,
      transform,
      new cv.Size(width, height),
      cv.INTER_LINEAR | cv.WARP_INVERSE_MAP,
      cv.BORDER_REPLICATE,
    );
    return aligned.data.slice();
  } finally {
    aligned.delete();
    mask.delete();
    transform.delete();
    smallCur.delete();
    smallRef.delete();
    current.delete();
    reference.delete();
  }
}
