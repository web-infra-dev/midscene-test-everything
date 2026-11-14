import { type ReactNode, createContext, useContext, useState } from 'react';

export type Locale = 'en' | 'zh';

export interface TranslationDict {
  nav: {
    brandSub: string;
    demo: string;
    protocol: string;
    quickStart: string;
    getStarted: string;
    langToggle: string;
  };
  hero: {
    backedBy: string;
    headlineLine1: string;
    headlineLine2Prefix: string;
    typeWords: string[];
    lede: string;
    ctaPrimary: string;
    ctaGithub: string;
    tags: [string, string, string];
  };
  stage: {
    tabArm: string;
    tabBle: string;
    statusReady: string;
    hudArmTitle: string;
    hudTarget: string;
    hudCamera: string;
    hudState: string;
    hudStateRunning: string;
    hudStateIdle: string;
    hudHint3d: string;
    hudResetView: string;
    hudBleBadge: string;
    hudBleHint: string;
    pipLabel: string;
    panelTitle: string;
    autoPlay: string;
    promptText: string;
    steps: {
      label: string;
      meta: string;
    }[];
  };
  protocol: {
    eyebrow: string;
    heading: string;
    lede: string;
    endpoints: {
      idx: string;
      path: string;
      desc: string;
    }[];
    flowNodes: string[];
    adapters: {
      badge: string;
      title: string;
      desc: string;
    }[];
    note: string;
  };
  quickStart: {
    eyebrow: string;
    heading: string;
    lede: string;
    tabs: [string, string, string];
    panels: {
      steps: {
        num: string;
        title: string;
        cmd?: string;
        desc?: string;
      }[];
    }[];
    codeTabs: {
      server: string;
      sdk: string;
    };
    copy: string;
    copied: string;
  };
  footer: {
    title: string;
    subtitle: string;
    right: string;
  };
}

