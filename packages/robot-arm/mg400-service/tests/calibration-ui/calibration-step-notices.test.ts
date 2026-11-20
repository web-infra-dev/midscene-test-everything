import { expect, it } from '@rstest/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CalibrationClient,
  CalibrationRequestError,
} from '../../src/ui/calibration/client';
import { WebCalibrationWorkspace } from '../../src/ui/calibration/components/robot-arm/WebCalibrationWorkspace';
import type { AssistedCalibrationController } from '../../src/ui/calibration/hooks/useAssistedCalibration';
import type { CalibrationProfile } from '../../src/ui/calibration/robot-arm-api';

const markerError =
  'Calibration marker 12 could not be decoded uniquely (2 matches). Keep all calibration markers visible and in focus.';
const controller = (connected = true) =>
  ({
    setup: { prepared: true, phoneConnected: connected },
    phone: {
      state: connected ? 'connected' : 'waiting',
      links: [],
      model: 'iPhone',
    },
    session: null,
    busy: false,
    error: markerError,
  }) as unknown as AssistedCalibrationController;

it('offers automatic collection before recording the safe position', () => {
  const value = controller();
  value.session = {
    id: 'retry',
    stage: 'ready',
    teachingId: 'saved',
    phoneConnected: true,
    referencePosition: {
      frame: 'base',
      positionMm: { x: 0, y: 0, z: 50 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    points: [],
    verification: [],
    samples: 0,
  } as unknown as NonNullable<AssistedCalibrationController['session']>;
  const html = renderToStaticMarkup(
    createElement(WebCalibrationWorkspace, {
      controller: value,
      footer: null,
      readyToStart: true,
      readyToCapture: true,
      readyToVerify: true,
      onActivated: async () => {},
      onBeforeLeaveChange: () => {},
      onCheckCamera: () => {},
    }),
  );
  expect(html).toContain('普通');
  const radios = html.match(/<input[^>]+>/g) ?? [];
  expect(
    radios
      .filter((input) => input.includes('type="radio"'))
      .map((input) => /value="(.*?)"/.exec(input)?.[1]),
  ).toEqual(['slide', 'standard']);
  expect(radios.find((input) => input.includes('value="slide"'))).toContain(
    'checked=""',
  );
  expect(
    radios.filter((input) => input.includes('type="checkbox"')),
  ).toHaveLength(1);
  expect(html).toContain('屏幕水平固定、触控笔尖有弹性缓冲且工作区净空');
  expect(html).toContain('自动执行悬停与接触边界验证');
  expect(html).not.toContain('Record Safe Position');
  expect(html).not.toContain('15 点');
});

it('only offers Finish for the current completed attempt even with an accepted profile on disk', () => {
  const result = {
    geometryStatus: 'valid',
    acceptanceStatus: 'accepted',
    observationPose: { positionMm: { x: 0, y: 0, z: 40 } },
    verification: {
      protocol: 'auto-boundary-v1',
      confirmedAt: '2026-01-01T00:00:00Z',
      boundary: {
        hoverCorners: true,
        hoverEdges: true,
        contactCorners: true,
        contactEdges: true,
      },
      auto: { humanAccepted: true, samples: [] },
    },
  } as CalibrationProfile;
  const value = controller();
  const render = (completedAttempt: boolean) =>
    renderToStaticMarkup(
      createElement(WebCalibrationWorkspace, {
        controller: value,
        footer: null,
        result,
        completedAttempt,
        completionLabel: 'Finish Calibration',
        onActivated: async () => {},
      }),
    );
  expect(render(false)).toContain('开始自动标定');
  expect(render(false)).not.toContain('完成标定');
  expect(render(true)).toContain('完成标定');
  value.session = {
    id: 'saving',
    stage: 'review',
    phoneConnected: false,
    samples: 6,
    points: [],
    anchors: [],
    verification: [],
  };
  expect(render(true)).toContain('完成标定');
  expect(render(true)).not.toContain('type="checkbox"');
});

it('keeps cancellation available during a pending boundary check and shows recovery at the interrupted step', () => {
  const value = controller();
  value.error = undefined;
  value.busy = true;
  value.session = {
    id: 'pending',
    stage: 'safety',
    phoneConnected: true,
    samples: 6,
    points: [],
    anchors: [],
    verification: [],
    capture: {
      index: 6,
      total: 6,
      phase: 'captured',
      readings: 1,
      progress: 1,
      target: { id: 'last', point: { x: 0, y: 0 } },
    },
  };
  const render = () =>
    renderToStaticMarkup(
      createElement(WebCalibrationWorkspace, {
        controller: value,
        controls: createElement(
          'button',
          { type: 'button' },
          'Recover controller',
        ),
        footer: null,
        onActivated: async () => {},
      }),
    );
  const pending = render();
  const cancel = pending.match(
    /<button[^>]*robot-cancel-calibration[^>]*>/,
  )?.[0];
  expect(cancel).toBeDefined();
  expect(cancel).not.toContain('disabled');
  expect(pending).not.toContain('robot-exploration-progress');
  value.busy = false;
  value.session.stage = 'interrupted';
  value.session.interruptedFrom = 'safety';
  const stopped = render();
  expect(stopped).toContain('Recover controller');
  expect(stopped).toMatch(/class="current"[^>]*>[^<]*边界验证/);
  expect(stopped).not.toContain('robot-exploration-progress');
  value.session.interruptedFrom = 'collecting';
  value.session.collectionFailed = true;
  expect(render()).toContain('robot-exploration-progress');
});

it('shows the percent, raw holdout and continuation action for a reviewable fit', () => {
  const value = controller();
  value.session = {
    id: 'review-fit',
    stage: 'boundary-review',
    phoneConnected: true,
    points: [],
    verification: [],
    samples: 9,
    anchors: [],
    explorationQuality: {
      gridRmsMm: 0.2,
      holdoutMaxMm: 3,
      shortSideMm: 100,
      coverage: 0.64,
      warnings: [{ label: 'Holdout maximum', percent: 3, targetPercent: 2 }],
    },
  };
  const html = renderToStaticMarkup(
    createElement(WebCalibrationWorkspace, {
      controller: value,
      footer: null,
      onActivated: async () => {},
    }),
  );
  expect(html).toContain('3.00 mm');
  expect(html).toContain('3.00%');
  expect(html).toContain('建议 ≤2%');
  expect(html).toContain('10% 的相对容差');
  expect(html).toContain('继续边界验证');
});

it.each([true, false])(
  'opens sampling preparation after teaching (selected screen has a start: %s)',
  (hasReference) => {
    const value = controller();
    value.session = {
      id: 'current-screen',
      stage: 'ready',
      teachingId: 'shared-installation',
      referencePosition: hasReference
        ? {
            frame: 'base',
            positionMm: { x: 1, y: 2, z: 50 },
            orientation: { x: 0, y: 0, z: 0, w: 1 },
          }
        : undefined,
      phoneConnected: true,
      points: [],
      verification: [],
      samples: 0,
    } as NonNullable<AssistedCalibrationController['session']>;
    const html = renderToStaticMarkup(
      createElement(WebCalibrationWorkspace, {
        controller: value,
        prepareFromTeaching: true,
        screenName: 'iPhone',
        footer: null,
        onActivated: async () => {},
      }),
    );
    expect(html).not.toContain('设置标定参考位');
    expect(html).not.toContain('上一步');
    expect(html).toContain('1 采集标定点');
    if (hasReference) {
      expect(html).toContain('普通');
      expect(html).not.toContain('记录这块屏幕的采样起点');
    } else {
      expect(html).toContain('「iPhone」中心上方');
      expect(html).toContain('进入拖动模式');
      expect(html).not.toContain('开始自动标定');
    }
  },
);

it('explains the phone requirement without blocking reference-position recording', () => {
  const value = controller(false);
  value.session = {
    id: 'offline',
    stage: 'ready',
    phoneConnected: false,
    safePosition: {
      frame: 'base',
      positionMm: { x: 0, y: 0, z: 50 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    points: [],
    verification: [],
    samples: 0,
  } as unknown as NonNullable<AssistedCalibrationController['session']>;
  const html = renderToStaticMarkup(
    createElement(WebCalibrationWorkspace, {
      controller: value,
      footer: null,
      onActivated: async () => {},
      onBeforeLeaveChange: () => {},
      onConnectPhone: () => {},
    }),
  );
  expect(html).toContain('设置标定参考位');
  expect(html).toContain('进入拖动模式');
  expect(html).toContain('手机连接已断开');
  expect(html).toContain('连接手机');
});

it('offers phone and mapping recovery when a restarted host has no assisted session', () => {
  const value = controller(false);
  value.error = undefined;
  const html = renderToStaticMarkup(
    createElement(WebCalibrationWorkspace, {
      controller: value,
      footer: null,
      prepareFromTeaching: true,
      onActivated: async () => {},
      onConnectPhone: () => {},
      onCheckCamera: () => {},
    }),
  );
  expect(html).toContain('手机连接已断开');
  expect(html).toContain('连接手机');
  expect(html).toContain('检查相机映射');
});

it('keeps Start available when the camera check is the next action', () => {
  const value = controller(true);
  const render = (onCheckCamera?: () => void) =>
    renderToStaticMarkup(
      createElement(WebCalibrationWorkspace, {
        controller: value,
        footer: null,
        onActivated: async () => {},
        onCheckCamera,
      }),
    );
  const startButton = /(<button[^>]*>)[^<]*<span>开始自动标定/;
  expect(render(() => {}).match(startButton)?.[1]).toBeDefined();
  expect(render(() => {}).match(startButton)?.[1]).not.toContain('disabled');
  expect(render().match(startButton)?.[1]).toContain('disabled');
});

it.each([
  ['MAPPING_REQUIRED', true],
  ['VISION_BINDING_CHANGED', true],
  ['CALIBRATION_MISMATCH', true],
  ['PHONE_UNAVAILABLE', false],
  ['BUSY', false],
] as const)(
  'uses the backend code %s to route calibration setup failures',
  async (code, requiresCameraCheck) => {
    const client = new CalibrationClient({
      baseUrl: '/test',
      fetch: async () =>
        Response.json({ error: 'setup check failed', code }, { status: 409 }),
    });
    const error = await client
      .createAssistedCalibration()
      .catch((error) => error);
    expect(error).toBeInstanceOf(CalibrationRequestError);
    expect(error).toMatchObject({ code, requiresCameraCheck });
  },
);

it.each(['slide', 'standard', 'fast'] as const)(
  'offers a regular-mode retry only after sliding collection fails (%s)',
  (explorationMode) => {
    const value = controller();
    value.session = {
      id: 'failed',
      stage: 'interrupted',
      collectionFailed: true,
      explorationMode,
      phoneConnected: true,
    } as NonNullable<AssistedCalibrationController['session']>;
    const render = () =>
      renderToStaticMarkup(
        createElement(WebCalibrationWorkspace, {
          controller: value,
          footer: null,
          onActivated: async () => {},
        }),
      );
    const retryLabel = '用普通模式重试';
    expect(render().includes(retryLabel)).toBe(explorationMode === 'slide');
    value.session.errorDetails = { code: 'MOTION_INTERRUPTED', status: 409 };
    expect(render()).toContain('重新开始标定');
    expect(render()).not.toContain(retryLabel);
    value.session.errorDetails = undefined;
    value.session.collectionFailed = false;
    expect(render()).not.toContain(retryLabel);
  },
);
