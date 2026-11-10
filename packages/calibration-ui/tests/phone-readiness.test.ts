import type { ScreenDeviceSummary } from '@midscene/arm-kit-shared/marker-contracts';
import { expect, it } from '@rstest/core';
import { deriveCameraPhoneReadiness } from '../src/hooks/useCameraPhoneReadiness';
const page = (
  id: string,
  screenId?: string,
  cameraId: string | undefined = 'cam',
): ScreenDeviceSummary => ({
  id,
  label: id,
  pageKey: `page-${id}`,
  cameraId,
  screenId,
  mode: 'mapping',
  language: 'zh',
  width: 400,
  height: 800,
  visible: true,
  fullscreen: true,
});
const cameras = [
  {
    id: 'cam',
    online: true,
    screenBindings: [
      { id: 'left', pageKey: 'page-left-phone' },
      { id: 'right', pageKey: 'page-right-phone' },
    ],
  },
];
const readiness = (devices: ScreenDeviceSummary[]) =>
  deriveCameraPhoneReadiness({
    cameras,
    cameraId: 'cam',
    resolved: true,
    connection: { devices, addresses: [], publicUrl: 'http://localhost' },
  });
it('requires each saved screen instead of counting a full-screen page for another target on the same camera', () => {
  const left = page('left-phone', 'left');
  const unrelated = page('other-phone', 'unconfigured-target');
  expect(readiness([left, unrelated]).ready).toBe(false);
  expect(readiness([left, page('right-phone', 'right')]).ready).toBe(true);
  expect(
    readiness([left, { ...page('right-phone', 'right'), visible: false }])
      .ready,
  ).toBe(false);
});
it('restores identities by saved page key without accepting another camera or overriding an explicit different target', () => {
  const left = page('left-phone', 'left');
  const restored = page('right-phone', undefined);
  restored.cameraId = undefined;
  expect(readiness([left, restored]).ready).toBe(true);
  expect(
    readiness([left, { ...restored, cameraId: 'another-camera' }]).ready,
  ).toBe(false);
  expect(
    readiness([left, { ...restored, screenId: 'another-target' }]).ready,
  ).toBe(false);
});

it('two phones claiming the left screen cannot make the missing right screen ready', () => {
  expect(readiness([page('one', 'left'), page('two', 'left')]).ready).toBe(
    false,
  );
});
