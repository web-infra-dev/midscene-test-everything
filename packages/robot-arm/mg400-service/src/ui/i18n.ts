import { create } from 'zustand';
import { t as calibrationT } from './calibration';

type Language = 'zh' | 'en';
function initialLanguage(): Language {
  try {
    return localStorage.getItem('arm-playground-language') === 'en'
      ? 'en'
      : 'zh';
  } catch {
    return 'zh';
  }
}
export const usePreferences = create<{
  language: Language;
  setLanguage: (language: Language) => void;
}>((set) => ({
  language: initialLanguage(),
  setLanguage: (language) => {
    set({ language });
    try {
      localStorage.setItem('arm-playground-language', language);
    } catch {
      /* In-memory preference remains usable. */
    }
  },
}));
const messages = {
  correctionSaved: ['透视校正已保存', 'Perspective correction saved'],
  correctionSavedWithWarning: [
    '透视校正已保存，但轮廓与当前画面偏差较大。机械臂移动前请重新校验或再次标定。',
    'Perspective correction saved, but its outline differs from the live view. Recheck or recalibrate before moving the robot.',
  ],
  correctionCleared: ['透视校正已清除', 'Perspective correction cleared'],
  clearCorrection: ['清除透视校正', 'Clear perspective correction'],
  clearCorrectionTitle: ['清除透视校正？', 'Clear perspective correction?'],
  clearCorrectionBody: [
    '将删除这台相机保存的屏幕轮廓、输出尺寸和旋转，并返回原始画面。',
    'This deletes the saved screen outline, output size and rotation for this camera and returns to the original view.',
  ],
  transferTitle: ['设备切换路径', 'Device transfer route'],
  transferIntro: [
    '配置从当前设备到另一台设备的安全通道。先完成两台设备的标定，再验证路径；验证过程不会移动机械臂。',
    'Configure a safe corridor to another device. Calibrate both devices first. Validation does not move the arm.',
  ],
  transferTarget: ['目标设备', 'Destination device'],
  transferSelect: ['选择另一台已标定设备', 'Select another calibrated device'],
  transferStart: ['起点安全位', 'Source safe position'],
  transferEnd: ['终点安全位', 'Destination safe position'],
  transferWaypoint: ['路径点', 'Waypoint'],
  transferAdd: ['添加实测路径点', 'Add measured waypoint'],
  transferRemove: ['删除路径点', 'Remove waypoint'],
  transferDirect: [
    '未添加中间点：将直接连接两个安全位，请确认这条直线通道无障碍。',
    'No intermediate points: the safe positions will be connected directly. Confirm that straight corridor is clear.',
  ],
  transferMeasured: [
    '坐标使用机械臂 Base 坐标系下的法兰位置，单位 mm。请填写实测值；工具朝向沿用起点安全位，当前只支持固定朝向。',
    'Use measured flange positions in the arm’s Base frame, in mm. Tool orientation stays fixed at the source safe position.',
  ],
  transferConfirm: [
    '我已检查整条通道，确认没有手机、夹具或其他障碍物，且这些路径点来自实测。',
    'I checked the complete corridor for phones, fixtures and other obstacles, and these waypoints are measured.',
  ],
  transferVerify: ['验证并保存路径', 'Validate and save route'],
  transferVerified: ['该方向的路径已验证', 'Route verified in this direction'],
  transferDraft: [
    '修改尚未验证，仍保留上次保存的路径',
    'Draft changes are unverified; the previous saved route remains active',
  ],
  transferStale: [
    '配置已变化，需要重新验证路径',
    'Configuration changed; validate the route again',
  ],
  transferLifetime: [
    '仅在当前机械臂连接中有效。重新标定或更改配置后需重新验证；返回路径需要交换设备后单独配置。',
    'Valid for the current arm connection. Revalidate after calibration or configuration changes. Configure the return direction separately.',
  ],
  transferCancel: ['取消验证并关闭', 'Cancel validation and close'],
  transferClose: ['关闭', 'Close'],
  transferNeedsCalibration: [
    '请先完成这台设备的屏幕标定',
    'Complete screen calibration for this device first',
  ],
  transferNeedsReload: [
    '设备标定或相机配置已变化，请重新打开设备后再试',
    'Device calibration or camera configuration changed. Reopen the device and retry',
  ],
  transferWaypointRequired: [
    '请填写每个路径点的 X、Y、Z 实测坐标',
    'Enter measured X, Y and Z coordinates for every waypoint',
  ],
  transferUnsafe: [
    '路径距离屏幕太近。请提高安全位或调整路径点后重新验证',
    'The route is too close to a screen. Raise safe positions or adjust waypoints and retry',
  ],
  transferPayload: [
    '机械臂尚未确认当前工具负载，请先在标定中完成使能确认',
    'The current tool payload is unconfirmed. Complete enable confirmation in calibration first',
  ],

  cameraStarting: ['启动中', 'Starting'],
  cameraFailed: ['启动失败', 'Camera failed'],
  running: ['运行中', 'Running'],
  startCamera: ['启动相机', 'Start camera'],
  stopCamera: ['停止相机', 'Stop camera'],
  cameras: ['相机', 'Cameras'],
  expandCameraRail: ['展开相机列表', 'Show camera list'],
  collapseCameraRail: ['收起相机列表', 'Hide camera list'],
  noCameras: ['暂无可用相机', 'No online camera to show'],
  cameraAutoHint: [
    '连接摄像机后会自动显示在这里，每个摄像机对应一个设备。',
    'Connected cameras appear here automatically, one device per camera.',
  ],
  cameraUnavailable: [
    '相机接口尚未接入',
    'Camera integration is not connected yet',
  ],
  cameraLoadFailed: [
    '无法读取相机列表，请重试',
    'Could not load cameras. Please retry',
  ],
  refresh: ['刷新相机', 'Refresh cameras'],
  loadingCameras: ['正在读取相机列表', 'Loading cameras'],
  noStream: ['暂无画面', 'No stream'],
  stopped: ['未启动', 'Stopped'],
  screen: ['屏幕', 'Screen'],
  uncalibrated: ['未标定', 'Uncalibrated'],
  robot: ['机械臂', 'Robot'],
  theme: ['主题', 'Theme'],
  themeSystem: ['跟随系统', 'System'],
  themeLight: ['浅色', 'Light'],
  themeDark: ['深色', 'Dark'],
  skipToCamera: ['跳过，查看相机', 'Skip to cameras'],
  rawPreviewFailed: [
    '无法读取相机画面，请检查相机权限或刷新重试。',
    'Camera preview unavailable. Check camera access or refresh to retry.',
  ],
  correctedPreviewFailed: [
    '无法读取校正画面，请重新识别屏幕标记。',
    'Corrected preview unavailable. Detect the screen markers again.',
  ],
  cameraView: ['画面类型', 'Camera view'],
  rawView: ['原始画面', 'Original'],
  correctedView: ['校正画面', 'Corrected'],
  preview: ['交互预览 · 未接入真实设备', 'UI preview · No physical device'],
  disconnected: ['未连接', 'Disconnected'],
  checking: ['正在检查连接', 'Checking connection'],
  connecting: ['正在连接机械臂', 'Connecting to robot'],
  connectingAction: ['连接中…', 'Connecting…'],
  connected: ['已连接', 'Connected'],
  connectTitle: ['连接机械臂', 'Connect your robot'],
  connectDescription: [
    '连接机械臂后，即可配置设备并标定屏幕。',
    'Connect your robot to configure devices and calibrate screens.',
  ],
  model: ['机械臂型号', 'Robot model'],
  host: ['控制器 IP 地址', 'Controller IP address'],
  hostHelp: [
    '确保电脑与机械臂控制器处于同一局域网。',
    'Keep your computer and robot controller on the same local network.',
  ],
  hostError: ['请输入有效的 IPv4 地址', 'Enter a valid IPv4 address'],
  connect: ['连接机械臂', 'Connect robot'],
  retry: ['重新连接机械臂', 'Reconnect robot'],
  change: ['更换设备', 'Change device'],
  interrupted: ['机械臂连接已中断', 'Robot connection interrupted'],
  failed: ['连接失败', 'Connection failed'],
  commandCompletionUnknown: [
    'MG400 未确认命令结果，请检查控制器连接后重试。',
    'MG400 did not confirm the command result. Check the controller connection and retry.',
  ],
  failureHint: [
    '未能连接到控制器，请检查 IP 地址和网络后重试。',
    'Could not reach the controller. Check its IP address and your network, then retry.',
  ],
  details: ['连接详情', 'Connection details'],
  preparing: ['正在获取机械臂连接状态…', 'Reading robot connection status…'],
  connectingHint: [
    '正在建立连接，请稍候…',
    'Establishing connection. Please wait…',
  ],
  guide: ['连接前准备', 'Before connecting'],
  power: ['机械臂与控制器已通电', 'Power on the robot and controller'],
  network: [
    '电脑通过网线或局域网连接控制器',
    'Connect your computer to the controller network',
  ],
  tcp: [
    '控制器处于 TCP/IP 开发模式',
    'Set the controller to TCP/IP development mode',
  ],
  workspace: ['工作台', 'Workspace'],
  disconnect: ['断开连接', 'Disconnect'],
} satisfies Record<string, [string, string]>;
export function useT() {
  const language = usePreferences((state) => state.language);
  return (key: keyof typeof messages) =>
    messages[key][language === 'zh' ? 0 : 1];
}

export const useLanguage = () => usePreferences((s) => s.language);
export const t = (message: string, values?: (string | number)[]) =>
  calibrationT(message, values, usePreferences.getState().language);
