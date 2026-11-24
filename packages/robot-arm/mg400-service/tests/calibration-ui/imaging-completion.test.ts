import { describe, expect, it, rstest } from '@rstest/core';
import {
  finishCameraImagingForScreen,
  screenImagingSwitchError,
  shouldSwitchScreenImaging,
} from '../../src/ui/calibration/imaging-completion';

describe('camera imaging completion', () => {
  it('does not compete with camera mapping or active calibration', () => {
    const idle = {
      step: 2,
      hasCorrection: true,
      batchActive: false,
      singleBusy: false,
      controllerBusy: false,
      markerOpen: false,
      perspectiveEditor: false,
    };
    expect(shouldSwitchScreenImaging(idle)).toBe(true);
    expect(shouldSwitchScreenImaging({ ...idle, step: 1 })).toBe(false);
    expect(shouldSwitchScreenImaging({ ...idle, markerOpen: true })).toBe(
      false,
    );
    expect(shouldSwitchScreenImaging({ ...idle, controllerBusy: true })).toBe(
      false,
    );
  });

  it('reports only activation results that did not apply the selected screen', () => {
    expect(
      screenImagingSwitchError(
        { state: 'ready', screenId: 'pja', active: true },
        'pja',
      ),
    ).toBeUndefined();
    expect(
      screenImagingSwitchError({ state: 'unsupported' }, 'pja'),
    ).toBeUndefined();
    expect(
      screenImagingSwitchError(
        { state: 'unconfigured', screenId: 'pja', message: 'Calibrate it' },
        'pja',
      ),
    ).toBe('Calibrate it');
    expect(
      screenImagingSwitchError(
        { state: 'ready', screenId: 'other', active: true },
        'pja',
      ),
    ).toContain('pja');
  });

  it('activates the currently selected screen after calibration becomes ready', async () => {
    const activate = rstest.fn().mockResolvedValue({
      state: 'ready',
      screenId: 'pja',
      active: true,
    });
    let loads = 0;

    await finishCameraImagingForScreen({
      screenId: 'pja',
      load: async () => {
        loads += 1;
        return {
          imaging:
            loads === 1
              ? { state: 'released', screenId: 'pja' }
              : loads === 2
                ? { state: 'exposure', screenId: 'pja' }
                : { state: 'ready', screenId: 'pja' },
        };
      },
      activate,
      sleep: async () => {},
    });

    expect(loads).toBe(3);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('does not activate imaging when the camera control is unsupported', async () => {
    const activate = rstest.fn();

    await finishCameraImagingForScreen({
      screenId: 'pja',
      load: async () => ({
        imaging: {
          state: 'unsupported',
          message: 'Camera controls are unavailable',
        },
      }),
      activate,
      sleep: async () => {},
    });

    expect(activate).not.toHaveBeenCalled();
  });

  it('reports a selected screen whose stored imaging profile cannot be applied', async () => {
    await expect(
      finishCameraImagingForScreen({
        screenId: 'pja',
        load: async () => ({
          imaging: { state: 'ready', screenId: 'pja' },
        }),
        activate: async () => ({
          state: 'unconfigured',
          screenId: 'pja',
          active: false,
          message: 'Recalibrate this screen',
        }),
        sleep: async () => {},
      }),
    ).rejects.toThrow('Recalibrate this screen');
  });

  it('rejects an activation that applied a different screen profile', async () => {
    await expect(
      finishCameraImagingForScreen({
        screenId: 'pja',
        load: async () => ({
          imaging: { state: 'ready', screenId: 'pja' },
        }),
        activate: async () => ({
          state: 'ready',
          screenId: 'screen',
          active: true,
        }),
        sleep: async () => {},
      }),
    ).rejects.toThrow('pja');
  });
});
