/** Speech copy is deliberately shorter than screen copy. No runtime errors are read aloud. */
export const voiceMessages = {
  toolSetup: [
    'Enter the measured stylus length and any required tool payload.',
    '请填写实测的触笔长度，并按界面要求设置工具负载。',
  ],
  markersCountdown: [
    'Hands away. Detecting in three seconds',
    '请移开手，三秒后检测',
  ],
  markersRetry: [
    'Keep still. Retrying in three seconds',
    '请保持不动，三秒后自动重试',
  ],
  markerDisplayMode: [
    'Follow the full-screen instructions on the phone to show its markers.',
    '请按手机上的全屏提示操作，让标记完整显示。',
  ],
  markerFailed: [
    'Marker detection failed. Check visibility and focus before retrying.',
    '标记识别失败，请检查标记是否可见、画面是否清晰，再重试。',
  ],
  mappingWaiting: [
    'Open the calibration page on the phone and keep it visible.',
    '请在手机上打开标定页，并保持在前台。',
  ],
  cameraSetup: [
    'Camera mapping. Keep the phone and camera fixed, with the screen markers in view.',
    '相机映射时，请固定手机和相机，保持屏幕标记可见。',
  ],
  phoneFullscreen: ['Enter full screen on the phone.', '请在手机上进入全屏。'],
  phoneHomeScreen: [
    'Open the calibration page from the iOS Home Screen.',
    '请从 iOS 主屏幕打开标定页。',
  ],
  phoneReady: [
    'Phone connected. Keep the page open.',
    '手机已连接，请保持标定页打开。',
  ],
  phoneLost: [
    'Phone feedback lost. Stay clear and check the phone connection.',
    '手机反馈中断，请远离机械臂，检查手机连接。',
  ],
  connectionLost: [
    'Calibration updates lost. Stay clear and check the robot status.',
    '标定状态更新中断，请保持距离，检查机械臂状态。',
  ],
  mappingStart: ['Mapping started', '开始映射'],
  mappingCollecting: ['Mapping', '映射中'],
  mappingDone: ['Page mapping complete', '页面映射已完成'],
  mappingFailed: [
    'Mapping failed. Check the phone page and camera view.',
    '映射失败，请检查手机标定页和相机画面。',
  ],
  markerReview: [
    'Review the detected outlines and retry any failed screen.',
    '请核对屏幕轮廓，重新检测识别失败的屏幕。',
  ],
  perspectiveInvalid: [
    'The screen outline has shifted. Check the camera mapping before moving the arm.',
    '屏幕轮廓已偏移，请先重新检查相机映射，再移动机械臂。',
  ],
  deviceBound: ['Screen bound', '屏幕已绑定'],
  teachReference: [
    'Record the reference with the tip two to five centimetres above the screen centre.',
    '记录参考位时，笔尖应位于屏幕中心上方两到五厘米。',
  ],
  higherReference: [
    'Record a higher reference position as shown.',
    '请按界面提示重新记录更高的参考位。',
  ],
  teachBoundary: [
    'At reference height, teach straight toward the camera. Keep the whole arm clear of the camera and stand.',
    '保持参考高度，朝相机直线示教，整条机械臂都要与相机和支架保持间距。',
  ],
  confirmCorridor: [
    'Check clearance along the whole arm path before saving the teaching.',
    '保存示教前，请检查整条机械臂的运动路径是否净空。',
  ],
  teachingSaved: ['Installation teaching saved.', '安装示教已保存。'],
  gotoBoundary: [
    'Stand clear of the path to the taught camera-side boundary.',
    '机械臂将前往示教的相机侧边界，请让开运动路径。',
  ],
  samplingReady: [
    'Secure the screen and clear the arm path. Stop the robot if motion looks unexpected.',
    '采样前请固定屏幕，清空运动范围。若轨迹异常，请立即停止机械臂。',
  ],
  slideClearance: [
    'Before sliding, secure the phone flat on its support. Keep hands off the screen.',
    '滑动采样前，请将手机水平固定在支架上，采样时请勿手持或触碰屏幕。',
  ],
  autoStarted: [
    'Stand clear. Automatic sampling will touch the screen.',
    '请远离机械臂，自动采样会接触屏幕。',
  ],
  approachStart: [
    'Stand clear of the path to the calibration reference.',
    '机械臂将前往标定参考位，请让开运动路径。',
  ],
  referenceReturn: [
    'Stand clear. The arm is preparing to lift and return to the reference.',
    '请勿靠近，机械臂准备抬起并返回参考位。',
  ],
  directionProbe: [
    'Probing the screen to measure direction.',
    '正在探测屏幕，测量触笔移动方向。',
  ],
  autoSampling: [
    'Collecting grid points. Keep hands off the screen.',
    '正在采集网格点，请勿触碰屏幕。',
  ],
  boundaryReview: [
    'Review the measurement warnings before continuing to the boundary check.',
    '采样结果需要复核，请查看测量偏差，再决定是否继续边界验证。',
  ],
  autoVerifying: [
    'Preparing the boundary check. Stay clear.',
    '准备验证屏幕边界，请远离机械臂。',
  ],
  verifyTargets: [
    'Checking touch targets. Keep hands off the screen.',
    '正在验证触点，请勿触碰屏幕。',
  ],
  autoAvoiding: [
    'Camera avoidance move. Stand clear of the arm.',
    '请让开，机械臂正在移向相机避让位。',
  ],
  autoWaitingSafe: [
    'Use drag mode to set a safe position clear of the screen and camera.',
    '请使用拖动模式设置安全位，避开屏幕和相机。',
  ],
  returnSafe: [
    'Keep clear of the return path to the safe position.',
    '请让开机械臂返回安全位的路径。',
  ],
  recordSafe: [
    'Keep the tip at or above reference height, clear of the screen and camera. Release the arm before recording.',
    '请让笔尖保持在参考高度或以上，避开屏幕和相机，松手后记录安全位。',
  ],
  autoReview: [
    'Review the measurements and check the setup has not moved before saving.',
    '保存前，请核对测量结果，确认手机、相机和工具的位置没有变化。',
  ],
  autoFailed: [
    'Calibration interrupted. Stay clear until the arm is stationary, then check the reported step.',
    '标定中断。请在机械臂静止后，检查界面提示的步骤。',
  ],
  retryRegular: [
    'Sliding stopped. Once the arm is stationary, check the setup before retrying in regular mode.',
    '滑动采样中断。请等机械臂静止并检查装置，再确认是否用普通模式重试。',
  ],
  autoStopped: [
    'Calibration cancelled. Check that the arm is stationary before approaching.',
    '标定已取消，请确认机械臂静止后再靠近。',
  ],
  batchClearance: [
    'Secure each screen. Check clearance for the whole arm and cables between screens.',
    '请固定每块屏幕，检查跨屏路径，为整条机械臂和线缆留出空间。',
  ],
  batchPlacement: [
    'In drag mode, place the tip two to five centimetres above the selected screen centre. Release the arm before confirming.',
    '请在拖动模式下，将笔尖放在当前屏幕中心上方两到五厘米，松手后再确认。',
  ],
  batchNext: [
    'Stand clear as calibration advances between screens.',
    '跨屏标定时机械臂可能移动，请让开屏幕之间的路径。',
  ],
  batchCompleted: [
    'Calibration batch complete. Review the screen results.',
    '批量标定已结束，请查看各屏幕的结果。',
  ],
  batchStopped: [
    'Batch stopped. Verify the arm is stationary before approaching.',
    '批量标定已停止，请确认机械臂静止后再靠近。',
  ],
  batchStopping: [
    'Batch stop requested. Stay clear while the arm stops.',
    '正在停止批量标定，请等机械臂静止后再靠近。',
  ],
  confirmEnable: [
    'Before enabling the arm, check the tool payload and clear the workspace.',
    '使能前，请核对工具负载并清空机械臂工作区。',
  ],
  checkRecovery: [
    'Check that the arm is stationary and fault-free before confirming recovery.',
    '确认恢复前，请检查机械臂已静止且没有报警。',
  ],
  autoCompleted: ['Calibration complete', '标定完成'],
  enabled: ['Enabled', '已使能'],
  disabled: ['Disabled', '已下使能'],
  fault: ['Robot fault', '机械臂报警'],
  failed: ['Action failed', '操作失败'],
  enabling: ['Enabling', '正在使能'],
  drag: ['Drag mode. Hold the arm', '拖动模式，扶稳机械臂'],
  beforeDrag: [
    'Support the arm before entering drag mode.',
    '进入拖动模式前，请先扶稳机械臂。',
  ],
  exitDrag: ['Drag mode exited', '已退出拖动模式'],
  hover: [
    'Hover check along the screen boundary. Stand clear.',
    '正在沿屏幕边界悬停验证，请让开运动路径。',
  ],
  contact: [
    'Contact check. Keep hands off the screen and clear of the arm.',
    '开始接触边界验证，请勿触碰屏幕或靠近机械臂。',
  ],
  paused: ['Paused', '已暂停'],
  resuming: ['Resuming', '继续执行'],
  cancelled: ['Cancelled', '已取消'],
  stopSent: ['Stop command sent', '已发送停止指令'],
  emergencySent: ['Emergency stop sent', '已发送急停指令'],
  stopFailed: ['Stop command failed', '停止指令失败'],
  emergencyFailed: ['Emergency stop failed', '急停指令失败'],
  payload: ['Syncing payload', '同步工具负载'],
  payloadDone: ['Payload synced', '负载已同步'],
  remote: ['Switching control mode', '切换控制模式'],
  remoteDone: ['Control mode switched', '控制模式已切换'],
  reset: ['Clearing setup', '清空当前配置'],
  resetDone: ['Setup cleared', '配置已清空'],
  clearFaults: ['Fault reset sent', '已发送清错指令'],
  taskStart: ['Task started', '任务开始'],
  taskDone: ['Task complete', '任务完成'],
  taskFailed: ['Task failed', '任务失败'],
  preview: ['Voice prompts enabled', '语音提示已开启'],
} as const;
export type VoiceEvent = keyof typeof voiceMessages;
