import { describe, expect, it } from '@rstest/core';
import {
  applyHomography,
  solveHomography,
} from '../src/calibration/plane-homography.js';

describe('plane homography', () => {
  it('maps the four perspective corners onto the calibrated bench corners', () => {
    const pairs = [
      { source: { x: 0, y: 0 }, target: { x: 100, y: 50 } },
      { source: { x: 100, y: 0 }, target: { x: 300, y: 60 } },
      { source: { x: 100, y: 200 }, target: { x: 310, y: 260 } },
      { source: { x: 0, y: 200 }, target: { x: 110, y: 250 } },
    ];
    const homography = solveHomography(pairs);
    expect(homography).toBeDefined();
    for (const pair of pairs) {
      const mapped = applyHomography(homography!, pair.source);
      expect(mapped?.x).toBeCloseTo(pair.target.x, 6);
      expect(mapped?.y).toBeCloseTo(pair.target.y, 6);
    }
    // The centre lies inside the mapped quad.
    const centre = applyHomography(homography!, { x: 50, y: 100 });
    expect(centre?.x).toBeGreaterThan(150);
    expect(centre?.x).toBeLessThan(260);
  });

  it('needs at least four correspondences', () => {
    expect(
      solveHomography([
        { source: { x: 0, y: 0 }, target: { x: 0, y: 0 } },
        { source: { x: 10, y: 0 }, target: { x: 10, y: 0 } },
      ]),
    ).toBeUndefined();
  });
});
