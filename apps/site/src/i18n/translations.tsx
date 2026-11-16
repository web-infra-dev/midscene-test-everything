import { type ReactNode, createContext, useContext, useState } from 'react';

export type Locale = 'en' | 'zh';

export interface TranslationDict {
  nav: {
    brandSub: string;
    demo: string;
    protocol: string;
    quickStart: string;
    api: string;
    customArm: string;
    switchLanguage: string;
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
    tags: string[];
  };
  stage: {
    tabArm: string;
    tabBle: string;
    tabSoon: string;
    soonBadge: string;
    soonDesc: string;
    soonCta: string;
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
    diagram: {
      hubTitle: string;
      hubSub: string;
      consumers: string[];
      adapters: string[];
    };
  };
  quickStart: {
    eyebrow: string;
    heading: string;
    lede: string;
    tabs: string[];
    items: {
      num: string;
      title: string;
      subtitle: string;
    }[];
    panels: {
      steps: {
        num: string;
        title: string;
        cmd?: string;
        desc?: string;
      }[];
    }[];
    codeTabs: {
      install: string;
      server: string;
      sdk: string;
      codex: string;
      claude: string;
      cursor: string;
    };
    moreLinks: {
      apiTitle: string;
      apiDesc: string;
      armTitle: string;
      armDesc: string;
    };
    copy: string;
    copied: string;
  };
  footer: {
    title: string;
    right: string;
  };
}

const en: TranslationDict = {
  nav: {
    brandSub: 'Universal Device',
    demo: 'Showcase',
    protocol: 'Protocol',
    quickStart: 'Quick Start',
    api: 'Protocol',
    customArm: 'Custom Robot Arm',
    switchLanguage: '切换到中文',
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
    tags: ['Universal Device', 'E2E Testing', 'MCP & Skills', 'Open Protocol'],
  },
  stage: {
    tabArm: 'DOBOT MG400',
    tabBle: 'iOS AirLink',
    tabSoon: 'More Devices',
    soonBadge: 'SOON',
    soonDesc:
      'More official device implementations are on the way — or build your own today.',
    soonCta: 'Go to Quick Start →',
    statusReady: 'UNIVERSAL-DEVICE READY',
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
    heading: 'One protocol. Any agent, any screen.',
    lede: 'Exclusive leases, screen capture, and input actions over HTTP or MCP.',
    diagram: {
      hubTitle: 'Universal Device',
      hubSub: 'HTTP · MCP',
      consumers: [
        'Codex · Claude Code · Cursor',
        'Midscene SDK',
        'Web Playground',
      ],
      adapters: ['iOS AirLink', 'Robot Arm', 'Custom Hardware'],
    },
  },
  quickStart: {
    eyebrow: 'QUICK START',
    heading: 'Get started in minutes.',
    lede: '',
    tabs: ['DOBOT MG400', 'iOS AirLink', 'Custom Device', 'MCP & Skills'],
    items: [
      {
        num: '01',
        title: 'DOBOT MG400',
        subtitle:
          'Run the built-in 4-axis arm and overhead camera calibration straight from this repo.',
      },
      {
        num: '02',
        title: 'iOS AirLink',
        subtitle:
          'Zero-jailbreak iPhone automation over macOS Bluetooth HID and screen mirroring.',
      },
      {
        num: '03',
        title: 'MCP',
        subtitle:
          'Connect Codex, Claude Code, or Cursor to a running device service. Replace the URL and token before running the command.',
      },
      {
        num: '04',
        title: 'Skills',
        subtitle: 'Give your agent the skills to control connected devices.',
      },
      {
        num: '05',
        title: 'Custom Device',
        subtitle:
          'Wrap any camera or actuator with createDeviceHandler(), then drive it via Midscene SDK.',
      },
    ],
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
            desc: 'Open localhost:5800 or drive with agentFromUniversalDevice().',
          },
        ],
      },
      {
        steps: [
          {
            num: '01',
            title: 'Install & build',
            cmd: 'pnpm ios-airlink install',
            desc: 'Installs the macOS BLE HID bridge and device service.',
          },
          {
            num: '02',
            title: 'Pair & start',
            cmd: 'pnpm ios-airlink start',
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
            desc: 'Point Playground or agentFromUniversalDevice() at your server URL.',
          },
        ],
      },
      {
        steps: [
          {
            num: '01',
            title: 'Start a device service',
            desc: 'Run iOS AirLink or the arm service and copy its service URL and Bearer token.',
          },
          {
            num: '02',
            title: 'Connect via MCP',
            cmd: 'npx -y @midscene/universal-device mcp',
            desc: 'Add to Codex, Claude Code, or Cursor for automatic leases, heartbeats, and screenshots.',
          },
          {
            num: '03',
            title: 'Or use CLI + Skill',
            cmd: 'npx -y @midscene/universal-device devices',
            desc: 'Load skills/universal-device/SKILL.md for shell agents using status, acquire, screenshot, action, and release.',
          },
        ],
      },
    ],
    codeTabs: {
      install: 'Install',
      server: 'Server',
      sdk: 'SDK',
      codex: 'Codex',
      claude: 'Claude',
      cursor: 'Cursor',
    },
    moreLinks: {
      apiTitle: 'Universal Device API',
      apiDesc: 'Endpoints, InputAction payloads, leases, and error codes.',
      armTitle: 'Custom Robot Arm',
      armDesc: 'Implement RobotArmAdapter with @midscene/arm-kit.',
    },
    copy: 'Copy',
    copied: 'Copied',
  },
  footer: {
    title: 'Midscene · Universal Device',
    right: 'MIT License',
  },
};

