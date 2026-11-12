import { expect, it } from '@rstest/core';
import {
  type CalibrationPageUpdate,
  calibrationPageMarkers,
} from '../src/assisted-contracts.js';
import { CalibrationPhoneSession } from '../src/calibration/phone/session.js';
it('keeps diagnostic history separate from contacts and rejects unbounded input', () => {
  const phone = new CalibrationPhoneSession();
  const update: CalibrationPageUpdate = {
    pageId: phone.openPage(),
    sequence: 1,
    visible: true,
    layout: {
      revision: 1,
      width: 400,
      height: 800,
      screen: { width: 400, height: 800, devicePixelRatio: 1 },
      markers: calibrationPageMarkers(400, 800),
    },
    touchEvents: [
      {
        sequence: 1,
        elapsedMs: 20,
        kind: 'touchstart',
        source: 'document',
        targetElement: 'MAIN#surface',
        defaultPrevented: false,
        defaultPreventedAfterDispatch: true,
        point: { x: 1, y: 2 },
      },
    ],
  };
  phone.receive(update, 100);
  expect(phone.update?.touchEvents).toEqual(update.touchEvents);
  expect(phone.update?.contact).toBeUndefined();
  expect(phone.lastSeen).toBe(100);
  expect(() =>
    phone.receive({
      ...update,
      sequence: 2,
      touchEvents: Array(41).fill(update.touchEvents![0]),
    }),
  ).toThrow('Invalid touch diagnostics');
  expect(phone.update?.sequence).toBe(1);
  expect(() =>
    phone.receive({
      ...update,
      sequence: 2,
      touchEvents: [
        {
          ...update.touchEvents![0],
          defaultPrevented: 'yes' as unknown as boolean,
        },
      ],
    }),
  ).toThrow('Invalid touch diagnostics');
});