const en: TranslationDict = {
  nav: {
    brandSub: 'Universal Device',
    demo: 'Demo',
    protocol: 'Protocol',
    quickStart: 'Quick Start',
    getStarted: 'Get Started',
    langToggle: '中文',
  },
  hero: {
    backedBy: 'Backed by',
    headlineLine1: 'Connect Everything.',
    headlineLine2Prefix: 'Test ',
    typeWords: [
      'Anything.',
      'iPhone.',
      'Car Cockpit.',
      'Embedded UI.',
      'Every Screen.',
    ],
    lede: "Bring Midscene's AI-powered E2E testing to any device. Powered by Universal Device, an open protocol for observing and interacting with devices of all kinds.",
    ctaPrimary: 'Get Started →',
    ctaGithub: 'GitHub',
    tags: ['Universal Device', 'E2E Testing', 'Open Protocol'],
  },
  stage: {
    tabArm: 'DOBOT MG400',
    tabBle: 'iPhone · BLE HID',
    statusReady: 'OPEN-DEVICE READY',
    hudArmTitle: 'MG400 STYLUS',
    hudTarget: 'TARGET',
    hudCamera: 'CAMERA',
    hudState: 'STATE',
    hudStateRunning: 'MOVING',
    hudStateIdle: 'READY',
    hudHint3d: 'Drag to orbit · Scroll to zoom · Click screen or step to run',
    hudResetView: 'Reset View',
    hudBleBadge: 'Bluetooth HID · Paired',
    hudBleHint: 'Click screen or any step to send BLE HID',
    pipLabel: 'DEVICE MIRROR',
    panelTitle: 'Tasks',
    autoPlay: 'Auto-Play',
    promptText: 'Open Settings → General → About on iPhone',
    steps: [
      { label: 'Tap Settings', meta: 'tap (448, 316)' },
      { label: 'Scroll to General', meta: 'swipe ↓' },
      { label: 'Tap General', meta: 'tap (280, 396)' },
      { label: 'Tap About', meta: 'tap (280, 232)' },
      { label: 'Assert iOS Version', meta: 'aiAssert' },
    ],
  },
  protocol: {
    eyebrow: 'UNIVERSAL DEVICE PROTOCOL',
    heading: 'See a screen, send an action, plug right in.',
    lede: 'Whether it is an iPhone over Bluetooth HID, a robotic arm holding a stylus, or your own hardware rig, every device speaks the same three HTTP endpoints to Midscene.',
    endpoints: [
      {
        idx: '01 · DISCOVER',
        path: 'GET /api/v1/devices',
        desc: 'List connected devices, screen dimensions, supported actions, and device capabilities.',
      },
      {
        idx: '02 · OBSERVE',
        path: 'GET /api/v1/sessions/{id}/screenshot',
        desc: 'Return the latest JPEG/PNG frame from an overhead camera, capture card, or screen mirror.',
      },
      {
        idx: '03 · ACT',
        path: 'POST /api/v1/sessions/{id}/actions',
        desc: 'Execute tap, swipe, press, or type actions on the device and report completion.',
      },
    ],
    flowNodes: [
      'Midscene Agent',
      'Universal Device HTTP',
      'Your Device Adapter',
      'Physical Screen',
    ],
    adapters: [
      {
        badge: 'ADAPTER 01',
        title: 'iPhone · BLE HID',
        desc: 'Mac pairs over Bluetooth LE HID directly. Zero jailbreak, zero on-device agent.',
      },
      {
        badge: 'ADAPTER 02',
        title: 'DOBOT MG400 · Stylus',
        desc: 'Overhead camera + physical stylus for automotive cockpits and sealed terminals.',
      },
    ],
    note: 'Token auth, SSE preview streaming, and session leases are built into createDeviceHandler() from @midscene/open-device/server.',
  },
  quickStart: {
    eyebrow: 'QUICK START',
    heading: 'Run a built-in hand, or build your own.',
    lede: 'Start with the reference MG400 or iPhone BLE HID services, or wrap any custom hardware in 20 lines of TypeScript.',
    tabs: ['DOBOT MG400', 'iPhone · BLE HID', 'Custom Device'],
    panels: [
      {
        steps: [
          {
            num: '01',
            title: 'Clone, install & build',
            cmd: 'git clone https://github.com/web-infra-dev/midscene-robotics.git\ncd midscene-robotics && pnpm install && pnpm build',
          },
          {
            num: '02',
            title: 'Start arm service',
            cmd: 'pnpm --filter @midscene/arm-service start',
            desc: 'Connects DOBOT MG400 + overhead camera calibration.',
          },
          {
            num: '03',
            title: 'Run Playground or SDK',
            cmd: 'pnpm dev:playground',
            desc: 'Open localhost:5800 or drive with agentFromOpenDevice().',
          },
        ],
      },
      {
        steps: [
          {
            num: '01',
            title: 'Install & build',
            cmd: 'pnpm iphone-use install',
            desc: 'Installs the macOS BLE HID bridge and device service.',
          },
          {
            num: '02',
            title: 'Pair & start',
            cmd: 'pnpm iphone-use start',
            desc: 'Pairs Mac Bluetooth HID with iPhone and exposes Universal Device.',
          },
          {
            num: '03',
            title: 'Run Playground or SDK',
            cmd: 'pnpm dev:playground',
            desc: 'Open localhost:5800 and test real iOS flows with zero jailbreak.',
          },
        ],
      },
      {
        steps: [
          {
            num: '01',
            title: 'Implement ControlledDevice',
            desc: 'Provide screenshot() and execute(action, signal) for your camera, capture card, or actuator.',
          },
          {
            num: '02',
            title: 'Mount createDeviceHandler()',
            desc: 'Serve /api/v1/devices, sessions, screenshots, and actions with built-in auth and leases.',
          },
          {
            num: '03',
            title: 'Drive with Midscene',
            cmd: 'pnpm dev:playground',
            desc: 'Point Playground or agentFromOpenDevice() at your server URL.',
          },
        ],
      },
    ],
    codeTabs: {
      server: 'Device Server',
      sdk: 'Drive with SDK',
    },
    copy: 'Copy',
    copied: 'Copied',
  },
  footer: {
    title: 'Midscene · Universal Device',
    subtitle: 'DOBOT MG400 · iPhone BLE HID · MIT License',
    right: 'Connect Everything. Test Anything.',
  },
};