const zh: TranslationDict = {
  nav: {
    brandSub: 'Universal Device',
    demo: '设备演示',
    protocol: '开放协议',
    quickStart: '快速开始',
    api: '协议规范',
    customArm: '机械臂接入',
    switchLanguage: 'Switch to English',
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
    tags: ['Universal Device', 'E2E Testing', 'MCP & Skills', 'Open Protocol'],
  },
  stage: {
    tabArm: 'DOBOT MG400',
    tabBle: 'iOS AirLink',
    tabSoon: '更多设备',
    soonBadge: 'SOON',
    soonDesc: '更多官方设备实现正在路上，现在也可以直接自定义接入你的硬件。',
    soonCta: '前往快速开始 →',
    statusReady: 'UNIVERSAL-DEVICE READY',
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
    heading: '一套协议，连接任意 Agent 与任意屏幕。',
    lede: '通过统一的 HTTP 或 MCP 接口完成设备独占、画面读取与交互控制。',
    diagram: {
      hubTitle: 'Universal Device',
      hubSub: 'HTTP · MCP',
      consumers: [
        'Codex · Claude Code · Cursor',
        'Midscene SDK',
        'Web Playground',
      ],
      adapters: ['iOS AirLink', '机械臂', '自定义硬件'],
    },
  },
  quickStart: {
    eyebrow: 'QUICK START',
    heading: '几分钟内跑起来。',
    lede: '',
    tabs: ['DOBOT MG400', 'iOS AirLink', '自定义设备', 'MCP & Skills'],
    items: [
      {
        num: '01',
        title: 'DOBOT MG400',
        subtitle:
          '直接运行仓库内置的四轴机械臂与俯拍相机标定服务，零配置体验物理触控。',
      },
      {
        num: '02',
        title: 'iOS AirLink',
        subtitle:
          '基于 macOS 蓝牙 HID 与屏幕镜像，无需越狱即可自动化操控真机 iPhone。',
      },
      {
        num: '03',
        title: 'MCP',
        subtitle:
          '将 Codex、Claude Code 或 Cursor 接入已启动的设备服务。运行命令前，替换服务地址和 Token。',
      },
      {
        num: '04',
        title: 'Skills',
        subtitle: '让 Agent 学会控制已连接的设备。',
      },
      {
        num: '05',
        title: '自定义设备',
        subtitle:
          '用 createDeviceHandler() 封装任意硬件，再通过 Midscene SDK 统一驱动。',
      },
    ],
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
            desc: '打开 localhost:5800 或通过 agentFromUniversalDevice() 驱动。',
          },
        ],
      },
      {
        steps: [
          {
            num: '01',
            title: '安装与构建',
            cmd: 'pnpm ios-airlink install',
            desc: '安装 macOS 蓝牙 HID 桥接程序与设备服务。',
          },
          {
            num: '02',
            title: '配对并启动',
            cmd: 'pnpm ios-airlink start',
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
            desc: '在 Playground 或 agentFromUniversalDevice() 中填入你的服务地址。',
          },
        ],
      },
      {
        steps: [
          {
            num: '01',
            title: '启动设备服务',
            desc: '运行 iOS AirLink 或机械臂服务，拿到服务地址与 Bearer Token。',
          },
          {
            num: '02',
            title: '通过 MCP 接入',
            cmd: 'npx -y @midscene/universal-device mcp',
            desc: '配入 Codex、Claude Code 或 Cursor，自动管理设备租约、5 秒心跳与截图回传。',
          },
          {
            num: '03',
            title: '或使用 CLI + Skill',
            cmd: 'npx -y @midscene/universal-device devices',
            desc: '加载 skills/universal-device/SKILL.md，让支持 Bash 的 Agent 通过 status / acquire / screenshot / action / release 控设备。',
          },
        ],
      },
    ],
    codeTabs: {
      install: '安装',
      server: 'Server',
      sdk: 'SDK',
      codex: 'Codex',
      claude: 'Claude',
      cursor: 'Cursor',
    },
    moreLinks: {
      apiTitle: 'Universal Device API',
      apiDesc: '查看完整 HTTP 接口、InputAction 动作定义与错误码。',
      armTitle: '自定义机械臂',
      armDesc: '基于 @midscene/arm-kit 实现新的 RobotArmAdapter。',
    },
    copy: '复制',
    copied: '已复制',
  },
  footer: {
    title: 'Midscene · Universal Device',
    right: 'MIT License',
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
