import { expect, it } from '@rstest/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalibrationClient, CalibrationRequestError } from '../src/client';
import { PhonePairStep } from '../src/components/robot-arm/PhonePairStep';
import { WebCalibrationWorkspace } from '../src/components/robot-arm/WebCalibrationWorkspace';
import { WebCameraMappingStep } from '../src/components/robot-arm/WebCameraMappingStep';
import type { AssistedCalibrationController } from '../src/hooks/useAssistedCalibration';

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

it('keeps camera command errors out of the phone connection step', () => {
  const html = renderToStaticMarkup(
    createElement(PhonePairStep, {
      controller: controller(),
      footer: null,
      onContinue() {},
    }),
  );
  expect(html).toContain('手机已连接');
  expect(html).not.toContain('Calibration marker');
  expect(html).not.toContain('识别失败');
});

it('still shows transport connection failures on the phone step', () => {
  const value = controller();
  value.connectionError = '标定连接已断开，正在重连…';
  const html = renderToStaticMarkup(
    createElement(PhonePairStep, {
      controller: value,
      footer: null,
      onContinue() {},
    }),
  );
  expect(html).toContain('标定连接已断开');
});

it('asks for a marker page before screen detection and keeps stale command errors out', () => {
  const html = renderToStaticMarkup(
    createElement(WebCameraMappingStep, {
      controller: controller(false),
      footer: null,
      onPair() {},
      onContinue() {},
      onDetect: async () => {},
    }),
  );
  expect(html).not.toContain('使用 AI 检测');
  expect(html).toContain('识别屏幕标记');
  expect(html).toContain('打开标记页');
  expect(html).not.toContain('Calibration marker');
});

it('offers automatic collection before recording the safe position', () => {
  const value = controller();
  value.session = {
    id: 'retry',
    stage: 'ready',
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
  expect(html).toContain('屏幕水平固定、配置就绪、工作区净空');
  expect(html).toContain('自动执行悬停与接触边界验证');
  expect(html).not.toContain('Record Safe Position');
  expect(html).not.toContain('15 点');
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
      warnings: [{ label: 'Holdout maximum', percent: 3, targetPercent: 1.5 }],
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
  expect(html).toContain('建议 ≤1.5%');
  expect(html).toContain('10% 的相对容差');
  expect(html).toContain('继续边界验证');
});

it.each([true, false])(
  'uses the reference step only if the selected screen needs a reference (has reference: %s)',
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
        footer: null,
        onActivated: async () => {},
      }),
    );
    if (hasReference) {
      expect(html).not.toContain('设置标定参考位');
      expect(html).not.toContain('上一步');
      expect(html).toContain('1 采集标定点');
      expect(html).toContain('普通');
    } else {
      expect(html).toContain('设置标定参考位');
      expect(html).toContain('进入拖动模式');
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
  'offers a confirmed regular retry only after sliding collection fails (%s)',
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
    expect(render().includes('确认重试')).toBe(explorationMode === 'slide');
    value.session.collectionFailed = false;
    expect(render()).not.toContain('确认重试');
  },
);