const zh: TranslationDict = {
  nav: {
    brandSub: 'Universal Device',
    demo: '交互演示',
    protocol: '开放协议',
    quickStart: '快速开始',
    getStarted: '立即开始',
    langToggle: 'EN',
  },
  hero: {
    backedBy: 'Backed by',
    headlineLine1: 'Connect Everything.',
    headlineLine2Prefix: 'Test ',
    typeWords: [
      'Anything.',
      'iPhone.',
      'Car Cockpit.',
      'Embedded UI.',
      'Every Screen.',
    ],
    lede: '将 Midscene 的 AI 端到端测试能力带到任意设备。基于 Universal Device——一套用于观测屏幕与执行交互的开放设备协议。',
    ctaPrimary: '快速开始 →',
    ctaGithub: 'GitHub',
    tags: ['Universal Device', 'E2E Testing', 'Open Protocol'],
  },
  stage: {
    tabArm: 'DOBOT MG400',
    tabBle: 'iPhone · BLE HID',
    statusReady: 'OPEN-DEVICE READY',
    hudArmTitle: 'MG400 机械臂',
    hudTarget: '目标',
    hudCamera: '相机',
    hudState: '状态',
    hudStateRunning: '执行中',
    hudStateIdle: '就绪',
    hudHint3d: '拖拽旋转视角 · 滚轮缩放 · 点击屏幕或步骤执行',
    hudResetView: '重置视角',
    hudBleBadge: '蓝牙 HID · 已配对',
    hudBleHint: '点击屏幕或任意步骤发送 BLE HID 指令',
    pipLabel: '设备镜像',
    panelTitle: '任务流程',
    autoPlay: '自动演示',
    promptText: '在 iPhone 打开 设置 → 通用 → 关于本机',
    steps: [
      { label: '点击「设置」', meta: 'tap (448, 316)' },
      { label: '滚动至「通用」', meta: 'swipe ↓' },
      { label: '点击「通用」', meta: 'tap (280, 396)' },
      { label: '点击「关于本机」', meta: 'tap (280, 232)' },
      { label: '校验 iOS 版本', meta: 'aiAssert' },
    ],
  },
  protocol: {
    eyebrow: 'UNIVERSAL DEVICE PROTOCOL',
    heading: '看得到画面，执行得了动作，就能接进来。',
    lede: '无论是通过蓝牙 HID 直连的 iPhone、手持电容笔的机械臂，还是你自己的工业硬件终端，所有设备都通过同一套三个 HTTP 接口接入 Midscene。',
    endpoints: [
      {
        idx: '01 · 设备发现',
        path: 'GET /api/v1/devices',
        desc: '列出已连接设备、屏幕分辨率、支持的动作类型与设备能力描述。',
      },
      {
        idx: '02 · 屏幕观测',
        path: 'GET /api/v1/sessions/{id}/screenshot',
        desc: '返回来自俯拍摄像头、采集卡或屏幕镜像的最新 JPEG/PNG 画面。',
      },
      {
        idx: '03 · 执行交互',
        path: 'POST /api/v1/sessions/{id}/actions',
        desc: '在设备上执行点击、滑动、按键或输入文本，并返回执行结果。',
      },
    ],
    flowNodes: [
      'Midscene Agent',
      'Universal Device HTTP',
      '你的设备适配器',
      '物理屏幕',
    ],
    adapters: [
      {
        badge: 'ADAPTER 01',
        title: 'iPhone · BLE HID',
        desc: 'Mac 通过蓝牙 LE HID 直连真机，无需越狱，无需在手机端安装插件。',
      },
      {
        badge: 'ADAPTER 02',
        title: 'DOBOT MG400 · 电容笔',
        desc: '俯拍相机 + 物理电容笔，覆盖无调试接口的车机、工控与封闭终端。',
      },
    ],
    note: 'Token 鉴权、SSE 实时预览流与会话租约已内置于 @midscene/open-device/server 的 createDeviceHandler() 中。',
  },
  quickStart: {
    eyebrow: 'QUICK START',
    heading: '开箱即用的内置方案，或接入你的专属设备。',
    lede: '直接启动内置的 MG400 机械臂或 iPhone 蓝牙 HID 服务，或用 20 行 TypeScript 封装任意自定义硬件。',
    tabs: ['DOBOT MG400', 'iPhone · BLE HID', '自定义接入'],
    panels: [
      {
        steps: [
          {
            num: '01',
            title: '克隆、安装并构建',
            cmd: 'git clone https://github.com/web-infra-dev/midscene-robotics.git\ncd midscene-robotics && pnpm install && pnpm build',
          },
          {
            num: '02',
            title: '启动机械臂服务',
            cmd: 'pnpm --filter @midscene/arm-service start',
            desc: '连接 DOBOT MG400 并加载俯拍相机标定参数。',
          },
          {
            num: '03',
            title: '运行 Playground 或 SDK',
            cmd: 'pnpm dev:playground',
            desc: '打开 localhost:5800 或通过 agentFromOpenDevice() 驱动。',
          },
        ],
      },
      {
        steps: [
          {
            num: '01',
            title: '安装与构建',
            cmd: 'pnpm iphone-use install',
            desc: '安装 macOS 蓝牙 HID 桥接程序与设备服务。',
          },
          {
            num: '02',
            title: '配对并启动',
            cmd: 'pnpm iphone-use start',
            desc: '将 Mac 蓝牙 HID 与 iPhone 配对并暴露 Universal Device 接口。',
          },
          {
            num: '03',
            title: '运行 Playground 或 SDK',
            cmd: 'pnpm dev:playground',
            desc: '打开 localhost:5800，零越狱测试真机 iOS 流程。',
          },
        ],
      },
      {
        steps: [
          {
            num: '01',
            title: '实现 ControlledDevice',
            desc: '为你的相机、采集卡或执行器实现 screenshot() 与 execute(action, signal)。',
          },
          {
            num: '02',
            title: '挂载 createDeviceHandler()',
            desc: '自动提供 /api/v1/devices、会话租约、截图与动作接口及鉴权。',
          },
          {
            num: '03',
            title: '使用 Midscene 驱动',
            cmd: 'pnpm dev:playground',
            desc: '在 Playground 或 agentFromOpenDevice() 中填入你的服务地址。',
          },
        ],
      },
    ],
    codeTabs: {
      server: '设备端 Server',
      sdk: 'SDK 驱动示例',
    },
    copy: '复制',
    copied: '已复制',
  },
  footer: {
    title: 'Midscene · Universal Device',
    subtitle: 'DOBOT MG400 · iPhone BLE HID · MIT License',
    right: 'Connect Everything. Test Anything.',
  },
};

const dictionaries: Record<Locale, TranslationDict> = { en, zh };

interface I18nContextValue {
  locale: Locale;
  t: TranslationDict;
  toggleLocale: () => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('midscene-site-lang');
      if (saved === 'zh' || saved === 'en') return saved;
    }
    return 'en';
  });

  const toggleLocale = () => {
    setLocale((prev) => {
      const next: Locale = prev === 'en' ? 'zh' : 'en';
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('midscene-site-lang', next);
        document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
      }
      return next;
    });
  };

  return (
    <I18nContext.Provider
      value={{ locale, t: dictionaries[locale], toggleLocale }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
