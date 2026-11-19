import { assistedCalibrationZh } from './assisted-calibration-zh';
import { migratedZh } from './migrated-zh';
const calibrationZh: Record<string, string> = {
  'The preview phone does not match this screen’s saved binding. Use the bound phone or release the binding first.':
    '预览手机与此屏幕保存的配对信息不一致。请使用已绑定的手机，或先解除原绑定。',
  'Open the page on the phone, then select the device below.':
    '在手机上打开页面，再在下方选择该设备。',
  'Delete Screen': '删除屏幕',
  'Delete this screen binding?': '删除此屏幕绑定？',
  'Delete Saved Perspective': '删除已保存的透视',
  'Delete the saved perspective for this screen?': '删除此屏幕已保存的透视？',
  'The outline does not match the phone screen. Apply it anyway?':
    '轮廓与手机屏幕不符。仍要应用吗？',
  Apply: '应用',
  Cancel: '取消',
  Save: '保存',
  'Screen name saved': '屏幕名称已保存',
  'Perspective applied': '已应用透视',
  'Perspective not applied': '尚未应用透视',
  'Clear Perspective': '清除透视',
  'Enter full screen on the page first.':
    '请先在手机页面点「进入全屏」，再连接设备。',
  'Page offline': '页面离线',
  'Reconnect page': '重新连接页面',
  'Reconnect {0}': '重新连接 {0}',
  'Unlock the phone and bring this page back to the foreground, then reconnect it.':
    '请解锁手机、把该页面切回前台，然后再重新连接。',
  'Remove page': '移除页面',
  'Remove page {0}': '移除页面 {0}',
  'Remove this offline page with its screen and perspective? This cannot be undone.':
    '移除这个离线页面，以及它对应的屏幕和透视？此操作不可撤销。',
  'Saved and connected screen pages are listed below. Keep one active page per screen.':
    '以下为已保存和已连接的页面；每块屏幕保持一个页面在线。',
  'Connect the computer to Wi-Fi before pairing a phone':
    '请先将电脑连接 Wi‑Fi，再配对手机',
  'Waiting for the Controller queue': '正在等待机械臂执行队列',
  'Wait for the Controller queue before starting calibration commands':
    '请等待机械臂执行队列就绪后再开始标定',
  'Open this address on the phone. The QR code binds it automatically.':
    '在手机上打开此地址；扫描二维码会自动完成绑定。',
  'Assign the screen page in Camera Mapping first':
    '请先在相机映射中分配屏幕页面',
  'Record Camera Boundary': '记录相机边界',
  'Camera-side Boundary A': '相机侧边界 A 点',
  'Camera-side Boundary B': '相机侧边界 B 点',
  'Record Boundary A': '记录边界 A 点',
  'Record Boundary B': '记录边界 B 点',
  'Teach Boundary A': '示教边界 A 点',
  'Teach Boundary B': '示教边界 B 点',
  'Record two points on the intended camera-side boundary.':
    '在预定的相机侧边界线上记录两个点。',
  'At the reference height, place the tip at the first point on the intended boundary. Keep the whole arm clear of the camera and stand.':
    '在参考高度将笔尖移到预定边界的 A 点，确保整条机械臂与相机和支架保持净空。',
  'Move along the intended boundary at the reference height. Record point B at least 20 mm from A.':
    '在参考高度沿预定边界移动，记录与 A 点相距至少 20 mm 的 B 点。',
  'Record boundary point A first': '请先记录边界 A 点',
  'Record boundary points A and B at least 20 mm apart in XY':
    '边界 A、B 两点的水平间距至少为 20 mm。',
  'Keep the reference at least 20 mm from the camera-side boundary line':
    '参考位与相机侧边界线的水平垂直距离至少为 20 mm。',
  'Record the reference and both camera-side boundary points':
    '请记录参考位和相机侧边界的两个点。',
  'Record the reference and both boundary points, then confirm the clear arm corridor':
    '请记录参考位和两个边界点，再确认整条机械臂的通行净空。',
  'The target exceeds the taught camera-side boundary by {0} mm.':
    '目标越过已示教的相机侧边界 {0} mm。',
  'The live boundary overlay requires an existing screen calibration for this camera view. Check the line from A to B directly.':
    '实时边界叠加需要此相机视图中已有的屏幕标定。请直接检查 A 到 B 的边界线。',
  'Save Installation Teaching': '保存安装示教',
  'Teach Camera Boundary': '示教相机边界',
  'Reteach Installation': '重新示教',
  'Saved installation teaching is shared by screens on this camera.':
    '已保存的安装示教由当前相机的各块屏幕共用。',
  'Record the camera-side boundary once to enable automatic camera avoidance.':
    '记录一次相机侧边界，即可在边界验证后自动移动到相机安全位。',
  'The phone is securely fixed, the stylus is vertical, and the full arm has camera clearance on the reference side of the boundary. There are no other obstacles.':
    '确认手机已固定、触控笔竖直，参考位一侧整条机械臂的路径不会碰到相机，且没有其他障碍物。',
  'Move straight from the reference towards the camera and stop at a safe boundary. Leave clearance for the whole arm, then release it before recording.':
    '从参考位朝相机方向直线移动，在仍安全的位置停下。为整条机械臂留足间隙，松手后记录。',
  'Moving to the camera-avoidance position': '正在移动到相机避让安全位',

  'Repeating validation heights': '正在重复测量验证点高度',
  'Repeated contact heights are inconsistent; check screen stability':
    '同一点多次测得的接触高度波动过大，请检查手机固定和触控笔接触。',
  Event: '事件',
  Feedback: '反馈',
  'result:touched': '采样回复：检测到触摸',
  'result:no_touch': '采样回复：未检测到触摸',
  'result:unknown': '采样回复：状态不确定',
  'prepare:ready': '准备就绪',
  'prepare:touched': '准备时已有触摸',
  'prepare:unknown': '准备状态不确定',
  'Document Touch / Pointer capture enabled':
    '已启用 Touch / Pointer 全页面捕获诊断',
  'Refresh the phone page to enable document Touch / Pointer diagnostics':
    '请刷新手机辅助页以启用 Touch / Pointer 全页面捕获诊断',
  'Raw touch start': 'Touch 按下',
  'Raw touch end': 'Touch 松开',
  'Raw touch cancelled': 'Touch 取消',
  'Event source / element': '监听位置 / 目标元素',
  'Default prevented: before / after': '默认行为被阻止：前 / 后',
  'Document capture': 'document 捕获阶段',
  'Surface handler': '采样区域处理',
  'Phone touch diagnostics': '手机触摸诊断',
  'Touch down': '按下',
  'Touch released': '松开',
  'Touch cancelled by browser': '浏览器取消触摸',
  'Pointer capture ended': '触摸捕获结束',
  'Sampling target reset': '采样目标重置',
  'Phone sampling reply': '手机采样回复',
  'Computer received phone update {0} at {1}':
    '电脑已收到手机第 {0} 条消息，时间 {1}',
  'Waiting for phone diagnostics': '等待手机诊断数据',
  'Last touch received: {0}, {1}': '电脑收到的最近触点：{0}, {1}',
  'No touch-down event in the recent history': '近期记录中尚无按下事件',
  'These events confirm browser input and delivery, not successful calibration. Only the last 40 events from this page are retained.':
    '此处用于确认网页事件和消息传递，不代表标定成功。仅保留当前手机页面最近 40 条事件。',
  'Page time (ms)': '页面内时间（毫秒）',
  'Target / step': '采样点 / 步骤',

  'Exploration progress': '探索进度',
  'Direction probe {0} / {1}': '方向探点 {0} / {1}',
  'Finding the reference contact': '寻找参考接触点',
  'Height sweep {0} / {1}': '短滑测高 {0} / {1}',
  'Slide sample {0} / {1}': '滑动采点 {0} / {1}',
  'Short sweeps at different heights establish stable contact':
    '在不同高度短距离滑动，确定稳定触发的范围',
  'Sliding and checking touch at the endpoint': '滑向采样点，停稳后确认触摸',
  'Touch lost. Lifting and retrying from inside the screen':
    '触摸中断，抬笔后从屏幕内侧重新滑入',
  'Numbered points are planned. Green marks recorded touches and the ring marks the current target.':
    '编号是计划点，绿点是实测触点，外圈是当前目标。',
  'Measured contact height range: {0} mm': '实测触发高度范围 {0} mm',
  'Checking screen boundaries': '正在验证屏幕边界',
  'Hover boundary check {0} / {1}': '边界悬空验证 {0} / {1}',
  'Contact boundary check {0} / {1}': '边界接触验证 {0} / {1}',
  'Reference position illustration': '参考位示意图',
  Pending: '待开始',
  'Grid point {0} / {1}': '网格采样点 {0} / {1}',
  'Stopped at this point': '已在此点停止',
  'Measuring this point within the safe range': '正在安全范围内精测当前点高度',
  'Touch recovery budget exhausted; collected points are retained':
    '本轮补探次数已用完，采样已停止，已采数据保留。',
  'No touch before the safe descent limit; collected points are retained':
    '在允许的安全下探范围内仍未接触屏幕，采样已停止，已采数据保留。',
  'Touch recovery did not succeed': '当前点补探未恢复触摸',
  'Stopped during: {0}': '停止时阶段：{0}',
  'Waiting for touch observation': '等待触摸反馈',
  'Touch lost: recovering this endpoint': '触摸丢失，正在当前点有限补探',
  'This mode assumes a horizontal screen and a compliant tip. Secure the phone on a rigid support; do not hold it by hand during motion.':
    '此模式采用水平屏幕假设，并要求笔尖具有弹性缓冲。请用稳固支撑固定手机，机械臂运动时不要用手扶持。',
  'Recorded contacts and current target': '已记录触点与当前目标',
  'Numbered circles: planned points \u00b7 Green dots: measured contacts \u00b7 Ring: current target':
    '编号圆圈：计划采样点；绿点：实测触点；外圈：当前目标。',
  'Height diagnostics': '测高诊断',
  'Direction-probe height range: {0} mm. This alone does not identify tilt or movement.':
    '方向探点的接触高度差：{0} mm。仅凭此值不能判定倾斜或移动原因。',
  'Local recovery: {0} / 6 steps \u00b7 Run total: {1} / 12 steps':
    '当前点补探：{0} / 6 步；本轮累计：{1} / 12 步',
  'Predicted Z {0} mm \u00b7 Measured Z {1} mm \u00b7 Lower limit {2} mm':
    '预测 Z {0} mm；实测 Z {1} mm；下降下限 {2} mm',
  'Touch confirmed at the last observation': '最近一次反馈：已确认触摸',
  'No touch confirmed at the last observation': '最近一次反馈：未确认触摸',

  'You can still record robot positions. Refresh the phone calibration page before starting collection or verification.':
    '仍可记录安全位置和参考位。开始采集或验证前，请刷新手机标定网页恢复连接。',
  'Record a safe position before automatic calibration':
    '请先记录安全位置，再开始自动标定。',
  'Model settings, including the API key, are saved in this browser. Clear them here when no longer needed.':
    '模型配置（包括 API Key）保存在当前浏览器中，下次自动复用；不再使用时可在此清除。',
  'Unable to clear saved model settings in this browser.':
    '浏览器未允许清除已保存的模型配置。',
  'Unable to save model settings in this browser.':
    '浏览器未允许保存模型配置，请检查浏览器存储设置。',
  'Retry and continue': '重试并继续',
  'Refresh the existing phone page to reconnect.':
    '刷新原来的手机网页即可重新连接。',
  'Already paired? Keep the phone page open. It reconnects after a service restart; no need to scan again.':
    '已扫码配对？保持手机网页打开，服务重启后会自动重连，无需再次扫码。',
  'Calibration connection lost. Reconnecting…': '标定连接已断开，正在重连…',
  'Phone disconnected during calibration. Restart this step.':
    '标定期间手机已断开，请重新开始本步骤。',
  'Calibration marker {0} could not be decoded uniquely ({1} matches).':
    '标记 {0} 识别失败（匹配到 {1} 处）。',
  'Keep at least four of the six calibration markers visible and in focus.':
    '请确保六个标定码中至少有四个在画面中清晰可见。',
  'Page marker fit verified; screen edges require visual confirmation':
    '页面标记拟合通过；屏幕边界仍需目视确认',
  'The browser did not report the page position within the screen. Automatic screen boundary detection is unavailable.':
    '浏览器未提供网页在屏幕中的位置（通常是没有全屏），无法自动推算完整屏幕边界。请让该页面进入全屏后重试。',
  'Open Workspace': '进入工作台',
  'Confirm Screen Area': '确认屏幕范围',
  'Drag the four corners to fit the phone display area.':
    '拖动四角，使绿框贴合手机显示区域。',
  'Frozen frame for adjustment': '画面已固定，可拖动四角调整',
  'Refresh Reference Frame': '刷新画面',
  'Confirm Area and Continue': '确认范围并继续',
  'Confirm the screen area before continuing.':
    '请先确认屏幕范围，再继续标定。',
  'Calibrate {0}': '标定 {0}',
  'Calibrate multiple screens': '多屏连续标定',
  'More options': '更多选项',
  'Cancel Calibration': '取消本次标定',
  'Cancel Positioning': '取消位置记录',
  'Press Depth': '按压深度',
  'Safe Height': '安全高度',
  Result: '结果',
  'View individual click results': '查看逐点验证结果',
  'Finish Calibration': '完成标定',
  'Continue the controller? Interrupted tasks will not be replayed.':
    '继续控制器并检查恢复条件？被中断的任务不会自动重跑。',
  'Disable the stationary robot?': '确认给静止的机械臂下使能？',
  'Apply the saved tool payload?': '确认同步已保存的工具负载？',
  'Check the robot before allowing further actions?':
    '确认检查机械臂恢复条件？检查通过后才能执行新动作。',

  'Robot state changed. Close this dialog and confirm the current operation again.':
    '机械臂状态已变化，请关闭此弹窗并重新确认当前操作。',
  'Check Recovery': '检查恢复',
  'Check recovery while the robot is stationary and fault-free. This does not enable or move the robot.':
    '确认机械臂静止且无报警后检查恢复。此操作不会使能或移动机械臂。',
  'Kept for this page session only; never written to a camera or robot profile.':
    '仅在当前页面会话中保留，不会写入相机或机械臂配置。',
  'Paste a MIDSCENE_ROBOT_CALIBRATION_MODEL_* block here. Matching variables fill the fields below; OPENAI_API_KEY and OPENAI_BASE_URL are also supported.':
    '在此粘贴 MIDSCENE_ROBOT_CALIBRATION_MODEL_* 环境变量，自动填写下方字段；也支持 MIDSCENE_MODEL_*、OPENAI_API_KEY 和 OPENAI_BASE_URL。',
  'No API Key on the service; set MIDSCENE_ROBOT_CALIBRATION_MODEL_API_KEY or use a custom model.':
    '服务端未配置密钥，可设置 MIDSCENE_ROBOT_CALIBRATION_MODEL_API_KEY 或使用自定义模型。',
  'The service has no MIDSCENE_ROBOT_CALIBRATION_MODEL_* configuration. Set it on the calibration host, or switch on a custom model for this session.':
    '服务端未配置标定模型，可设置标定服务的环境变量，或为当前会话开启自定义模型。',
  'Clear Model Settings': '清除模型设置',

  Calibration: '标定',
  'Tool Settings': '工具配置',
  Rotation: '旋转',
  'Calibration page expired. Start calibration again from your script.':
    '标定页面已过期，请从脚本重新发起标定。',
  'Connection to calibration was lost. Reconnecting…':
    '标定连接已断开，正在尝试重新连接…',

  'Confirm the tool configuration and ensure the workspace is clear before enabling the robot.':
    '请确认工具配置正确、工作区域已清空，再使能机械臂。',
  'Select a camera and corrected output size': '请填写校正后的画面输出尺寸。',
  'Return to Safe Position': '回到安全位置',
  'Return to Safe Position?': '回到安全位置？',
  Reset: '复位',
  'Move clear of the screen, exit Drag Mode, then save.':
    '移至屏幕上方，退出拖动模式后保存。',
  'Change Safe Position': '重新设置安全位置',
  'Save Current Position': '保存当前位置',
  'Screen Calibration is required.': '请先完成屏幕标定。',

  'Reference View': '参考画面',

  'Connect this computer directly to the controller with an Ethernet cable.':
    '用网线将这台电脑直接连接到机械臂控制器。',

  'Save the touch tool before measuring the screen.':
    '请先保存触控工具，再测量屏幕。',
  'Connect the robot before setting up the touch tool.':
    '请先连接机械臂，再配置触控工具。',

  'Camera Mapping Guide': '相机映射指南',

  'Previous Step': '上一步',
  'Position the stylus by hand to record at least five contact points, the screen references and a safe position. Then run hover and contact verification.':
    '手动定位触控笔，记录至少 5 个触点、屏幕参考点和安全位置，再执行悬停与接触验证。',
  'At least five distributed points fit the screen plane. Record P1 at the top-left, P2 to its right, and a safe position above the screen. Hover verification checks the border without touching; contact verification checks the press depth and the closed edge path.':
    '用至少 5 个分散触点拟合屏幕平面，再记录左上角 P1、其右侧的 P2 和屏幕上方的安全位置。悬停验证不接触屏幕；接触验证检查按压深度与闭合沿边路径。',
  'The robot, camera and screen are configured. Check controller readiness before running motion.':
    '机械臂、相机和屏幕已配置完成。执行运动前，请检查控制器就绪状态。',
  'Screen calibration is complete. Finish Camera Mapping before running visual touch actions.':
    '屏幕标定已完成。执行视觉触控操作前，还需要完成相机映射。',

  'Connect Directly to the Controller': '电脑直连机械臂控制器',
  'Connecting does not enable or move the robot.': '连接不会使能或移动机械臂',
  'This Computer': '这台电脑',
  Controller: '控制器',
  Ethernet: '网线直连',
  'Find address → Enter address → Connect':
    '查看地址 → 填入地址 → 连接并确认型号',
  'Measure Origin to Tip': '测量完整的法兰原点到尖端距离',
  'Include the holder and adapters. Downward mounting shown.':
    '包含支架与转接件 · 此图为垂直向下安装',
  'Measured · mm': '实测值 · mm',
  'Measure from here': '从这里开始量',
  'Holder / Adapter': '支架 / 转接件',
  Stylus: '触控笔',
  'Measure the Touch Area': '只量有效触控区域',
  'Width runs right; height runs down. Exclude the bezel.':
    '宽 = 校正画面的向右方向；高 = 向下方向 · 不含边框',
  'Width · mm': '宽度 · mm',
  Height: '高度',
  'Top-left': '左上角',
  'Match the camera view': '与相机画面对应',
  Right: '右',
  Down: '下',
  'Blue area = physical screen dimensions': '蓝色区域 = 填入的物理宽高',
  'Match Corners and Orientation': '四角对应，方向一致',
  'Fix the camera, select the touch area and check the result.':
    '固定相机后，选取完整触控区域并检查校正结果',
  Correct: '校正',
  Corrected: '校正画面',
  'Keep the full touch area in view.': '相机能看到完整区域',
  'Match top-left, right and down.': '左上 / 向右 / 向下均对应',
  'Sample, Then Verify': '采样与验证分开确认',
  'Position by hand first, then run both verification groups.':
    '采样由操作员手动定位；随后分别执行悬停与接触边界验证',
  '1. Collect 5+ Points': '① 手动采集至少 5 点',
  'Distributed samples': '分散触点，用于拟合平面',
  '2. Hover Verification': '② 悬停验证',
  '3. Contact Verification': '③ 接触验证',
  'Clear of the screen': '保持安全高度，不接触',
  'Use saved settings': '按已确认的接触设置执行',
  'Check corners and edges': '检查四角 + 完整闭合边界',
  'Check contact, then save': '检查接触结果后保存',

  'Saved configuration is available for review while the robot is disconnected. Reconnect before making changes.':
    '机械臂已断联，仍可查看保存的配置。重新连接后才能修改。',
  'Saved configuration is unavailable. Start the arm service to load it.':
    '保存的配置暂时不可用，请启动机械臂服务后加载。',

  'Manage Installations': '管理安装配置',
  'Saved Installations ({0})': '已保存（{0}）',
  'Archived Installations ({0})': '已归档（{0}）',
  'Current Installation': '当前安装',
  Archive: '归档',
  'Restore to List': '恢复到列表',
  Rename: '重命名',
  'Rename Installation': '重命名安装',
  'Installation Name': '安装名称',
  'Optional; defaults to the robot model': '选填，默认使用机械臂型号命名',
  'Same Controller Address': '同一控制器地址',
  'Storage Location': '存储位置',
  'Installation Details': '安装详情',
  'Refresh List': '刷新列表',
  'Actions for {0}': '“{0}”的操作',
  'Calibration: {0}': '标定：{0}',
  'Last Used: {0}': '上次使用：{0}',
  'Archive {0}?': '归档“{0}”？',
  'Delete {0} permanently?': '永久删除“{0}”？',
  'To connect a robot, close this dialog and open Connect Robot.':
    '如需连接机械臂，请关闭此窗口后进入“连接机械臂”步骤。',
  'Restore to List makes an installation selectable again. It does not connect the robot.':
    '恢复到列表后，可以重新选择此安装配置；此操作不会连接机械臂。',
  'Rename or delete saved installations. Archive keeps their configuration and logs.':
    '可以重命名或删除已保存的安装配置；归档会保留配置和日志。',
  'Archiving removes this installation from connection choices and keeps its configuration and logs.':
    '归档后，此安装将从连接列表中隐藏，配置和日志都会保留。',
  'This permanently deletes the installation configuration and logs. Export a backup first if you need a copy.':
    '此操作会永久删除该安装的配置和日志。如需保留副本，请先导出备份。',
  'Renaming also renames the storage folder. Saved measurements and calibration are retained.':
    '重命名会同步修改存储目录名称，已保存的测量和标定会保留。',
  'No archived installations.': '暂无已归档安装。',
  'No saved installations.': '暂无已保存安装。',
  'Installation list unavailable.': '暂时无法读取安装列表。',
  'Change Device': '更换设备',
  'Connection Details': '连接详情',
  'TCP Mode required': '需要 TCP 模式',
  'Robot Connection': '机械臂连接',
  'Robot Connection Interrupted': '机械臂连接已中断',
  'Connecting to Robot': '正在连接机械臂',
  'Robot not connected': '机械臂尚未连接',
  'Connection failed': '连接失败',
  'Reconnect Robot': '重新连接机械臂',
  'Retry Connection': '重试连接',
  'Start the arm service, then retry the connection.':
    '请启动机械臂服务后重试连接。',
  'Your saved setup and task history are retained. Reconnect to continue.':
    '已保留保存的配置和任务记录，重新连接后即可继续。',
  'Connect a robot to configure its tool, screen and calibration. Cameras and ADB remain available independently.':
    '连接机械臂后，可配置工具、屏幕及标定。相机和 ADB 可独立使用。',
  'Connection does not enable or move the robot.':
    '连接操作不会使能或移动机械臂。',

  'Rerun Hover Verification': '重新运行悬停验证',
  'Rerun hover verification? Both groups of acceptance will be cleared.':
    '重新运行悬停验证？两组验收记录都将清除。',
  'Robot installation geometry changed.': '机械臂安装几何已改变。',
  'Touch tool geometry changed.': '触控工具几何已改变。',
  'Physical screen geometry changed.': '屏幕物理几何已改变。',
  'Select a saved calibration': '请选择已有标定',
  'Service restarted. Confirm the installation and complete recovery before continuing.':
    '服务已重启。请确认安装未变并完成恢复检查后继续。',
  'Calibration stopped. Measurements are retained; complete recovery before continuing.':
    '标定已停止，测量数据已保留。请完成恢复检查后继续。',
  'The existing draft will remain in history and be replaced by the new measurements. Saved valid calibration is retained.':
    '原草稿会保留在历史中，并由新采样替换；已保存的有效标定仍保留。',
  'Verification target {0}: {1}': '验证目标 {0}：{1}',
  'Controller Actions': '控制器操作',
  'Calibration Overview': '标定概览',
  'Calibration Valid': '标定有效',
  'Calibration in Progress': '正在标定',
  'Saved Calibration Is Valid': '已保存的标定有效',
  'Geometry Saved — Verification Required': '几何已保存，待完成验证',
  'Calibration Needs Attention': '标定需要处理',
  'Last Verification': '最近验收时间',
  'Not verified': '尚未验收',
  'Boundary verification': '边界验证',
  'Existing center-tap verification': '既有中心点击验收',
  'Reading saved calibration...': '正在读取已保存的标定…',
  'No saved calibration for this robot, tool and screen. Start by collecting distributed contact points.':
    '当前机械臂、工具和屏幕尚无已保存标定，请先采集分散的接触点。',
  'Matching measurements already exist. Select a saved result instead of sampling again.':
    '已有匹配的测量结果，可选用已有标定，无需重新采样。',
  'Saved Calibration': '已保存标定',
  Verified: '已验收',
  'Verification Required': '待验收',
  'Use Saved Calibration': '使用已有标定',
  'Continue Calibration': '继续标定',
  'Continue Verification': '继续验证',
  'No new contact samples are needed. Continue with physical verification.':
    '无需重新采集接触点，继续完成实物验证即可。',
  'Saved Calibration Draft': '已暂存的标定草稿',
  'Calibration Interrupted — Measurements Retained':
    '标定已中断，测量数据已保留',
  Samples: '采样点',
  'Next Task': '下一项任务',
  'Boundary Verification': '边界验证',
  'Observation Pose': '观察位',
  'P1 Reference': 'P1 参考点',
  'P2 Reference': 'P2 参考点',
  'Calibration Maintenance': '标定维护',
  'I confirm the robot base, touch tool and screen installation have not changed.':
    '我确认机械臂底座、触控工具及屏幕安装均未改变。',
  'Run Boundary Verification Again': '重新进行边界验证',
  'Start New Measurements': '重新采样',
  'Discard this draft? Saved valid calibration is retained.':
    '放弃此草稿？已保存的有效标定会保留。',
  'Discard Draft': '放弃草稿',
  'Collect the Contact Plane': '采集接触平面',
  'Collect Contact Plane': '采集接触平面',
  'Locate Screen': '确定屏幕位置',
  'Verify and Use': '验证并使用',
  'Record the Top-left Reference': '记录左上参考点',
  'Record the Right Reference': '记录向右参考点',
  'Record the Observation Pose': '记录观察位',
  'Hover Boundary Verification': '悬停边界验证',
  'Contact Boundary Verification': '接触边界验证',
  'Undo Last Sample': '撤销上次采样',
  'Save and Exit': '暂存并退出',
  'Read the calibration draft before continuing.': '请先读取标定草稿再继续。',
  'Wait for the current calibration command to finish.':
    '请等待当前标定操作结束。',
  'Wait for the verification motion to finish before saving and exiting. Stop and Emergency Stop remain available.':
    '验证动作结束后才能暂存退出；停止和急停仍可使用。',
  'Exit Drag Mode before saving and exiting.': '暂存退出前请先退出拖动模式。',
  'Verify the saved geometry again?': '复用已保存几何重新验证？',
  'Start new calibration measurements?': '开始新的标定采样？',
  'The current valid result is retained until the new draft is accepted and saved.':
    '新草稿完成验收并保存前，当前有效结果会保留。',
  'Resample this task?': '重新采集此任务？',
  'Earlier valid measurements are retained. Dependent geometry and verification will be cleared.':
    '前面有效的测量会保留，依赖当前任务的后续几何和验收将清除。',
  'Run the four hover corners and a closed boundary circuit, then return to observation?':
    '执行四角悬停及一圈闭合沿边悬停，然后返回观察位？',
  'Run Hover Boundary Verification': '运行悬停边界验证',
  'Confirm Hover Corners and Boundary': '确认悬停四角与沿边轨迹',
  'Press each exact corner, lift between corners, then slide around the complete boundary?':
    '逐角按压并抬起，然后沿精确边界闭合滑动一圈？',
  'Run Contact Boundary Verification': '运行接触边界验证',
  'Contact Verification Passed, Save and Use': '接触验证通过，保存并使用',
  'Reject Contact Result': '接触验证不通过',
  'Controller Not Ready': '控制器尚未就绪',
  'Check the controller connection, enablement, payload and recovery status before running motion.':
    '执行运动前，请检查连接、使能、负载和恢复状态。',
  'Reconnect the robot controller.': '请重新连接机械臂控制器。',
  'Enable the robot before running verification.': '运行验证前请使能机械臂。',
  'Wait for fresh controller feedback.': '请等待新鲜的控制器反馈。',
  'The robot is recovering. Wait before continuing.':
    '机械臂正在自动恢复，请稍候再继续。',
  'Confirm the saved tool payload before continuing.':
    '继续前请确认已保存的工具负载。',
  'Exit Drag Mode before automatic motion.': '自动运动前请退出拖动模式。',
  'Resume controls before continuing.': '请先继续控制，再执行后续操作。',
  'Resolve the controller fault before continuing.': '继续前请处理控制器故障。',
  'Wait for the current robot operation to finish.':
    '请等待当前机械臂操作结束。',
  'Use the vendor teach pendant for manual positioning.':
    '请使用厂家示教器手动定位。',
  'Spread contact samples across the five suggested areas. The fit must pass before continuing.':
    '按五个建议区域分散采样，拟合通过后再继续。',
  'Contact plane fitted. Check the inward direction before continuing.':
    '接触平面已拟合，请确认指向屏幕内部的方向。',
  'Contact Samples: {0} / at least 5': '接触采样：{0} / 至少 5 个',
  'Place the contact tip at the physical top-left reference P1, then capture.':
    '将接触尖端放到物理左上参考点 P1，然后采集。',
  'Place the contact tip at reference P2 to the right of P1 along the top edge, then capture.':
    '将接触尖端沿上边放到 P1 右侧的参考点 P2，然后采集。',
  'Move to a clear observation pose above the configured clearance and record it. This pose is used after each verification group.':
    '移动到满足抬笔间隙且不遮挡屏幕的观察位并记录，每组验证结束后返回此处。',
  'Hover at the four exact corners, then trace all four edges. Observe position, direction and coverage.':
    '悬停于四个精确角点，然后沿四边移动；请观察位置、方向和覆盖范围。',
  'Press and lift at each exact corner, then slide around all four edges at the configured press depth.':
    '在四个精确角点分别按压并抬起，然后以配置的按压深度沿四边滑动。',
  'Exact physical boundary · 0 mm inset · verification speed and acceleration: 0.15 × base settings':
    '物理精确边界 · 内缩 0 mm · 验证速度与加速度为基础值的 0.15 倍',
  'Running: {0} · {1} / {2}': '正在执行：{0} · {1} / {2}',
  'Four Corners': '四角',
  'Four Edges': '四边',
  'Return to Observation': '返回观察位',
  'Correct Earlier Measurements': '修正前面的测量',
  'Adjust Contact Plane': '调整接触平面',
  'Resample P1': '重采 P1',
  'Resample P2': '重采 P2',
  'Resample Observation Pose': '重采观察位',
  'Measurement and Verification Details': '测量与验收详情',
  'Fit quality describes the captured plane, not overall touchscreen accuracy.':
    '拟合质量描述所采集的接触平面，不代表整套触控精度。',
  'Suggested Sampling Areas': '建议采样区域',
  'Upper-left area': '左上区域',
  'Upper-right area': '右上区域',
  'Lower-right area': '右下区域',
  'Lower-left area': '左下区域',
  'Center area': '中心区域',
  'Suggested next area: {0}': '下一个建议区域：{0}',
  'Five samples collected. Add more points if the fit or distribution needs improvement.':
    '已采集五点；拟合或分布不满足要求时可以继续补点。',
  'This older draft has no verifiable installation checkpoint. Its history is retained; start new measurements.':
    '旧草稿缺少可核验的安装检查点，历史数据已保留，请重新采样。',
  'Robot, tool or screen geometry changed. Start new measurements.':
    '机械臂、工具或屏幕几何已改变，请重新采样。',
  'The selected robot, tool or screen changed. Select the matching installation first.':
    '当前选择的机械臂、工具或屏幕已改变，请先选回匹配的安装。',
  'Verification settings changed. Run hover and contact verification again.':
    '验证参数已改变，请重新运行悬停与接触验证。',
  'Confirm that the physical installation has not changed':
    '请确认物理安装未改变',
  'The selected installation changed before saving calibration':
    '保存标定前，当前安装选择已改变',
  'Wait for motion to finish and explicitly exit Drag Mode before saving and exiting':
    '请等待运动结束并明确退出拖动模式，再暂存退出',
  'The measurement context changed': '测量上下文已改变',
  'Only a saved or interrupted draft can be resumed':
    '仅暂存或中断的草稿可以恢复',
  'Record the observation pose and exit Drag Mode before verification':
    '验证前请记录观察位并退出拖动模式',
  'Accept the complete hover boundary verification first':
    '请先确认完整的悬停边界验证',
  'Run the complete hover group before confirming':
    '请先执行完整的悬停验证组再确认',
  'Complete both boundary groups and confirm the observed contact result':
    '请完成两组边界验证，并确认观察到的接触结果',
  'Calibration revision is stale': '标定会话版本已更新，请刷新后操作',
  'Fit quality': '拟合质量',
  Disable: '下使能',
  Enable: '使能',
  Motion: '运动',
  'Pose and Recent Actions': '位姿与最近操作',
  'Loading…': '加载中…',
  'Check the controller before disabling.': '下使能前请检查控制器。',
  'Check the controller connection, enablement and recovery state.':
    '请检查控制器连接、使能和恢复状态。',
  'Controller fault': '控制器故障',
  Paused: '已暂停',
  Calibrating: '标定中',
  Busy: '忙',
  'Setup incomplete': '配置未完成',
  'Tool payload not configured': '未配置工具负载',
  'Configure Tool': '配置工具',
  'Applying tool payload': '正在应用工具负载',
  Disabled: '已下使能',
  'Enable Robot': '使能机械臂',
  'Enable the robot before calibrating it.': '标定前需要先使能机械臂。',
  'Tool payload not applied': '工具负载未应用',
  'Disable Robot': '下使能机械臂',
  'Camera mapping required': '待确认相机映射',
  'Calibration verification required': '标定待验证',
  'Calibration required': '未标定',
  'Check Controller': '检查控制器',
  Retry: '重试',
  Refresh: '刷新',
  'Prepare the robot': '准备机械臂',
  '{0} of {1} complete': '已完成 {0}/{1}',
};
// English source messages are stable keys; API values and user content are never translated.
const robotSetupZh: Record<string, string> = {
  'Enter {0}': '请填写{0}',
  'Enter a whole number within the allowed range.': '请填写允许范围内的整数。',
  'Camera frame size changed. Detect the screen again.':
    '相机图像尺寸已改变，请重新检测屏幕。',
  'The perspective draft could not be restored. Review the current camera image.':
    '无法恢复透视草稿，请检查当前相机画面。',
  'Test Tap Timing': '测试点击时序',
  'Camera Position Changed': '相机位置已改变',
  'Robot Position Changed': '机械臂位置已改变',
  'Screen Position Changed': '屏幕位置已改变',
  'Connect Robot': '连接机械臂',
  'Robot Model': '机械臂型号',
  'Choose a robot model': '选择机械臂型号',
  'Controller Address': '控制器地址',
  'Dashboard Port': '控制端口',
  'Motion Port': '运动端口',
  'Feedback Port': '反馈端口',
  'Joint Count': '关节数量',
  'Advanced Connection Settings': '高级连接设置',
  'Save and Connect': '保存并连接',
  'Save and Continue': '保存并继续',
  'Continue Setup': '继续配置',
  'Continue to Touch Tool': '继续配置触控工具',
  'Continue to Calibration': '继续屏幕标定',
  'Continue with Physical Setup': '继续物理安装配置',
  'Finish Setup': '完成配置',
  'Your current installation': '当前安装',
  'Ready to Use': '可以开始使用',
  'Installation Saved': '安装配置已保存',
  'Set Up Your Installation': '配置当前安装',
  'Start Using': '开始使用',
  'View Configuration': '查看配置',
  'Device or Installation Changed': '设备或安装有变化',
  'Connection and Controller': '连接与控制器',
  'Edit Connection': '修改连接',
  'Installation Configuration': '安装配置',
  'Saved Configuration': '已保存配置',
  'Empty Configuration': '空配置',
  'Create a New Installation': '新建安装配置',
  'Create a New Installation?': '新建安装配置？',
  'Restore Saved Installation?': '恢复已有安装配置？',
  'Start with empty measurements and calibration. All saved installations are retained.':
    '从空白的测量和标定开始，所有已有安装配置都会保留。',
  'Restore the selected tool, screen and calibration. Camera mapping and controller readiness will be checked again. Connecting does not enable or move the robot.':
    '恢复所选安装的工具、屏幕和标定。相机映射与控制器就绪状态会重新检查，连接不会使能或移动机械臂。',
  'Saved installations could not be loaded: {0}': '无法读取已有安装配置：{0}',
  'Saved tool: {0}; screen: {1}; calibration: {2}':
    '已保存工具：{0}；屏幕：{1}；标定：{2}',
  Invalid: '已失效',
  'Pending Verification': '待验证',
  'I confirm this is the same physical robot and the tool, screen and mounting positions have not changed.':
    '我确认这是原来的实体机械臂，工具、屏幕和安装位置均未变化。',
  'A new installation starts with empty measurements. Existing configurations remain available to restore.':
    '新安装从空白测量开始，原有配置仍可恢复。如安装发生变化，请选择新建。',
  'Multiple saved installations use this controller address. Check the last used time and calibration before restoring.':
    '多个已保存安装使用同一控制器地址。恢复前请核对最后使用时间和标定状态。',
  'Clear Configuration': '清除配置',
  'Clear Saved Configuration': '清除已保存配置',
  'Clear Saved Configuration?': '清除已保存配置？',
  'This deletes the saved measurements, calibration and action log for {0}. This cannot be undone.':
    '将删除“{0}”的已保存测量、标定和操作记录，此操作无法撤销。',
  'Cleared the saved configuration of {0}': '已清除“{0}”的已保存配置',
  'This installation has no saved configuration.': '此安装没有已保存配置。',
  'Change Device / Edit Address': '更换设备 / 修改地址',
  'Review Controller': '检查控制器',
  'Image Dimensions': '图像尺寸',
  'Use Corrected Image Size': '使用校正图像尺寸',
  'Review Perspective Correction': '检查透视校正',
  'Camera Mapping Confirmed': '相机映射已确认',
  'Replace the current robot installation?': '更换当前机械臂安装？',
  'A different controller starts a new installation. Existing measurements and calibrations are retained in their original data directory.':
    '更换控制器将建立新的安装配置，已有测量和标定数据保留在原数据目录中。',
  'This connection is managed by the startup configuration.':
    '此连接由启动配置管理。',
  'Controller connected. Continue with the tool or another available step.':
    '控制器已连接，可以继续配置工具或进入其他可用步骤。',
  'Disable the robot before replacing its connection.':
    '更换连接前，请先将机械臂下使能。',
  'Choose your robot model and connect to its controller. Connection does not enable or move the robot.':
    '选择机械臂型号并连接控制器，连接操作不会使能或移动机械臂。',
  'Match the installation diagram and measure from the flange origin to the contact tip.':
    '对照安装示意图，测量法兰坐标系原点到接触尖端的距离。',
  'Measure the physical touch area and review the contact reference values.':
    '测量有效触控区域的物理尺寸，并核对接触参考值。',
  'Frame the same touch area, check the corrected image and confirm its coordinate directions.':
    '框选同一触控区域，检查校正画面并确认坐标方向。',
  'Follow the current physical sampling or verification task. Camera mapping can be completed separately.':
    '按照当前任务完成物理采样或验证，相机映射可以单独完成。',
  'Your camera mapping, physical calibration and controller are ready.':
    '相机映射、物理标定与控制器均已就绪。',
  'Continue with the next task. Completed configuration is retained.':
    '继续完成下一项任务，已完成的配置会保留。',
  'Choose what physically moved. Only the affected mapping or calibration will need attention.':
    '选择实际移动的对象，仅处理受影响的映射或标定。',
  'Camera movement requires checking perspective correction and confirming camera mapping. Mechanical calibration is retained.':
    '相机移动后需要检查透视校正并重新确认映射，机械标定保留。',
  'Robot movement requires mechanical recalibration. Camera mapping is retained.':
    '机械臂移动后需要重新机械标定，相机映射保留。',
  'Screen movement requires both camera mapping and mechanical recalibration.':
    '屏幕移动后需要重新处理相机映射和机械标定。',
  'Connect a robot to obtain its tool and motion capabilities. Camera preparation remains available.':
    '连接机械臂后可获取工具与运动能力，相机准备仍可独立进行。',
  'Save the tool and physical screen settings before starting mechanical calibration. Camera mapping is not required.':
    '开始机械标定前，请先保存工具与屏幕物理参数，无需先完成相机映射。',
  'Save the touch tool before completing the physical screen configuration.':
    '请先保存触控工具，再完成屏幕物理参数配置。',
  'Perspective correction can be saved now. Save the physical screen settings before confirming camera mapping.':
    '现在即可保存透视校正，确认相机映射前需要先保存屏幕物理参数。',
  'I confirm the contact values suit this installation. New-installation references: 0.5 mm press and 5 mm clearance.':
    '我已确认接触参数适用于当前安装。新安装参考值：按压 0.5 mm、抬笔间隙 5 mm。',
  'Confirm that the contact values suit this installation.':
    '请确认接触参数适用于当前安装。',
  'The saved draft could not be restored. Saved installation settings are retained.':
    '无法恢复草稿，已保存的安装配置仍然保留。',
  'You can leave both pixel dimensions unset and save the physical measurements now. Complete camera mapping before visual touchscreen actions.':
    '可以暂不填写像素宽高，先保存物理测量值；执行视觉触控前再完成相机映射。',
  'Leave Setup with an Unsaved Draft?': '保留未保存草稿并离开配置？',
  'Your draft is retained for this installation. The saved configuration remains in use.':
    '草稿会保留在当前安装下，已保存的配置仍继续使用。',
  'Leave Setup': '离开配置',
  Disable: '下使能',
  Enable: '使能',
  Motion: '运动',
  'Pose and Recent Actions': '位姿与最近操作',
  'Loading…': '加载中…',
  'Check the controller before disabling.': '下使能前请检查控制器。',
  'Check the controller connection, enablement and recovery state.':
    '请检查控制器连接、使能和恢复状态。',
  'Controller fault': '控制器故障',
  Paused: '已暂停',
  Calibrating: '标定中',
  Busy: '忙',
  'Setup incomplete': '配置未完成',
  'Tool payload not configured': '未配置工具负载',
  'Configure Tool': '配置工具',
  'Applying tool payload': '正在应用工具负载',
  Disabled: '已下使能',
  'Enable Robot': '使能机械臂',
  'Enable the robot before calibrating it.': '标定前需要先使能机械臂。',
  'Tool payload not applied': '工具负载未应用',
  'Disable Robot': '下使能机械臂',
  'Camera mapping required': '待确认相机映射',
  'Calibration verification required': '标定待验证',
  'Calibration required': '未标定',
  'Check Controller': '检查控制器',
  Retry: '重试',
  Refresh: '刷新',
  'Prepare the robot': '准备机械臂',
  '{0} of {1} complete': '已完成 {0}/{1}',
};

const setupZh: Record<string, string> = {
  'Setup Maintenance': '配置维护',
  'Clear Current Setup': '清空当前配置',
  'Clear Current Setup?': '清空当前配置？',
  'Clear and Start Over': '清空并重新配置',
  'Start over with a new robot connection and fresh measurements.':
    '重新连接机械臂，并从头测量和配置。',
  'This disconnects the robot and returns all five setup steps to their initial state.':
    '此操作会断开机械臂连接，将五个配置步骤恢复到初始状态。',
  'Clears the current connection, robot and touch tool settings, screen measurements, camera mapping and screen calibration from use.':
    '清除当前使用的连接、机械臂和触控工具参数、屏幕尺寸、相机映射及屏幕标定。',
  'Discards unsaved setup drafts. You must reconnect and complete setup before running robot actions.':
    '丢弃未保存的配置草稿。重新连接并完成配置后，才能执行机械臂操作。',
  'The previous connection and saved measurements are archived locally. They are not automatically restored. Camera presets, photos and task history are kept.':
    '原连接及已保存的测量数据保留在本地，不会自动恢复使用。相机预设、照片和任务记录会保留。',
  'This does not reset the robot controller or restore computer network settings. It does not automatically disable the robot.':
    '此操作不会重置机械臂控制器或恢复电脑网络设置，也不会自动下使能。',
  'Stop the robot, finish or exit the current task, exit Drag Mode and disable the robot before clearing setup.':
    '请先停止机械臂、完成或退出当前任务、退出拖动模式并下使能，再清空配置。',
  'I have stopped and disabled the robot, exited Drag Mode, and understand that setup must be completed again.':
    '我已停止机械臂、退出拖动模式并下使能，理解清空后需要重新完成配置。',
  'Refresh the current installation before clearing setup.':
    '当前安装已变化，请刷新后再清空配置。',
  'Confirm clearing the current setup first.': '请先确认清空当前配置。',
  'Wait for the current operation to finish before clearing setup.':
    '请等待当前操作结束，再清空配置。',
  'Finish or cancel the current operation before clearing setup.':
    '请先完成或取消当前操作，再清空配置。',
  'Stop the robot, exit Drag Mode and disable it before clearing setup.':
    '请先停止机械臂、退出拖动模式并下使能，再清空配置。',
  'Configure Computer Network': '配置电脑网口',
  'Operating System': '操作系统',
  'Computer IP Address': '电脑 IP 地址',
  'Subnet Prefix Length': '子网前缀长度',
  'Copy Setup Command': '复制配置命令',
  'View Command': '查看命令',
  'Network Setup Command': '网络配置命令',
  'Network command copied.': '网络配置命令已复制。',
  'Copy failed. Select and copy the command below.':
    '复制失败，请展开下方命令，选中后手动复制。',
  'For a direct Ethernet connection, run this command on the computer running the robot service. Choose its dedicated wired port in the terminal, then type APPLY to confirm.':
    '网线直连时，在运行机械臂服务的电脑上执行此命令。在终端中选择直连机械臂的专用有线网口，输入 APPLY 确认。',
  'Use an unused computer IP. The prefix must match the controller subnet; 24 means 255.255.255.0. This command does not change the controller address.':
    '请使用未被占用的电脑 IP。前缀需与控制器的子网掩码一致，24 对应 255.255.255.0。此命令不会修改控制器地址。',
  'Open PowerShell as Administrator. DHCP on the selected Ethernet port will be disabled for this session. The command prints how to restore it.':
    '以管理员身份打开 PowerShell。所选有线网口的 DHCP 将在当前会话关闭，命令会打印恢复方式。',
  'Wi-Fi can stay connected, even on the same subnet. The command adds a temporary computer address and a route only for the controller. Only wired Ethernet adapters are listed. A Wi-Fi device with the same IP as the controller will be unreachable until you undo the configuration.':
    '即使网段相同，Wi-Fi 也可以保持连接。命令会添加临时电脑地址和仅通往控制器的路由，只列出有线以太网接口。如果 Wi-Fi 网络中有设备与控制器 IP 相同，在撤销配置前将无法访问该设备。',
  'Open Terminal. macOS will ask for your administrator password to configure a temporary IP address and controller route. The command prints how to undo the changes.':
    '打开终端。macOS 会要求输入管理员密码，以配置临时 IP 地址和控制器专用路由。命令会打印撤销方法。',
  'After the command finishes, return here and connect. Reapply after a restart or if the temporary address is lost.':
    '命令完成后，返回此处连接机械臂。电脑重启或临时地址失效后，需重新执行。',
  'Enter a private IPv4 controller address to generate a command.':
    '请先填写控制器的 IPv4 私网地址，再生成命令。',
  'Only private IPv4 addresses are supported by this network helper.':
    '此配网助手仅支持 IPv4 私网地址。',
  'Enter a private IPv4 address for the computer.':
    '请填写电脑的 IPv4 私网地址。',
  'Enter a subnet prefix length from 8 to 30.':
    '请填写 8 至 30 之间的子网前缀长度。',
  'The computer and controller must be in the same subnet.':
    '电脑和控制器的地址必须处于同一子网。',
  'The computer address must differ from the controller address.':
    '电脑地址不能与控制器地址相同。',
  'Network and broadcast addresses cannot be used as device addresses.':
    '网络地址和广播地址不能用作设备地址。',
  'Connect Robot': '连接机械臂',
  'Connect the robot to this computer. This does not enable or move it.':
    '将机械臂连接到本机。此操作不会使能或移动机械臂。',
  'Use the address shown in the robot controller or setup app.':
    '使用机器人控制器或配置应用显示的地址。',
  'The robot and this computer must be on the same network.':
    '机械臂与本机需要处于同一网络。',
  'This app talks to the robot over TCP. If the controller is in teach-pendant mode it may refuse commands; switch it to TCP mode when asked.':
    '本应用通过 TCP 与机械臂通信。控制器处于示教器模式时可能拒绝命令，请按提示切换到 TCP 模式。',
  'Touch Tool': '触控工具',
  'Tell us how the stylus is mounted and how long it is. The robot uses this to find the tip.':
    '告诉我们触控笔的安装方式和长度，机械臂用它确定尖端位置。',
  'Measure from the flange origin to the contact tip, including the holder.':
    '从法兰坐标系原点量到接触尖端，包含支架。',
  'Most 4-axis setups point straight down.': '大多数 4 轴安装都是垂直向下。',
  'The flange origin is the reference face on the robot arm. The contact tip is the point that touches the screen. The tool weight is the total mass of the stylus, holder and adapters.':
    '法兰坐标系原点是机械臂上的参考面；接触尖端是实际接触屏幕的点。工具重量是触控笔、支架和转接件的总质量。',
  'Measure the flat area the robot will touch. Use the same area the camera will see.':
    '测量机械臂将要触摸的平面区域，并让相机看到同一区域。',
  'Measure the touch area, not the whole device body.':
    '测量有效触控区域，而不是整个设备外壳。',
  'Keep the screen flat. This robot can only reach a nearly level screen.':
    '尽量放平屏幕，本机型只能可靠到达接近水平的屏幕。',
  'The recommended press depth and safe height keep the stylus on the glass without pressing hard. The screen resolution is set automatically when the camera is mapped.':
    '推荐的按压深度和安全高度能让触控笔接触玻璃而不过度用力。屏幕分辨率会在相机映射时自动设置。',
  'Place the camera above the screen and confirm it sees the whole touch area.':
    '将相机放在屏幕上方，确认它能看见完整触控区域。',
  'Do not move the camera after this step.': '完成此步骤后不要再移动相机。',
  'Top-left, right and down in the image must match the screen.':
    '画面中的左上、向右和向下方向必须与屏幕一致。',
  'Perspective correction maps the four screen corners to a rectangle. Camera mapping records that this corrected image matches the physical screen.':
    '透视校正是把屏幕四角映射为矩形；相机映射记录校正画面与物理屏幕的对应关系。',
  'The robot will touch five points, then run a slow hover and touch check around the border.':
    '机械臂会先触摸 5 个点，然后沿边界慢速执行悬停和接触检查。',
  'Keep the area clear and the emergency stop within reach.':
    '保持工作区域清空，并让急停按钮触手可及。',
  'Use Drag Mode to move the arm by hand when the task asks you to position it.':
    '任务要求定位时，可使用拖动模式手动移动机械臂。',
  'Five distributed points fit the screen plane. Hover verification checks the border without touching; contact verification checks the press depth and the closed edge path.':
    '5 个分散点用于拟合屏幕平面；悬停验证在不接触的情况下检查边界，接触验证检查按压深度和闭合沿边路径。',
  'Set Up Touch Tool': '配置触控工具',
  'Measure Screen': '测量屏幕',
  'Map Camera': '映射相机',
  'Calibrate Screen': '标定屏幕',
  Screen: '屏幕',
  'Camera Mapping': '相机映射',
  'Screen Calibration': '屏幕标定',
  'Learn more': '了解更多',
  'How to {0}': '如何{0}',
  Flange: '法兰',
  'Contact Tip': '接触尖端',
  'Screen Width': '屏幕宽度',
  'Screen Height': '屏幕高度',
  'Stylus Length': '触控笔长度',
  Connected: '已连接',
  'Not connected': '未连接',
  'Change Connection': '更换设备 / 修改地址',
  Connect: '连接',
  Cancel: '取消',
  'Robot arm': '机械臂',
  'Saved controller address': '已保存的控制器地址',
  'Robot connection interrupted': '机械臂连接已中断',
  'Saved settings are kept. Reconnect the robot to make changes.':
    '已保留保存的设置，重新连接机械臂后才能修改。',
  Disable: '下使能',
  'Custom Mounting': '自定义安装方式',
  'This tool has an offset or angled mounting. Review the measured values before continuing.':
    '此工具存在偏移或倾斜安装，继续前请核对测量值。',
  'Offset: {0} mm': '偏移：{0} mm',
  'Contact direction: {0}': '接触方向：{0}',
  'Edit Custom Mounting': '编辑自定义安装方式',
  'Tool Mounting Direction': '工具安装方向',
  'Straight Down': '垂直向下',
  'Fixed for This Robot': '本机型固定',
  'A 4-axis arm keeps the stylus pointing straight down. You only need its length.':
    '4 轴机械臂的触控笔保持垂直向下，只需要填写长度。',
  'Stylus Length (mm)': '触控笔长度（mm）',
  'Advanced Tool Settings': '高级工具设置',
  'Screen Width (mm)': '屏幕宽度（mm）',
  'Screen Height (mm)': '屏幕高度（mm）',
  'Contact Settings': '接触设置',
  Recommended: '推荐',
  'Use the recommended contact settings ({0} mm press, {1} mm safe height).':
    '使用推荐接触设置（按压 {0} mm，安全高度 {1} mm）。',
  'I have checked these custom contact settings.':
    '我已检查这些自定义接触设置。',
  'The stylus presses {0} mm into the screen and rises {1} mm between touches.':
    '触控笔会压入屏幕 {0} mm，两次触摸之间抬起 {1} mm。',
  'Custom contact settings: {0} mm press, {1} mm safe height.':
    '自定义接触设置：按压 {0} mm，安全高度 {1} mm。',
  'Edit Custom Contact Settings': '编辑自定义接触设置',
  'Screen resolution is set automatically in Camera Mapping. Do not enter pixel dimensions here.':
    '屏幕分辨率会在相机映射步骤自动设置，这里无需填写像素尺寸。',
  'Advanced Screen Settings': '高级屏幕设置',
  'Advanced Settings': '高级设置',
  Advanced: '高级',
  Close: '关闭',
  'Save Advanced Changes': '保存高级设置',
  'Discard Draft': '放弃草稿',
  Discard: '放弃',
  Configuration: '配置',
  Robot: '机械臂',
  Tool: '工具',
  'Open Advanced': '打开高级设置',
  'Reconnect the robot to make changes.': '重新连接机械臂后才能修改。',
  'Saved settings can still be reviewed. The current draft is kept.':
    '仍可查看已保存设置，当前草稿会保留。',
  'The adapter changed. Reopen Setup before saving.':
    '适配器已改变，保存前请重新打开配置。',
  'Multiple {0} Profiles are available. Choose one in Advanced settings.':
    '存在多个{0}配置，请在高级设置中选择一个。',
  'Setup is not ready.': '配置尚未准备好。',
  'Confirm the contact settings before saving.': '保存前请确认接触设置。',
  'Select the mounting direction that matches your installation.':
    '请选择与当前安装一致的安装方向。',
  'Enter a nonnegative measured origin-to-tip length.':
    '请输入非负的实测原点至尖端长度。',
  'Save and Continue': '保存并继续',
  'Ready to Test': '可以开始测试',
  'Continue Setup': '继续配置',
  'The robot, camera and screen are configured.':
    '机械臂、相机和屏幕已配置完成。',
  'Complete the remaining steps. Saved settings are kept and can be reviewed here.':
    '完成剩余步骤。已保存设置会保留，并可在此查看。',
  'Unsaved draft': '未保存草稿',
  'Start Testing': '开始测试',
  'Something moved?': '设备位置有变化？',
  'Save or discard the current draft before recording a move.':
    '记录位置变化前，请先保存或放弃当前草稿。',
  'Choose what physically moved. Only the affected mapping or calibration needs attention.':
    '选择实际移动的设备，仅需处理受影响的映射或标定。',
  'Camera Position Changed': '相机位置已改变',
  'Robot Position Changed': '机械臂位置已改变',
  'Screen Position Changed': '屏幕位置已改变',
  'Camera movement requires checking perspective correction and confirming camera mapping. Mechanical calibration is retained.':
    '相机移动后需要检查透视校正并重新确认相机映射，机械标定保留。',
  'Robot movement requires mechanical recalibration. Camera mapping is retained.':
    '机械臂移动后需要重新机械标定，相机映射保留。',
  'Screen movement requires both camera mapping and mechanical recalibration.':
    '屏幕移动后需要重新处理相机映射和机械标定。',
  'Not set up': '未配置',
  'Not mapped': '未映射',
  'Not calibrated': '未标定',
  'Main Camera': '主相机',
  'Detect Screen': '检测屏幕',
  'Edit Corners': '编辑四角',
  'Load Corrected Preview': '加载校正预览',
  'Confirm Camera Mapping': '确认相机映射',
  'Camera Mapping Confirmed': '相机映射已确认',
  'The corrected image must show the whole touch area. Top-left, right and down must match the screen.':
    '校正画面必须包含完整触控区域，左上、向右和向下方向必须与屏幕一致。',
  'The camera sees the whole touch area and matches the screen orientation.':
    '相机能看到完整触控区域，且方向与屏幕一致。',
  'Corrected camera preview for mapping': '用于确认映射的校正相机画面',
  'Setting the screen resolution from the camera…':
    '正在根据相机设置屏幕分辨率…',
  'Loading the corrected preview…': '正在加载校正预览…',
  'No camera is available.': '当前没有可用相机。',
  'You can finish the physical setup without a camera, but visual touch actions require one.':
    '可以在没有相机的情况下完成物理配置，但视觉触控需要相机。',
  'Measure the screen before mapping the camera.': '请先测量屏幕，再映射相机。',
  'Detect the screen corners to create a perspective preset.':
    '检测屏幕四角以创建透视预设。',
  'The camera output is {0} × {1} px. Update the screen resolution before confirming.':
    '相机输出为 {0} × {1} px，确认映射前请更新屏幕分辨率。',
  'Update Screen Resolution': '更新屏幕分辨率',
  'Save the screen configuration before confirming mapping.':
    '确认映射前，请先保存屏幕配置。',
  'Open Cameras': '打开相机',
  Retry: '重试',
  'Continue Without Camera': '暂不使用相机，继续',
  Continue: '继续',
  'Exit Setup': '退出配置',
  'Setup Overview': '配置总览',
  'Step {0} of {1}': '第 {0} 步，共 {1} 步',
  'Step {0}: {1}': '第 {0} 步：{1}',
  'Everything is configured. Start testing when you are ready.':
    '全部配置已完成，可以开始测试。',
  'Finish the remaining steps, then start testing.': '完成剩余步骤后开始测试。',
  Overview: '总览',
  'Save the touch tool and screen before starting calibration.':
    '开始标定前，请先保存触控工具和屏幕配置。',
  'Arm service offline': '机械臂服务离线',
  'Start the arm service, then retry.': '请启动机械臂服务后重试。',
  'Checking arm service': '正在检查机械臂服务',
  'Loading saved configuration…': '正在加载已保存配置…',
  'Touch at least five points on the screen': '在屏幕上点击至少五个点',
  'Mark the top-left corner': '标记左上角',
  'Mark the right edge': '标记右侧边缘',
  'Record a safe position': '记录安全位置',
  'Record safe position': '记录安全位置',
  'Hover verification': '悬停验证',
  'Contact verification': '接触验证',
  'Save this contact point': '保存此接触点',
  'Run hover verification': '运行悬停验证',
  'Run contact verification': '运行接触验证',
  'Looks right, continue': '正确，继续',
  'Try again': '重试',
  'Save calibration and finish': '保存标定并完成',
  'Mark the screen': '确定屏幕位置',
  'Finish Robot Setup': '完成机械臂配置',
  Samples: '采样点',
  Busy: '忙',
  Calibrating: '标定中',
  Paused: '已暂停',
  Refresh: '刷新',
  Disabled: '已下使能',
  Enable: '使能',
  Errors: '错误',
  'Drag Mode': '拖动模式',
  Normal: '正常',
  Unconfirmed: '待确认',
  'Recovering…': '正在恢复…',
  'The robot is confirming a safe stop before continuing.':
    '机械臂正在确认安全停止，随后继续。',
  'Tool Weight (kg)': '工具重量（kg）',
  'Weigh the stylus, holder and adapters together. Supported mass: {0}–{1} kg. The weight is applied when the robot is enabled.':
    '将触控笔、支架和转接件一起称重。支持质量：{0}–{1} kg。使能机械臂时会应用该重量。',
  'Configure in the terminal → Connect in the browser':
    '终端配置网络 → 网页连接机械臂',
  'Setup illustration': '配置示意图',
  'Discard this draft and restore the saved configuration?':
    '放弃此草稿并恢复已保存的配置？',
  'The controller may be in teach-pendant mode. Switch it to TCP mode before reconnecting.':
    '控制器可能处于示教器模式，请先切换到 TCP 模式再重新连接。',
};

export const zh: Record<string, string> = {
  'Before Running a Task': '开始任务前',
  'Enable the robot to run AI tasks.': '请先上使能机械臂，再开始 AI 任务。',
  'You can write your task now. Enable the robot before sending it.':
    '可以先填写任务内容，上使能后再发送。',
  'Your draft is kept while you prepare the robot.':
    '完成准备后即可发送，已填写的任务内容会保留。',
  'Wait for the current robot operation to finish.':
    '当前操作结束后即可发送任务。',
  'Review Robot Controls': '查看机械臂控制',

  Control: '控制',
  'Release to Execute': '松开执行',
  'Preparing Action': '准备执行',
  'Executing Action': '执行中',
  'Action Completed': '操作完成',
  'Action Failed': '操作失败',
  'Control context changed. Enable control again.':
    '控制配置已改变，请重新开启控制。',
  'Click to tap, hold for at least 500 ms to long press, or drag across the screen edges to swipe. Gestures execute on release.':
    '单击执行点击，按住至少 500 ms 执行长按，也可跨屏幕边缘拖动执行滑动。手势在松开后执行。',
  'Complete screen calibration and camera mapping, and make the robot motion ready to enable control.':
    '完成屏幕标定和相机映射，并使机械臂就绪后，即可开启控制。',

  ...robotSetupZh,
  ...calibrationZh,
  System: '跟随系统',
  'Follow the system theme': '跟随系统主题',
  Light: '浅色',
  'Light Theme': '浅色主题',
  Dark: '深色',
  'Dark Theme': '深色主题',
  'Camera configuration is locked during a robot operation.':
    '机械臂操作期间无法修改相机配置。',
  'The camera did not start within 30 seconds; try again':
    '相机未能在 30 秒内启动，请重试',
  'Camera settings are locked during a robot operation.':
    '机械臂操作期间无法修改相机设置。',
  'Multiple offline camera profiles use this name. Remove or rename the stale profiles first.':
    '多个离线相机配置使用了此名称，请先移除旧配置或重命名。',
  'Perspective correction has no screen corners': '透视校正缺少屏幕角点',
  'The main camera is locked during a robot operation.':
    '机械臂操作期间无法切换主相机。',
  'Midscene logo': 'Midscene 标志',
  'Midscene Robot Playground': 'Midscene Robot Playground',
  'Service Status': '服务状态',
  'Vision connected': '视觉服务已连接',
  'Vision disconnected': '视觉服务未连接',
  Cameras: '相机',
  'Camera View': '相机视图',
  Stage: '主视图',
  Grid: '网格',
  'Restart All Cameras': '重启所有相机',
  'Start All Cameras': '启动所有相机',
  Photos: '照片',
  'Perspective Presets': '透视预设',
  Appearance: '外观',
  'Color Theme': '颜色主题',
  'Tools & Settings': '工具与设置',
  'More Tools': '更多工具',
  'Wait for the camera configuration to finish before starting a task.':
    '请等待相机配置完成后再启动任务。',
  'A robot operation is running. Stop it before starting another task.':
    '机械臂正在操作，请先停止当前操作再启动其他任务。',
  'Live preview is open in robot setup or calibration.':
    '实时预览已在机械臂配置或标定中打开。',
  'No online camera to show': '没有可显示的在线相机',
  'Presets are locked during a robot operation.':
    '机械臂操作期间无法修改预设。',
  'Plan and run a short instruction on the Android device':
    '在 Android 设备上规划并执行简短指令',
  'What do you want to do?': '你想执行什么操作？',
  'Return the coordinates of an element on the Android screen':
    '返回 Android 屏幕上元素的坐标',
  'Which element should be located?': '要定位哪个元素？',
  'Ask a question about the current Android screen':
    '针对当前 Android 屏幕提问',
  'What do you want to ask?': '你想问什么？',
  'Check that a condition holds on the Android screen':
    '检查 Android 屏幕是否满足条件',
  'What should be true?': '应满足什么条件？',
  'Extract structured data from the Android screen':
    '从 Android 屏幕提取结构化数据',
  'What data should be extracted?': '要提取什么数据？',
  'Get a true or false answer about the Android screen':
    '针对 Android 屏幕获取布尔值答案',
  'What should be answered with true or false?': '要判断什么是否成立？',
  'Extract a numeric value from the Android screen': '从 Android 屏幕提取数值',
  'Which number should be read?': '要读取哪个数值？',
  'Extract a text value from the Android screen': '从 Android 屏幕提取文本',
  'Which text should be read?': '要读取什么文本？',
  'Wait until a condition holds on the Android screen':
    '等待 Android 屏幕满足条件',
  'What are you waiting for?': '要等待什么条件？',
  'Robot arm': '机械臂',
  'An Android device and camera are required': '需要 Android 设备和相机',
  'Describe what to do, ask, or check first':
    '请先描述要执行、询问或检查的内容',
  'The service returned no event stream': '服务未返回事件流',
  'Use This Model': '使用此模型',
  'Model Settings': '模型设置',
  'Kept in this browser only; never written to a camera or robot profile.':
    '仅保存在此浏览器中，不会写入相机或机械臂配置。',
  'Use Custom Model': '使用自定义模型',
  'Paste Model Environment Variables': '粘贴模型环境变量',
  'Paste a MIDSCENE_MODEL_* block here. Matching variables fill the fields below; OPENAI_API_KEY and OPENAI_BASE_URL are also supported.':
    '在此粘贴 MIDSCENE_MODEL_* 配置，匹配的变量会自动填入下方字段；也支持 OPENAI_API_KEY 和 OPENAI_BASE_URL。',
  'No supported model variables found.': '没有找到支持的模型变量。',
  'Filled {0} model settings.': '已填入 {0} 项模型设置。',
  'Model Name': '模型名称',
  'Model Family': '模型系列',
  'Model family, e.g. qwen3.6': '模型系列，例如 qwen3.6',
  'Base URL': '基础 URL',
  'Model Base URL': '模型基础 URL',
  'OpenAI compatible base URL': '兼容 OpenAI 的基础 URL',
  'API Key': 'API Key',
  'Model API Key': '模型 API Key',
  'An API Key is configured on the service.': '服务已配置 API Key。',
  'No API Key on the service; set MIDSCENE_MODEL_API_KEY or use a custom model.':
    '服务未配置 API Key，请设置 MIDSCENE_MODEL_API_KEY 或使用自定义模型。',
  'The service has no MIDSCENE_MODEL_* configuration. Set it on the Robot Vision server, or switch on a custom model for this session.':
    '服务未配置 MIDSCENE_MODEL_*，请在 Robot Vision 服务端配置，或为本次会话启用自定义模型。',
  'Clear Stored Model Settings': '清除已保存的模型设置',
  'Android AI playground': 'Android AI Playground',
  'ADB Device': 'ADB 设备',
  'ADB device for AI test': '用于 AI 测试的 ADB 设备',
  'size unavailable': '尺寸不可用',
  'Select an ADB device': '选择 ADB 设备',
  Camera: '相机',
  'Camera for AI test': '用于 AI 测试的相机',
  'Select a camera': '选择相机',
  'Refresh ADB Devices': '刷新 ADB 设备',
  'Android Playground': 'Android Playground',
  'Android device': 'Android 设备',
  'No camera with perspective correction available': '没有已完成透视校正的相机',
  'No Android device to run against': '没有可执行任务的 Android 设备',
  'Open Perspective Correction for a camera and save the result before running AI.':
    '运行 AI 前，请打开相机的透视校正并保存结果。',
  'Connect an Android device with USB debugging enabled, then refresh the device list.':
    '请连接已启用 USB 调试的 Android 设备，然后刷新设备列表。',
  'Place the four corners of the screen.': '请设置屏幕的四个角点。',
  Close: '关闭',
  'Save Perspective Preset': '保存透视预设',
  'Detect Screen Again': '重新检测屏幕',
  'Use This Result': '使用此结果',
  'Perspective correction is active. Detect the screen again to update it.':
    '透视校正已启用，可重新检测屏幕以更新。',
  'Align the four rings with the screen corners; the live preview follows completed edits.':
    '将四个圆环对齐屏幕角点，完成编辑后实时预览会更新。',
  'Align the four rings with the screen corners, then update the preview.':
    '将四个圆环对齐屏幕角点，然后更新预览。',
  'Compare the outline with the preview before applying.':
    '应用前请对照轮廓检查预览。',
  'Live Preview': '实时预览',
  'Edit Corners': '编辑角点',
  'Reset Corners': '重置角点',
  'These corners cannot be used yet': '这些角点暂不可用',
  Original: '原始画面',
  'Loading the camera frame…': '正在加载相机图像帧…',
  'Screen outline': '屏幕轮廓',
  'Drag a corner, or double-click to move the nearest corner':
    '拖动角点，或双击移动最近的角点',
  'Original live view with screen corners': '带屏幕角点的原始实时画面',
  'Original frame with screen corners': '带屏幕角点的原始图像帧',
  'Refresh Frame': '刷新图像帧',
  Corrected: '校正画面',
  'Preview updates when corner editing ends': '角点编辑完成后更新预览',
  'Select Update Preview to apply perspective correction':
    '选择“更新预览”以应用透视校正',
  'Corrected · Live': '校正画面 · 实时',
  'Corrected · Frame': '校正画面 · 单帧',
  'Update Preview': '更新预览',
  'Output Size and Correction Details': '输出尺寸与校正详情',
  Corners: '角点',
  'Output Size': '输出尺寸',
  'Output Size Preset': '输出尺寸预设',
  'Custom size': '自定义尺寸',
  Width: '宽度',
  'Output Width (px)': '输出宽度 (px)',
  Height: '高度',
  'Output Height (px)': '输出高度 (px)',
  'Output Rotation': '输出旋转',
  'The screen lies on its side: pick 90° or 270° so the result comes out upright.':
    '屏幕处于横放状态，请选择 90° 或 270° 使输出画面直立。',
  'Perspective Preset': '透视预设',
  'Selected View': '当前视图',
  'View Camera': '查看相机',
  'Actual Frame Rate': '实际帧率',
  'AI Auto Detect': 'AI 自动检测',
  'Adjust the four corners': '请调整四个角点',
  'Corrected View': '校正画面',
  'Camera Profile': '相机配置',
  'Starting camera…': '正在启动相机…',
  'Camera is not connected': '相机未连接',
  'Camera could not be started': '相机启动失败',
  'Camera stopped': '相机已停止',
  'Waiting for the service': '正在等待服务',
  Capture: '拍照',
  'Perspective Correction': '透视校正',
  'Open Last Photo': '打开最近一张照片',
  'Stop Camera': '停止相机',
  'Retry this camera': '重试此相机',
  'Start this camera': '启动此相机',
  'The camera is not connected': '相机未连接',
  Retry: '重试',
  Start: '启动',
  'Detection quality': '检测质量',
  '% · confirm before use': '% · 使用前请确认',
  'Perspective Correction Details': '透视校正详情',
  'Corrected preview available. Open Perspective Correction to review the result.':
    '校正预览已就绪，请打开透视校正检查结果。',
  'Clear perspective correction, output size, and detected corners for this camera. Saved presets are kept.':
    '清除此相机的透视校正、输出尺寸及检测角点，保留已保存的预设。',
  'Clear Perspective Correction': '清除透视校正',
  Clear: '清除',
  Save: '保存',
  'Camera Name': '相机名称',
  'Unique camera name, for example main-display or left-tablet.':
    '唯一的相机名称，例如 main-display 或 left-tablet。',
  'Camera Display Name': '相机显示名称',
  Label: '标签',
  'Camera Label': '相机标签',
  'New settings apply the next time this camera starts.':
    '新设置将在下次启动相机时生效。',
  'The camera is offline; the profile is kept for the next connection.':
    '相机已离线，配置将保留至下次连接。',
  'Capture Settings': '采集设置',
  'Capture Width': '采集宽度',
  'Capture Height': '采集高度',
  'Capture Frame Rate': '采集帧率',
  'Mirrors the picture in the capture itself, so screen detection and perspective correction see the same orientation the operator does. A running stream is updated immediately.':
    '直接镜像采集画面，使屏幕检测和透视校正与操作人员看到的方向一致。正在运行的流会立即更新。',
  Flip: '翻转',
  'Camera Flip': '相机翻转',
  'Camera Stage': '相机主视图',
  'No stream': '没有视频流',
  'Preview Mode': '预览模式',
  'Open This Camera': '打开此相机',
  'Start Camera': '启动相机',
  Refresh: '刷新',
  'Save screen corners, output size, and rotation as a reusable perspective preset.':
    '将屏幕角点、输出尺寸和旋转保存为可复用的透视预设。',
  'No perspective presets yet': '暂无透视预设',
  'Yes, Delete': '确认删除',
  'Delete this perspective preset?': '删除此透视预设？',
  Delete: '删除',
  'Photo Gallery': '照片库',
  'No photo captured yet': '尚未拍摄照片',
  Open: '打开',
  'Delete this photo?': '删除此照片？',
  'Stop the robot and prevent further motion. This does not stop the backend services.':
    '停止机械臂并阻止后续运动，后台服务将继续运行。',
  'Stop Robot': '停止机械臂',
  'Send an emergency stop command to the robot controller.':
    '向机械臂控制器发送紧急停止指令。',
  'Emergency Stop': '紧急停止',
  'Motion ready': '运动就绪',
  'Loading camera and perspective presets…': '正在加载相机与透视预设…',
  'Resume setup': '继续配置',
  'Set Up Robot': '配置机械臂',
  'Calibrate Screen': '标定屏幕',
  'Map Camera': '映射相机',
  'Discard unsaved Profile changes?': '放弃未保存的配置修改？',
  'Your draft has not been saved.': '草稿尚未保存。',
  Discard: '放弃',
  'Select a Screen Profile first.': '请先选择屏幕配置。',
  'Load and inspect the current corrected preview first.':
    '请先加载并检查当前校正预览。',
  'Drag mode active outside a session': '当前已在会话外启用拖动模式',
  'Exit Drag Mode': '退出拖动模式',
  'Robot fault': '机械臂故障',
  'Clear faults without enabling or moving?':
    '清除故障？此操作不会使能或移动机械臂。',
  'Clear Faults': '清除故障',
  'Recovery required': '需要恢复',
  'Confirm the arm is stopped, then check recovery. The interrupted action will not be replayed.':
    '确认机械臂已停止后执行恢复检查，不会重试已中断的操作。',
  Reconnect: '重新连接',
  Connect: '连接',
  Disable: '下使能',
  'Enable this arm? Keep people clear of its workspace.':
    '使能此机械臂？请确保人员远离工作空间。',
  Enable: '使能',
  'Tool payload application unconfirmed — reconnect':
    '工具负载应用未确认 — 请重新连接',
  'Apply the saved tool payload?': '应用已保存的工具负载？',
  'Apply Saved Tool Payload': '应用已保存的工具负载',
  'Pause the robot and terminate the current action.':
    '暂停机械臂并终止当前动作。',
  'Pause Robot': '暂停机械臂',
  'Allow new actions after recovery. The interrupted action is not replayed.':
    '恢复后允许执行新动作，不会重放已中断的动作。',
  'Resume Controls': '恢复控制',
  'Cancel the current action and lift the tool safely if possible.':
    '取消当前动作，并在可行时安全抬起工具。',
  'Cancel Action': '取消动作',
  'Robot Setup': '机械臂配置',
  'Robot Arm': '机械臂',
  '· Configuration': '· 配置',
  'Back to Playground': '返回 Playground',
  'Robot Setup Progress': '机械臂配置进度',
  'Touch Tool': '触控工具',
  Screen: '屏幕',
  Overview: '概览',
  'Configuration does not move the robot.': '配置操作不会移动机械臂。',
  'Main Camera': '主相机',
  'Setup Preview Mode': '配置预览模式',
  'Camera preview unavailable': '相机预览不可用',
  'Follow the current step in the panel beside the preview.':
    '请按预览旁面板中的当前步骤操作。',
  Configuration: '配置',
  'Robot status is unavailable. Check the arm service; no calibration or visual confirmation has been deleted.':
    '机械臂状态不可用，请检查机械臂服务。标定及相机映射确认均已保留。',
  'Screen calibration': '屏幕标定',
  'Camera mapping': '相机映射',
  Controller: '控制器',
  'attention required': '需要处理',
  'Complete Verification': '完成验证',
  'Open Calibration': '打开标定',
  'Payload Controls': '负载控制',
  'Connection Controls': '连接控制',
  'Controller Controls': '控制器控制',
  'Review Camera Mapping': '检查相机映射',
  'Import Previous Browser Selection (Visual Confirmation Required)':
    '导入之前的浏览器选择（需要视觉确认）',
  'Position Changed': '位置已变化',
  'Main camera:': '主相机：',
  None: '无',
  'Installation saved — configure the perspective correction output size and save its pixel dimensions before confirming camera mapping.':
    '安装配置已保存 — 请先设置透视校正输出尺寸并保存像素尺寸，再确认相机映射。',
  'Load Corrected Preview': '加载校正预览',
  'Perspective-corrected screen for axis confirmation':
    '用于轴向确认的透视校正屏幕',
  'Confirm this camera maps top-left / right / down to the selected screen?':
    '确认此相机的左上角、向右、向下方向与所选屏幕对应？',
  'Confirm Camera Mapping': '确认相机映射',
  'Camera Mapping': '相机映射',
  'Camera mapping not confirmed': '相机映射未确认',
  'Matching Calibration': '匹配的标定',
  'Calibration Profile': '标定配置',
  'Select calibration': '选择标定',
  '· Verification:': '· 验证：',
  'Open Screen Calibration': '打开屏幕标定',
  'Invalidate calibration because installation or screen moved?':
    '因安装或屏幕移动而使标定失效？',
  'Invalidate Calibration': '使标定失效',
  Calibrate: '标定',
  'Advanced Settings': '高级设置',
  'Arm service unavailable. Vision and Android AI remain available.':
    '机械臂服务不可用，视觉和 Android AI 仍可使用。',
  'Robot Arm Setup': '机械臂配置',
  'Screen Calibration': '屏幕标定',
  'Main camera unavailable': '主相机不可用',
  'Calibration Preview Mode': '标定预览模式',
  'Robot Arm AI Playground': '机械臂 AI Playground',
  'Robot Arm Playground': '机械臂 Playground',
  'Set up your robot to start': '请先配置机械臂',
  'Start Setup': '开始配置',
  'Save and Apply': '保存并应用',
  'Letters, digits, dots, dashes, and underscores; 64 characters maximum.':
    '支持字母、数字、点、短横线和下划线，最多 64 个字符。',
  'Preset Name': '预设名称',
  'Saved Cameras': '已保存的相机',
  'These profiles belong to cameras that are not currently connected. They may be rebound to a newly enumerated camera when the names match.':
    '这些配置属于当前未连接的相机。名称匹配时，可重新绑定到新发现的相机。',
  'No offline camera profiles': '没有离线相机配置',
  Remove: '移除',
  'Perspective corrected': '已透视校正',
  'Preview only': '仅预览',
  'Only perspective-corrected cameras are used for AI; other cameras are preview-only.':
    '仅显示已透视校正的相机；其他相机只用于预览。',
  'Same-name cameras without perspective correction are preview-only and do not affect AI runs.':
    '同名但未透视校正的相机仅用于预览，不影响 AI 运行。',
  'Another camera uses this name. Saving will use the unique name {0}.':
    '另一台相机使用了该名称，保存时将使用唯一名称“{0}”。',
  'Screen boundary': '屏幕边界',
  Service: '服务',
  'The console and the service share one origin, so this path is fixed.':
    '控制台与服务使用同一源，此路径固定。',
  'Camera Discovery': '相机发现',
  'Show Mac Built-in Cameras': '显示 Mac 内置相机',
  'Mac built-in cameras are hidden by default. External cameras start automatically.':
    'Mac 内置相机默认隐藏，外接相机会自动启动。',
  'Show Connected iPhone Cameras': '显示已连接的 iPhone 相机',
  'Off by default. Turn this on to add an iPhone Continuity Camera.':
    '默认关闭，开启后可添加 iPhone 连续互通相机。',
  'Default Capture Settings': '默认采集设置',
  'Default Width': '默认宽度',
  'Default Height': '默认高度',
  'Default Frame Rate': '默认帧率',
  'A camera profile overrides these defaults. Both apply the next time a camera starts.':
    '相机配置会覆盖这些默认值，均在下次启动相机时生效。',
  'Screen Detection': '屏幕检测',
  'Refresh Cameras': '刷新相机',
  Ready: '就绪',
  'Not ready': '未就绪',
  'Accepting work': '可接收任务',
  Idle: '空闲',
  Uptime: '运行时间',
  Streams: '视频流',
  'ready of': '就绪，总数',
  'not enumerated yet': '尚未枚举',
  'Device Cache': '设备缓存',
  Preview: '预览',
  Counters: '计数',
  'none yet': '暂无',
  Started: '启动时间',
  'The service reports a degraded state.': '服务报告降级状态。',
  'Playground Panel': 'Playground 面板',
  'AI Task': 'AI 任务',
  Inspector: '检查器',
  'Control Method': '控制方式',
  '· timing warning': '· 时序警告',
  'Contact window': '接触时长',
  'not measurable': '无法测量',
  'hold target': '保持时长目标',
  'hold overrun': '保持超时',
  'Action incomplete · safe release confirmed': '动作未完成 · 已确认安全释放',
  'Action failed · recovery required': '动作失败 · 需要恢复检查',
  'Action failed': '动作失败',
  'Select matching active calibration and confirmed camera mapping':
    '请选择匹配的有效标定和已确认的相机映射',
  'These gestures physically touch the screen. Confirm setup and camera mapping before testing.':
    '这些手势会实际接触屏幕，测试前请确认配置和相机映射。',
  'This adapter does not support screen actions.': '此适配器不支持屏幕动作。',
  'Test Gesture': '测试手势',
  'Override Profile Long Press': '覆盖配置中的长按时长',
  'Target Gesture Duration (ms)': '目标手势时长 (ms)',
  'Gesture Duration': '手势时长',
  'Execute Test': '执行测试',
  'Action Result Details': '动作结果详情',
  'Start a calibration session first': '请先启动标定会话',
  'Contact Plane Ready': '接触平面就绪',
  'Contact Plane': '接触平面',
  Observation: '观察位姿',
  Hover: '悬停',
  'Test Tap': '测试点击',
  Activate: '激活',
  'Session interrupted. Resolve hardware faults, exit Drag Mode, and complete a recovery check before starting a new session.':
    '会话已中断。请解决硬件故障、退出拖动模式并完成恢复检查，再启动新会话。',
  'Calibration activated.': '标定已激活。',
  'Position with Drag Mode or the vendor teach pendant. Capture at least five distributed contact points; then confirm the plane and screen axes.':
    '使用拖动模式或厂家示教器定位，采集至少五个分散的接触点，然后确认平面与屏幕轴向。',
  'Screen orientation must remain within the approved workspace.':
    '屏幕方向必须位于允许的工作空间内。',
  'Start Calibration': '开始标定',
  'Reuse captured screen geometry and repeat hover and test tap verification.':
    '复用已采集的屏幕几何，重新进行悬停和测试点击验证。',
  'Position the tool at the requested location. Exit Drag Mode before verification motion.':
    '将工具定位到指定位置，执行验证运动前请退出拖动模式。',
  'Enter Drag Mode? Keep the workspace clear.':
    '进入拖动模式？请确保工作空间内无人员和障碍物。',
  'Enter Drag Mode': '进入拖动模式',
  'Drag mode is unavailable. Use the vendor teach pendant for manual positioning.':
    '拖动模式不可用，请使用厂家示教器手动定位。',
  'Capture at least five contact points spread across the screen. Samples:':
    '请采集至少五个分布于屏幕各处的接触点。样本数：',
  'Checking the contact plane against the captured points.':
    '正在根据采集点检查接触平面。',
  'Plane fitted from the current points': '已根据当前采集点拟合平面',
  'Capture Actual Contact Point': '采集实际接触点',
  'Refit Plane & Refresh Quality': '重新拟合平面并刷新质量',
  'Fit Plane & Review Quality': '拟合平面并检查质量',
  'Flip Inward Normal': '翻转内向法线',
  'Confirm inward normal, screen coverage and sample quality?':
    '确认内向法线、屏幕覆盖范围和样本质量？',
  'Confirm Inward Normal': '确认内向法线',
  'Position at P1, the top-left screen corner.': '定位到 P1，即屏幕左上角。',
  'Position at P2, right of P1 along the top edge.':
    '定位到 P2，即沿上边缘位于 P1 右侧的点。',
  'No actual pixel coordinates are required.': '无需提供实际像素坐标。',
  'Position at an observation pose clear of the screen.':
    '定位到远离屏幕的观察位姿。',
  'Capture Actual Observation Pose': '采集实际观察位姿',
  'Hover at the center and four inset corners (10% / 90%). Observe direction and coverage before accepting.':
    '在中心及四个内缩角点（10% / 90%）悬停，接受前请观察方向和覆盖范围。',
  'Run low-speed hover verification and return to observation?':
    '执行低速悬停验证并返回观察位姿？',
  'Run Center and Corners Hover': '执行中心与角点悬停',
  'Confirm Hover Direction and Coverage': '确认悬停方向与覆盖范围',
  'Reject Hover Result': '拒绝悬停结果',
  'Test a low-speed center tap. Confirm that the screen responded; rejected results cannot be activated.':
    '测试低速中心点击，并确认屏幕有响应。被拒绝的结果无法激活。',
  'Physically touch the screen center at low speed?':
    '以低速实际接触屏幕中心？',
  'Verify Test Tap': '验证测试点击',
  'Confirm Screen Responded to Test Tap': '确认屏幕已响应测试点击',
  'Reject Touch Result': '拒绝接触结果',
  'Motion verification and both human confirmations are complete.':
    '运动验证和两项人工确认均已完成。',
  'Activate Verified Calibration': '激活已验证的标定',
  'Exit Drag Mode Before Motion': '运动前请退出拖动模式',
  'Samples & Quality': '样本与质量',
  'Cancel Session (No Motion)': '取消会话（无运动）',
  'Closing this window keeps the session. Reopen it from the arm status bar.':
    '关闭此窗口会保留会话，可从机械臂状态栏重新打开。',
  'Enter a Profile ID and name.': '请输入配置 ID 和名称。',
  'Enter all measured values before saving.': '保存前请输入全部实测值。',
  'Joint boundaries must match the adapter joint count.':
    '关节边界必须与适配器关节数量一致。',
  'Supply both image dimensions as integers of at least 2, or leave both unset.':
    '请同时填写图像宽高，且为至少 2 的整数，或将两者均留空。',
  'Select supported unit': '选择支持的单位',
  'Ratio (0–1)': '比例 (0–1)',
  'Create New': '新建',
  'Enter measured geometry and motion parameters. Geometry changes invalidate calibration; motion settings require verification.':
    '请输入实测几何与运动参数。几何修改会使标定失效，运动设置修改需要重新验证。',
  'Fix the advanced JSON to resume form editing.':
    '请修正高级 JSON 后继续编辑表单。',
  'Profile ID': '配置 ID',
  Name: '名称',
  Unavailable: '不可用',
  'Fixed Installation': '固定安装',
  'Approved Joint Boundaries': '允许的关节边界',
  'unknown unit': '未知单位',
  'Measured Tool Offset (mm)': '实测工具偏移 (mm)',
  'Tool Contact Direction': '工具接触方向',
  'Pixel Width': '像素宽度',
  'Pixel Height': '像素高度',
  'Measured Width (mm)': '实测宽度 (mm)',
  'Measured Height (mm)': '实测高度 (mm)',
  'Press Depth (mm)': '按压深度 (mm)',
  'Safe Height (mm)': '安全高度 (mm)',
  'Tap Contact Time (ms)': '点击接触时长 (ms)',
  'Swipe Endpoint Hold (ms)': '滑动终点保持时长 (ms)',
  'Long Press (ms)': '长按时长 (ms)',
  'Drag Endpoint Hold (ms)': '拖拽终点保持时长 (ms)',
  'Successor Start Lead (ms)': '后继动作启动提前量 (ms)',
  'Release Speed Factor': '释放速度系数',
  'Release Acceleration Factor': '释放加速度系数',
  'Motion Timeout (ms)': '运动超时 (ms)',
  'Screen Direction': '屏幕方向',
  'Base Speed': '基础速度',
  'Base Acceleration': '基础加速度',
  'Advanced JSON & Metadata': '高级 JSON 与元数据',
  'Profile Configuration JSON': '配置 JSON',
  'Save Profile': '保存配置',
  'Unit Contact Direction': '接触方向单位向量',
  'Saved Profiles remain on the service. Unsaved changes to this Profile will be discarded.':
    '服务中已保存的配置会保留，当前配置未保存的修改将被丢弃。',
  'Replace the complete tool geometry?': '替换完整的工具几何？',
  'The current offset and direction cannot be represented by a straight axial tool. Choose a new direction and measured length.':
    '当前偏移和方向无法用直轴工具表示，请选择新的方向和实测长度。',
  'No compatible range available. Check adapter capabilities.':
    '没有兼容的范围，请检查适配器能力。',
  'Fix the advanced JSON before continuing.': '请先修正高级 JSON 再继续。',
  'The adapter changed. Reopen Setup to configure this installation.':
    '适配器已变化，请重新打开配置以设置此安装。',
  'Select the mounting direction that matches your installation.':
    '请选择与实际安装一致的安装方向。',
  'Enter a nonnegative measured origin-to-tip length.':
    '请输入非负的实测原点至尖端长度。',
  'Resolve the configuration warnings before saving.':
    '请先解决配置警告再保存。',
  'Waiting for the arm service and configuration…': '正在等待机械臂服务及配置…',
  'Not set': '未设置',
  'Reopen Setup for the current adapter.': '请为当前适配器重新打开配置。',
  Robot: '机械臂',
  'Tool Payload': '工具负载',
  Motion: '运动',
  'speed ·': '速度 ·',
  Contact: '接触',
  'mm press ·': 'mm 按压 ·',
  'mm clearance': 'mm 间隙',
  'Configuration draft': '配置草稿',
  'Current configuration': '当前配置',
  'The adapter changed. Reopen Setup before saving.':
    '适配器已变化，保存前请重新打开配置。',
  'Choose Configuration': '选择配置',
  'Unsaved configuration changes': '配置修改尚未保存',
  'Installation saved — camera mapping required':
    '安装配置已保存 — 需要相机映射',
  'Camera mapping confirmation required': '需要确认相机映射',
  'Touch setup complete': '触控配置已完成',
  'Screen calibration or verification needs attention — see the detailed status above':
    '屏幕标定或验证需要处理，请查看上方详细状态',
  'Complete Camera Mapping': '完成相机映射',
  'Return to Cameras': '返回相机',
  'Edit Tool': '编辑工具',
  'Edit Screen': '编辑屏幕',
  'Adjust Motion Parameters': '调整运动参数',
  'Choose how the tool is mounted, then measure from the flange origin to the contact tip.':
    '选择工具安装方式，然后测量法兰坐标系原点至接触尖端的距离。',
  'Straight Tool': '直轴工具',
  'Offset / Angled Tool': '偏移／倾斜工具',
  'Origin-to-Tip Length (mm)': '原点至尖端长度 (mm)',
  'Measure the effective touch area, including only the region you intend to control. Frame this same area in the camera.':
    '测量有效触控区域，仅包含你打算控制的范围，并在相机中框选相同区域。',
  'Measured Screen Width (mm)': '实测屏幕宽度 (mm)',
  'Measured Screen Height (mm)': '实测屏幕高度 (mm)',
  'Screen Pixel Width': '屏幕像素宽度',
  'Screen Pixel Height': '屏幕像素高度',
  'Screen coordinates:': '屏幕坐标：',
  'px. Source:': 'px。来源：',
  'perspective correction output size': '透视校正输出尺寸',
  'saved screen configuration': '已保存的屏幕配置',
  'manual entry': '手动输入',
  'You can leave both pixel dimensions unset and save the physical measurements now. Complete camera mapping before calibration.':
    '可以将两个像素尺寸均留空，先保存物理测量值。标定前请完成相机映射。',
  'Use the main camera target dimensions?': '使用主相机的目标尺寸？',
  'Changing screen geometry invalidates its calibration after saving.':
    '修改屏幕几何并保存后，其标定会失效。',
  'Use Camera Target Dimensions': '使用相机目标尺寸',
  'Motion Parameters': '运动参数',
  '· required values missing': '· 缺少必填值',
  'Reuse verified installation values or enter measured parameters. Saving does not enable or move the arm. Contact and press times are the window the tool spends on the glass, measured from the moment it arrives.':
    '复用已验证的安装值或输入实测参数。保存不会使能或移动机械臂。接触和按压时长指工具停留在玻璃上的时间，从到达时开始计算。',
  'Configuration Summary': '配置摘要',
  'Save Configuration': '保存配置',
  'Settings Saved': '设置已保存',
  'Save Changes': '保存修改',
  'Save and Finish Vision Later': '保存并稍后完成视觉配置',
  'Save and Open Calibration': '保存并打开标定',
  'Installation saved — camera mapping required. Physical measurements are retained; configure perspective correction and return to complete mapping.':
    '安装配置已保存 — 需要相机映射。物理测量值已保留，请配置透视校正后返回完成映射。',
  'Setup complete — calibration required': '配置已完成 — 需要标定',
  'Show Current Configuration': '显示当前配置',
  Back: '上一步',
  Next: '下一步',
  'Hide Advanced Settings': '隐藏高级设置',
  'Manage configurations, inspect full geometry and edit shared drafts. Geometry changes require calibration; contact settings require verification.':
    '管理配置、检查完整几何并编辑共享草稿。几何修改需要标定，接触设置修改需要验证。',
  Tool: '工具',
  'Installation Notes': '安装说明',
  'Pixel dimensions are changed explicitly in the Screen step or JSON.':
    '像素尺寸需在屏幕步骤或 JSON 中显式修改。',
  'JSON & Metadata': 'JSON 与元数据',
  'Profile must be an object.': '配置必须为对象。',
  'Profile metadata is read-only.': '配置元数据只读。',
  'Save all configuration changes? Geometry changes invalidate calibration.':
    '保存全部配置修改？几何修改会使标定失效。',
  'Save Advanced Changes': '保存高级修改',
  'Tool Mounting Direction': '工具安装方向',
  'Choose the drawing that matches your mounting. These axes belong to the flange.':
    '请选择与实际安装一致的示意图，这些坐标轴属于法兰坐标系。',
  Along: '沿',
  'Flange Origin': '法兰坐标系原点',
  'Contact Tip': '接触尖端',
  'End-Effector Total Mass (kg)': '末端执行器总质量 (kg)',
  'Weigh the holder, stylus and mounting adapters together. Supported mass:':
    '请将支架、触控笔与安装转接件一起称重。支持的质量：',
  'kg. Saving keeps a local configuration; it does not enable the robot. Apply changes using the controller controls.':
    'kg。保存仅保留本地配置，不会使能机械臂。请通过机械臂控制区应用修改。',
  'Advanced: Specify Measured Inertia': '高级：指定实测惯量',
  'Measured Payload Inertia (kg·m²)': '实测负载惯量 (kg·m²)',
  'Tool payload not required': '无需工具负载',
  'Tool payload required — open Setup': '需要工具负载 — 请打开配置',
  'Tool payload applied — command completion confirmed':
    '工具负载已应用 — 已确认指令完成',
  'Applying saved tool payload…': '正在应用已保存的工具负载…',
  'disable, then enable to apply': '下使能后重新使能以应用',
  'enable to apply': '使能以应用',
  'Tool payload parameters changed': '工具负载参数已变化',
  'Tool payload pending': '工具负载待应用',
  'after service restart': '服务重启后',
  'after disable': '下使能后',
  'after disconnect': '断开连接后',
  'after connection loss': '连接丢失后',
  'after controller restart': '控制器重启后',
  'after application failure': '应用失败后',
  'after interrupted application': '应用中断后',
  'after emergency stop': '紧急停止后',
  'because Stop could not be confirmed': '因无法确认停止',
  'Tool payload application unconfirmed — check controller state':
    '工具负载应用未确认 — 请检查控制器状态',
  'Leave blank to calibrate using the flange pose at contact.':
    '可留空。标定将使用笔尖接触屏幕时的法兰位姿。',
  'Enter a nonnegative measured length.': '请输入非负的实测长度。',
  'Touch tool': '触控工具',
  'Touch screen': '触摸屏',
  'Top-left / right / down; confirm during calibration':
    '左上／向右／向下，请在标定时确认',
  'contact direction component': '接触方向分量',
  'Tool contact direction must be a unit vector.':
    '工具接触方向必须为单位向量。',
  'end-effector total mass (kg)': '末端执行器总质量 (kg)',
  'This adapter does not support payload inertia.': '此适配器不支持负载惯量。',
  'measured payload inertia (kg·m²)': '实测负载惯量 (kg·m²)',
  'Supply both image dimensions as integers of at least 2, or leave both unset until camera mapping is configured.':
    '请同时填写图像宽高，且为至少 2 的整数，或将两者均留空，待相机映射时配置。',
  'measured screen width (mm)': '实测屏幕宽度 (mm)',
  'measured screen height (mm)': '实测屏幕高度 (mm)',
  'Robot Profile must identify the current adapter and connection.':
    '机械臂配置必须标识当前适配器与连接。',
  'Enter an installation description.': '请输入安装说明。',
  'Enter a screen direction description.': '请输入屏幕方向说明。',
  'press depth (mm)': '按压深度 (mm)',
  'Safe height must exceed the magnitude of a negative press depth.':
    '安全高度必须大于负按压深度的绝对值。',
  'safe height (mm)': '安全高度 (mm)',
  'contact time (ms)': '接触时长 (ms)',
  'swipe endpoint hold (ms)': '滑动终点保持时长 (ms)',
  'Swipe endpoint hold must be zero or between 30 and 1000 ms.':
    '滑动终点保持时长必须为零或介于 30 至 1000 ms。',
  'long press (ms)': '长按时长 (ms)',
  'drag endpoint hold (ms)': '拖拽终点保持时长 (ms)',
  'successor start lead (ms)': '后继动作启动提前量 (ms)',
  'motion timeout (ms)': '运动超时 (ms)',
  'Contact time': '接触时长',
  'Swipe endpoint hold': '滑动终点保持时长',
  'Long press': '长按',
  'Drag endpoint hold': '拖拽终点保持时长',
  'Successor start lead': '后继动作启动提前量',
  'Vision service is offline.': '视觉服务已离线。',
  'The main camera is offline or unavailable.': '主相机已离线或不可用。',
  'The main camera is not in the current camera list. Refresh cameras before confirming camera mapping.':
    '主相机不在当前相机列表中，请刷新相机后再确认相机映射。',
  'The main camera needs a valid perspective preset.':
    '主相机需要有效的透视预设。',
  'The perspective preset needs measured source dimensions.':
    '透视预设需要实测原始尺寸。',
  'Checking arm service': '正在检查机械臂服务',
  'Arm service offline': '机械臂服务已离线',
  'Controller initialization failed': '控制器初始化失败',
  'Controller disconnected': '控制器未连接',
  'Configuration incompatible': '配置不兼容',
  'Configuration unavailable': '配置不可用',
  'Capabilities unavailable': '能力信息不可用',
  'Controller state unavailable': '控制器状态不可用',
  'State stale': '状态已过期',
  Paused: '已暂停',
  Fault: '故障',
  'State unknown': '状态未知',
  'AI task running': 'AI 任务运行中',
  Calibrating: '标定中',
  Busy: '忙碌',
  'Drag mode active': '拖动模式已启用',
  Disabled: '未使能',
  'Not motion ready': '运动未就绪',
  'Robot arm Profile format does not match this console; rebuild service and establish configuration.':
    '机械臂配置格式与此控制台不匹配，请重新构建服务并建立配置。',
  'Every corner needs a numeric position.': '每个角点都需要数值坐标。',
  'The corners cross each other: keep them in the order top-left, top-right, bottom-right, bottom-left.':
    '角点相互交叉，请按左上、右上、右下、左下的顺序排列。',
  'No Label': '无标签',
  Front: '前',
  Left: '左',
  Right: '右',
  Top: '上',
  Bottom: '下',
  Vertical: '垂直',
  Horizontal: '水平',
  Both: '双向',
  'No frame yet': '暂无图像帧',
  Streaming: '传输中',
  Standard: '标准',
  'an edge snapped onto something else, kept the outline':
    '边缘吸附到其他物体，已保留轮廓',
  'the refined corners crossed, kept the outline':
    '优化后的角点交叉，已保留轮廓',
  'the refined corners left the area window': '优化后的角点超出区域窗口',
  'the screen is too small to re-snap': '屏幕太小，无法重新吸附',
  'the frame could not be re-read for the fine pass':
    '无法重新读取图像帧以进行精细处理',
  'the time budget was already spent': '已超出时间预算',
  Quality: '质量',
  Confidence: '置信度',
  Method: '方法',
  Area: '面积',
  Aspect: '宽高比',
  Tilt: '倾斜',
  Edges: '边缘',
  Fill: '填充',
  Outline: '轮廓',
  Score: '评分',
  Duration: '时长',
  Contrast: '对比度',
  Frames: '图像帧',
  Stability: '稳定性',
  Prior: '先验',
  'kept the outline': '已保留轮廓',
  'An offline {0} camera profile named "{1}" exists. Rebind its saved settings and perspective correction to this connected camera?':
    '已有名为“{1}”的离线 {0} 相机配置。将其设置和透视校正重新绑定到此已连接相机？',
  'Applied perspective preset {0}': '已应用透视预设 {0}',
  'Captured {0} photo{1}': '已拍摄 {0} 张照片',
  'Remove the saved profile for "{0}"? Its camera binding and capture settings will be removed, but perspective presets will be kept.':
    '移除“{0}”的已保存配置？相机绑定和采集设置将被移除，透视预设会保留。',
  'Removed the saved profile of {0}': '已移除 {0} 的配置',
  'Rebound the saved profile of {0}': '已重新绑定 {0} 的配置',
  'Saved the profile of {0}': '已保存 {0} 的配置',
  'Saved and applied perspective preset {0}': '已保存并应用透视预设 {0}',
  'Starting {0} camera{1}…': '正在启动 {0} 台相机…',
  'Unsupported {0} AI action: {1}': '不支持的 {0} AI 动作：{1}',
  '{0} run failed': '{0} 运行失败',
  'The {0} run ended without a result': '{0} 运行已结束，未返回结果',
  'The {0} run could not be started': '无法启动 {0} 运行',
  'Server model: {0}{1}': '服务端模型：{0}{1}',
  'Camera name "{0}" is used more than once. Rename the cameras before running AI.':
    '相机名称“{0}”重复，运行 AI 前请重命名相机。',
  '"{0}" has no running stream. Start it from its camera card before running a task.':
    '“{0}”没有正在运行的视频流，请先在相机卡片中启动，再运行任务。',
  'ADB display size unavailable: {0}': 'ADB 显示尺寸不可用：{0}',
  'Perspective Correction · {0}': '透视校正 · {0}',
  'Camera frame with the screen outline for {0}': '带 {0} 屏幕轮廓的相机图像帧',
  'Corner {0}': '角点 {0}',
  'Corrected screen for {0}': '{0} 的校正屏幕画面',
  'Camera frame · {0} × {1}': '相机图像帧 · {0} × {1}',
  '{0} × {1} {2} · source {3} × {4}': '{0} × {1} {2} · 原始尺寸 {3} × {4}',
  'Select Main Camera {0}': '选择主相机 {0}',
  'Corrected live view {0}': '校正实时画面 {0}',
  'Live camera stream {0}': '相机实时视频流 {0}',
  'Camera Profile · {0}': '相机配置 · {0}',
  'Setup live camera {0}': '配置实时相机 {0}',
  'Mark {0} position changed? This does not move the robot.':
    '标记 {0} 位置已变化？此操作不会移动机械臂。',
  'Confirmed: {0} / {1}': '已确认：{0} / {1}',
  '{0} · geometry {1} · verification {2}': '{0} · 几何 {1} · 验证 {2}',
  'Calibration live camera {0}': '标定实时相机 {0}',
  'Service {0}': '服务 {0}',
  '{0} physical': '{0} 个物理设备',
  '{0} entries · {1} old · {2} hits / {3} misses':
    '{0} 条记录 · {1} 条过期 · {2} 次命中 / {3} 次未命中',
  '{0} completed{1} · {2} ms gesture': '{0} 已完成{1} · 手势 {2} ms',
  '{0} (center)': '{0}（中心）',
  'Sending {0} ms instead of the Profile value': '使用 {0} ms 覆盖配置值',
  'Using the Profile value{0}': '使用配置值{0}',
  'Execute {0} on {1} with calibration {2}?':
    '在 {1} 上使用标定 {2} 执行 {0}？',
  'Session unavailable: {0}': '会话不可用：{0}',
  'Contact direction must be achievable by the tool. This repository fixes the screen tilt limit at {0}°, so the screen must be installed inside it.':
    '接触方向必须在工具可达范围内。屏幕倾斜上限固定为 {0}°，屏幕安装必须满足此限制。',
  'Keep sampling: {0} of the 5 contact points needed before a plane can be fitted.':
    '请继续采样：拟合平面需要 5 个接触点，已采集 {0} 个。',
  'The {0} captured points do not define a usable plane yet':
    '已采集的 {0} 个点尚无法构成可用平面',
  '{0} Spread the contact points across the screen and capture more; every new point refits the plane automatically.':
    '{0} 请在屏幕各处分散采集更多接触点，每个新点都会自动触发平面重新拟合。',
  'RMSE {0} mm · inliers {1}/{2} · spans {3} × {4} mm. Check the inward normal and coverage, then confirm.':
    '均方根误差 {0} mm · 内点 {1}/{2} · 跨度 {3} × {4} mm。请检查内向法线和覆盖范围后确认。',
  'Select a supported unit for {0}.': '请为 {0} 选择支持的单位。',
  '{0} Unit': '{0}单位',
  '{0} Value': '{0}值',
  'Select {0} Profile': '选择{0}配置',
  'Joint {0}': '关节 {0}',
  'Joint {0} Minimum': '关节 {0} 最小值',
  'Joint {0} Maximum': '关节 {0} 最大值',
  'Allowed base range: {0}–{1}. Covers every contact stage.':
    '允许的基础范围：{0}–{1}，覆盖全部接触阶段。',
  'Select or create {0} Profiles in Advanced settings.':
    '请在高级设置中选择或创建{0}配置。',
  '{0} Saved Profiles are retained; retry to continue.':
    '{0} 已保存的配置会保留，请重试以继续。',
  ' · {0} kg·m² inertia': ' · 惯量 {0} kg·m²',
  'Setup {0} / 2': '配置 {0} / 2',
  'Fix invalid JSON: {0}.': '请修正无效的 JSON：{0}。',
  'Multiple {0} Profiles are available. Choose one or create a new Profile in Advanced settings.':
    '存在多个{0}配置，请在高级设置中选择一个或新建配置。',
  'Corrected output is {0} × {1} px. Check the screen orientation and resolution before confirming camera mapping.':
    '校正输出为 {0} × {1} px。确认相机映射前请检查屏幕方向和分辨率。',
  ' · speed {0} · press {1} mm · clearance {2} mm · contact {3} ms · long press {4} ms · release {5}':
    ' · 速度 {0} · 按压 {1} mm · 间隙 {2} mm · 接触 {3} ms · 长按 {4} ms · 释放 {5}',
  '{0} Name': '{0}名称',
  '{0} Configuration JSON': '{0}配置 JSON',
  'Mount Tool Along {0}': '沿 {0} 安装工具',
  'Tool payload application unconfirmed{0} — {1}':
    '工具负载应用未确认{0} — {1}',
  'Fixed installation of {0}': '{0} 的固定安装',
  'Enter a valid number for {0}.': '请为{0}输入有效数值。',
  'Enter {0} greater than zero.': '请输入大于零的{0}。',
  'Enter {0} in the range {1}–{2}.': '请输入范围在 {1}–{2} 内的{0}。',
  'tool offset {0}': '工具偏移 {0}',
  'joint {0} minimum': '关节 {0} 最小值',
  'joint {0} maximum': '关节 {0} 最大值',
  'Joint {0} minimum must be below maximum.': '关节 {0} 最小值必须小于最大值。',
  'No supported {0} range satisfies every contact stage.':
    '没有支持的{0}范围可满足全部接触阶段。',
  'base {0} for all contact stages': '全部接触阶段的基础{0}',
  'release {0} factor': '释放{0}系数',
  '{0} at contact stage ratio {1}': '{0}，接触阶段比例 {1}',
  '{0} at release factor {1}': '{0}，释放系数 {1}',
  '{0} must be an integer number of milliseconds.': '{0}必须为整数毫秒。',
  'Successor start lead must be smaller than the shortest contact target ({0} ms).':
    '后继动作启动提前量必须小于最短接触目标（{0} ms）。',
  'The outline is too small: it needs at least {0}×{1} px.':
    '轮廓过小，至少需要 {0}×{1} px。',
  'The outline covers {0} px², less than the required {1} px².':
    '轮廓覆盖 {0} px²，小于要求的 {1} px²。',
  'Stalled · last frame {0} s ago': '已停滞 · 上一帧在 {0} 秒前',
  '{0} (relaxed from {1})': '{0}（由 {1} 放宽）',
  'moved {0} px': '偏移 {0} px',
  '{0} (turned)': '{0}（旋转）',
  Language: '语言',
  'Detect Screen': '检测屏幕',
  Tap: '点击',
  'Long Press': '长按',
  Swipe: '滑动',
  Drag: '拖拽',
  speed: '速度',
  acceleration: '加速度',
  robot: '机械臂',
  tool: '工具',
  screen: '屏幕',
  good: '良好',
  review: '需检查',
  poor: '较差',
  TL: '左上',
  TR: '右上',
  BR: '右下',
  BL: '左下',
  'Interaction APIs': '交互 API',
  'Data Extraction APIs': '数据提取 API',
  'Validation APIs': '验证 API',
  'Device-Specific APIs': '设备专用 API',
  'Primary APIs': '主要 API',
  'Describe the element you want to interact with': '描述要交互的元素',
  'Enter key name or text to type': '输入按键名称或要键入的文本',
  'Enter text to input': '输入文本',
  'Start executing until some interaction actions need to be performed. You can see the process of planning and locating.':
    '执行至需要进行交互操作时暂停，可查看规划与定位过程。',
  'Dry Run': '试运行',
  Run: '运行',
  Stop: '停止',
  'Dry run': '试运行',
  'Stop running': '停止运行',
  'Open run configuration': '打开运行配置',
  'Click "Run" to execute': '点击“运行”以执行',
  'Open prompt history': '打开指令历史',
  History: '历史记录',
  Search: '搜索',
  'No history record': '暂无历史记录',
  'No matching history record': '没有匹配的历史记录',
  Earlier: '更早',
  'Failed to apply AI configuration': '应用 AI 配置失败',
  'Execution failed': '执行失败',
  Server: '服务端',
  'Execution Flow': '执行流程',
  'Clear Conversation': '清空对话',
  'Scroll to latest message': '滚动到最新消息',
  'Midscene.js version:': 'Midscene.js 版本：',
  'What do you want to query?': '你想查询什么？',
  'What do you want to assert?': '你想验证什么？',
  'What element do you want to tap?': '你想点击哪个元素？',
  'What element do you want to double-click?': '你想双击哪个元素？',
  'What element do you want to hover over?': '你想悬停在哪个元素上？',
  'Format: <value> | <element> Example: hello world | search box':
    '格式：<文本> | <元素>，例如：你好 | 搜索框',
  'What element do you want to right-click?': '你想右键点击哪个元素？',
  'Format: <key> | <element (optional)> Example: Enter | text field':
    '格式：<按键> | <元素（可选）>，例如：Enter | 文本框',
  'Format: <direction> <amount> | <element (optional)> Example: down 500 | main content':
    '格式：<方向> <距离> | <元素（可选）>，例如：down 500 | 主内容',
  'What element do you want to locate?': '你想定位哪个元素？',
  'What do you want to check (returns true/false)?':
    '你想检查什么（返回布尔值）？',
  'What number do you want to extract?': '你想提取哪个数值？',
  'What text do you want to extract?': '你想提取什么文本？',
  'What condition do you want to wait for?': '你想等待什么条件？',
  Action: '动作',
  'Select action type (current: {0})': '选择动作类型（当前：{0}）',
  Rear: '后',
  running: '运行中',
  starting: '启动中',
  stopped: '已停止',
  offline: '离线',
  failed: '失败',
  stalled: '已停滞',
  tap: '点击',
  Reload: '重新加载',
  'Controller parameters changed. Reload before saving.':
    '控制器参数已变化，请重新加载后再保存。',
  'Disable the robot and wait until it is stationary and fault-free before saving.':
    '请先下使能机械臂，并等待静止且无故障后再保存。',
  'Controller parameter application is unconfirmed. Reload and check the saved values.':
    '控制器参数应用尚未确认，请重新加载并核对保存值。',
  'Controller motion settings failed: {0}': '控制器运动参数操作失败：{0}',
  'Controller Motion Parameters': '控制器运动参数',
  'Global Speed (%)': '全局速度倍率 (%)',
  'XYZ Speed (mm/s)': 'XYZ 速度 (mm/s)',
  'XYZ Acceleration (mm/s²)': 'XYZ 加速度 (mm/s²)',
  'XYZ Jerk (mm/s³)': 'XYZ 加加速度 (mm/s³)',
  'Controller limits affect subsequent robot motions. Screen action ratios still apply.':
    '控制器参数影响后续机械臂运动，屏幕动作的速度比例仍会叠加。',
  'Disable the robot before applying controller motion parameters.':
    '应用控制器运动参数前，请先下使能机械臂。',
  'Enter values within the controller ranges.':
    '请填写控制器允许范围内的数值。',
  'Saved and application requested. Verify actual speed with a test motion.':
    '已保存并请求应用，请通过试运行确认实际速度。',
  longPress: '长按',
  swipe: '滑动',
  dragAndDrop: '拖拽',
  'Last 7 days': '最近 7 天',
  'Last 1 year': '最近一年',
  'Auto Planning: plan the steps and execute': '自动规划：规划步骤并执行',
  'Click an element': '点击元素',
  'Double-click an element': '双击元素',
  'Hover over an element': '悬停于元素',
  'Input text into an element': '向元素输入文本',
  'Right-click an element': '右键点击元素',
  'Press keyboard keys': '按下键盘按键',
  'Scroll the page or element': '滚动页面或元素',
  'Locate an element on the page': '定位页面上的元素',
  'Extract data directly from the UI': '直接从界面提取数据',
  'Get true/false answer': '获取布尔值答案',
  'Extract numeric value': '提取数值',
  'Extract text value': '提取文本',
  'Ask a question about the UI': '针对界面提问',
  'Assert a condition is true': '断言条件成立',
  'Wait for a condition to be met': '等待条件满足',
  quality: '质量',
  photo: '照片',
  '. Select it in Stage or Grid.': '。请在主视图或网格中选择。',
  'Geometry:': '几何：',
  'Camera:': '相机：',
  total: '总计',
  subscriber: '订阅者',
  encoder: '编码器',
  arrival: '到达',
  'Adapter:': '适配器：',
  '. Perspective preset:': '。透视预设：',
  'Welcome to Midscene.js Playground!\n\nThis is a panel for experimenting and testing Midscene.js features. You can use natural language instructions to operate the {0}, such as clicking buttons, filling in forms, querying information, etc.\n\nPlease enter your instructions in the input box below to start experiencing.':
    '欢迎使用 Midscene.js Playground！\n\n在这里可以试用和测试 Midscene.js 的功能。你可以使用自然语言指令操作 {0}，例如点击按钮、填写表单和查询信息等。\n\n请在下方输入指令，开始体验。',
  ready: '就绪',
  ok: '正常',
  degraded: '降级',
  empty: '空',
  valid: '有效',
  invalid: '无效',
  pending: '待处理',
  accepted: '已通过',
  missing: '缺失',
  applying: '应用中',
  applied: '已应用',
  unconfirmed: '未确认',
  'not-required': '无需应用',
  'parameters-changed': '参数已变化',
  'service-start': '服务启动后',
  disabled: '未使能',
  disconnected: '已断开',
  'connection-lost': '连接丢失',
  'controller-restarted': '控制器已重启',
  'application-failed': '应用失败',
  'application-interrupted': '应用中断',
  'emergency-stop': '紧急停止',
  'stop-unconfirmed': '停止未确认',
  'feedback-plane-crossing': '反馈检测到穿越接触平面',
  'driver-arrival-sample': '驱动到达采样',
  'driver-completed': '驱动完成确认',
  ' · timing warning': ' · 时序警告',
  polygon: '多边形',
  'Display 1920 × 1080': '显示器 1920 × 1080',
  'Display 2560 × 1440': '显示器 2560 × 1440',
  'Display 3840 × 2160': '显示器 3840 × 2160',
  '{0} subscriber{1} · {2} encoder{3}': '{0} 个订阅者 · {2} 个编码器',
  '{0} photo{1} · {2}': '{0} 张照片 · {2}',
  'Controller not ready: {0}': '控制器未就绪：{0}',
  'Camera mapping is unavailable (HTTP {0}); check the camera and perspective configuration':
    '相机映射不可用（HTTP {0}），请检查相机与透视配置',
  'Camera mapping is unavailable (HTTP {0}, {1}: {2}); check the camera and perspective configuration':
    '相机映射不可用（HTTP {0}，{1}：{2}），请检查相机与透视配置',
  'The saved main camera is a different device. Save this camera as the main camera before confirming its mapping.':
    '已保存的主相机是另一台设备。请先将此相机保存为主相机，再确认相机映射。',
  'Use This Camera': '使用此相机',
  'Contact timing exceeded its target by {0} ms; the physical action was not retried.':
    '接触时长超出目标 {0} ms，未重试实际动作。',
  'Tool payload {0}{1}. Apply the saved payload using controller controls; recovery alone does not apply it.':
    '工具负载{0}{1}。请通过控制器控件应用已保存的负载，仅进行恢复检查不会应用负载。',
  'Configure the corrected image output dimensions (at least 2 × 2)':
    '请配置校正图像的输出尺寸（至少 2 × 2）',
  'Save the workstation configuration first': '请先保存机械臂配置',
  'Select and save robot, tool and screen configuration in Setup.':
    '请在配置中选择并保存机械臂、工具和屏幕配置。',
  'No mechanical calibration is selected. Select a matching calibration in Setup; valid geometry awaiting acceptance does not require new contact samples.':
    '尚未选择屏幕标定。请在配置中选择匹配的标定；几何有效且等待验证时，无需重新采集接触点。',
  'Mechanical geometry is available; complete hover and test-tap acceptance. No new contact samples are required.':
    '屏幕几何已就绪，请完成悬停和测试点击验证，无需重新采集接触点。',
  'Select the main camera in Setup': '请在配置中选择主相机',
  'Inspect the corrected preview and confirm top-left / right / down. Mechanical calibration is retained.':
    '请检查校正预览并确认左上／向右／向下的对应关系，屏幕标定会保留。',
  'Configure the measured tool payload in Setup.':
    '请在配置中填写实测工具负载。',
  'Reconfirm the camera/perspective binding': '请重新确认相机映射',
  'Screenshot dimensions or binding changed': '截图尺寸或相机映射已变化',
  'Robot Vision returned an invalid mapping descriptor':
    '视觉服务返回了无效的相机映射描述',
  'Requested duration exceeds the configured maximum linear speed':
    '目标时长要求的速度超出了配置的最大线速度',
  'Zero-length gesture cannot match requested duration':
    '零长度手势无法满足目标时长',
  'Adapter supports ratio speed only; duration is best effort':
    '适配器仅支持比例速度，时长只能尽力满足',
  'Adapter has no available feedback sequence; terminal confirmation may extend contact time.':
    '适配器没有可用的反馈序列，最终完成确认可能延长接触时长。',
  'Error:': '错误：',
  'Output:': '输出：',
  'Report:': '报告：',
  'The result will be shown here': '结果将在此处显示',
  'No replay available': '暂无回放',
  'Open report': '打开报告',
  'Download report': '下载报告',
  'Failed to download report': '下载报告失败',
  'Video exported': '视频已导出',
  'Video export failed': '视频导出失败',
  'Export video': '导出视频',
  'Exporting {0}%': '正在导出 {0}%',
  'Focus on cursor': '跟随光标',
  Subtitle: '字幕',
  'Playback speed': '播放速度',
  'not-applied': '尚未应用',
  confirmed: '已确认',
  'Enter the measured end-effector mass within the adapter range.':
    '请输入适配器范围内的实测末端执行器质量。',
  'Enter a supported measured payload inertia, or leave it unset.':
    '请输入支持的实测负载惯量，或留空。',
  gesture: '手势',
  'Enabled · tool payload pending': '已使能 · 工具负载待确认',
  'Tool payload matches controller configuration': '工具负载与控制器配置一致',
  'Sync Tool Payload': '同步工具负载',
  'Sync saved tool payload without disabling the robot?':
    '保持机械臂使能并同步已保存的工具负载？',
  'sync the saved payload': '同步已保存的负载',
  'Tool inertia needs confirmation — sync the saved payload':
    '工具惯量待确认，请同步已保存的负载',
  'Service reconnected — tool payload confirmation required':
    '服务已重新连接，工具负载待确认',
  'because fresh controller load feedback is unavailable':
    '因缺少新鲜的控制器负载反馈',
  'Keep the enabled robot stationary, fault-free and out of drag or pause before syncing tool payload.':
    '同步工具负载前，请保持机械臂已使能、静止、无故障，且未处于拖动或暂停状态。',
  'Select and save the current robot and tool before applying payload.':
    '应用负载前，请选择并保存当前机械臂和工具配置。',
  'Reload the saved tool configuration before applying payload.':
    '应用负载前，请重新加载已保存的工具配置。',
  'Payload application was interrupted': '负载应用已中断',
  'Payload application interrupted by safety control': '负载应用被安全控制中断',
  'readback-unavailable': '负载回读不可用',
  'inertia-unconfirmed': '惯量未确认',
  'Robot Safety Controls': '机械臂安全操作',
  Measure: '测量',
  Continue: '继续',
  'Next: {0}': '下一步：{0}',
  'All setup steps are complete.': '配置步骤已全部完成。',
  'Remote Control Mode': '远程控制模式',
  'The controller did not answer on its HTTP port 22000, so its remote control mode cannot be read.':
    '控制器未在 HTTP 端口 22000 响应，无法读取其远程控制模式。',
  'This app commands the robot over TCP. While the controller is in the teach pendant or DobotStudio mode it refuses every TCP command, including read-only queries.':
    '本应用通过 TCP 控制机械臂。控制器处于示教器或 DobotStudio 模式时会拒绝所有 TCP 命令，包括只读查询。',
  'Switch the controller to TCP Mode? DobotStudio loses control until the mode is switched back.':
    '将控制器切换到 TCP 模式？切回之前 DobotStudio 将失去控制权。',
  'Switch to TCP Mode': '切换到 TCP 模式',
  'Cannot continue yet': '暂时无法继续',
  'Confirm the hover result before contact verification.':
    '请先确认悬停结果，再进行接触验证。',
  'Robot Operating Controls': '机械臂基础操作',
  'Enable / Disable': '使能／下使能',
  'Base Control Mode': '基础工作模式',
  'TCP Submode': 'TCP 子模式',
  Normal: '正常',
  'Switch to Studio Mode': '切换到 Studio',
  'Switch to TCP control and reconnect?': '切换到 TCP 模式并重新连接？',
  'Hand control to DobotStudio? TCP control will become unavailable.':
    '将控制权交给 DobotStudio？本应用的 TCP 控制将不可用。',
  'Mode readback pending verification': '当前工作模式待确认',
  'Switch to TCP/IP Development Mode': '切换到 TCP/IP 二次开发模式',
  'Switch the controller to TCP/IP development mode? DobotStudio loses control until the mode is switched back.':
    '将控制器切换到 TCP/IP 二次开发模式？切回之前 DobotStudio 将失去控制权。',
  'TCP/IP development mode required': '需要 TCP/IP 二次开发模式',
  'TCP/IP Development': 'TCP/IP 二次开发',
  'Online Mode': '在线模式',
  'Switch to Online Mode': '切换到在线模式',
  'Switch to TCP/IP development mode and reconnect?':
    '切换到 TCP/IP 二次开发模式并重新连接？',
  'Switch to online mode? DobotStudio takes control and this application loses TCP access.':
    '切换到在线模式？DobotStudio 将取得控制权，本应用将失去 TCP 访问。',
  'Mode read back from the command channel': '当前工作模式（由命令行通道回读）',
  'What the two modes mean': '两种模式说明',
  'TCP/IP development: this application controls the arm over TCP.':
    'TCP/IP 二次开发：本应用通过 TCP 控制机械臂。',
  'Online mode: DobotStudio controls the arm and this application cannot send commands.':
    '在线模式：由 DobotStudio 控制机械臂，本应用无法下发命令。',
  'Switching does not enable, clear faults or move the arm.':
    '切换不会使能、不会清错，也不会让机械臂移动。',
  'Exit Drag Mode from the robot bar; the base mode stays fixed while dragging.':
    '退出请用上方状态栏的「退出拖动模式」；拖动中不能切换基础工作模式。',
  'Base control mode cannot change while Drag Mode is active.':
    '拖动模式启用期间不能切换基础工作模式。',
  'TCP switch acknowledged. Reconnect to verify control.':
    '已收到 TCP 切换响应，正在重新连接以确认控制可用。',
  'Studio switch acknowledged. TCP control may disconnect.':
    '已收到 Studio 切换响应，TCP 控制可能断开。',
  Errors: '错误',
  'Robot Errors': '机械臂错误',
  '{0} Remedy: {1}': '{0} 处理建议：{1}',
  'Controller fault {0}': '控制器错误 {0}',
  'Servo motor fault (J{0}) {1}': '伺服电机错误（J{0}）{1}',
  'Level {0}': '等级 {0}',
  'Jog Control': '点动控制',
  Step: '步长',
  'mm / °': 'mm / °',
  Cartesian: '笛卡尔',
  Joints: '关节',
  'Each press moves one step. Release the limit by stepping away from it, then clear the fault.':
    '每按一次移动一步。用反向点动脱离限位后，再清除故障。',
  'Hold a direction to jog; releasing stops the motion.':
    '按住方向按钮连续点动，松开即停。',
  'Connect the robot first.': '请先连接机械臂。',
  'Enable the robot before jogging.': '请先使能机械臂，再执行点动。',
  'Clear the controller faults before jogging.':
    '请先清除控制器故障，再执行点动。',
  'Leave Drag Mode before jogging.': '请先退出拖动模式，再执行点动。',
  'Resume the robot before jogging.': '请先恢复机械臂运行，再执行点动。',
  'Wait for the current motion to finish.': '请等待当前运动结束后再点动。',
  'Recover the workstation before jogging.': '请先完成工作站恢复，再执行点动。',
  'Save the robot settings before jogging.': '请先保存机械臂设置，再执行点动。',
  'Move {0} negative': '沿 {0} 负方向点动',
  'Move {0} positive': '沿 {0} 正方向点动',
  'J{0} negative': 'J{0} 反向点动',
  'J{0} positive': 'J{0} 正向点动',
  'End-effector rotation is J4; the driver has no R jog.':
    '末端旋转请用 J4 点动；驱动不支持 R 轴点动。',
  'Remedy: {0}': '处理建议：{0}',
  'Controller Errors': '控制器错误',
  'Raw Joint Angles': '原始关节角度',
  'Joint Recovery Guide': '关节恢复指引',
  'Live joint readings': '实时关节读数',
  'Joint fault': '关节告警',
  'Positive limit': '正向限位',
  'Negative limit': '负向限位',
  'Live Angles': '实时角度',
  'Readings unavailable or stale': '读数不可用或已过期',
  'MG400 joint location schematic': 'MG400 关节位置示意图',
  'Select a joint to locate it. The drawing shows joint locations, not the live robot pose.':
    '选择关节以定位对应部位。图中展示关节位置关系，不代表机械臂当前位姿。',
  'Base Rotation': '底座旋转',
  'Upper Arm': '大臂',
  Forearm: '小臂',
  'Tool Rotation': '末端旋转',
  'Parallelogram Linkage': '平行四边形机构',
  'Parallelogram Limit': '平行四边形限位',
  'Limit alarm': '限位报警',
  'Reference range: {0}° to {1}°': '参考范围：{0}° 至 {1}°',
  'Readings are stale. Refresh before using them for recovery.':
    '读数已过期，请刷新确认后再用于恢复定位。',
  'Waiting for valid joint angles.': '正在等待有效的关节角度。',
  'J{0} limit alarm': 'J{0} 限位报警',
  'Both limit directions are reported. Check the controller diagnostics.':
    '控制器同时报告两个方向限位，请检查控制器诊断信息。',
  'To leave the positive limit, the raw J{0} angle must decrease. Observe the value while adjusting the joint.':
    '脱离正向限位需要使 J{0} 原始角度减小。调整关节时，请观察读数变化。',
  'To leave the negative limit, the raw J{0} angle must increase. Observe the value while adjusting the joint.':
    '脱离负向限位需要使 J{0} 原始角度增大。调整关节时，请观察读数变化。',
  'The linkage alarm concerns the arm mechanism, not a fifth motor axis. Check the controller recovery instructions.':
    '该报警对应机械臂的连杆机构，不是第五个电机轴。请核对控制器的恢复说明。',
  'Angles retain full turns. Reference ranges are adapter values; controller alarms determine whether a limit is active.':
    '角度保留累计圈数。参考范围来自适配器，是否触发限位以控制器报警为准。',
  'This guide only reads state. After leaving the limit, use Clear Faults to verify recovery.':
    '此指引仅读取状态。脱离限位后，请使用“清除故障”确认恢复结果。',
  'Parallelogram positive limit alarm.': '平行四边形正向限位报警。',
  'Parallelogram negative limit alarm.': '平行四边形负向限位报警。',
  'J{0} positive limit alarm. Check this joint’s raw angle.':
    'J{0} 正向限位报警，请核对该关节的原始角度。',
  'J{0} negative limit alarm. Check this joint’s raw angle.':
    'J{0} 负向限位报警，请核对该关节的原始角度。',
  'Full turns are retained. Moving other joints may leave a joint limit alarm unchanged.':
    '角度保留累计圈数。移动其他关节可能不会解除该关节的限位报警。',
  'Controller sample: {0}': '控制器采样时间：{0}',
  'Raw controller state could not be read.': '无法读取控制器原始状态。',
  'Fault clearing could not be confirmed. Check the current alarms and joint angles.':
    '尚未确认故障已清除，请核对当前报警和关节角度。',
  'Operation / Connection Errors': '操作／连接错误',
  'Raw Error Details': '原始错误详情',
  'Last queried: {0}': '查询时间：{0}',
  'Error query failed': '错误查询失败',
  'Current controller errors have not been confirmed.':
    '尚未确认控制器当前错误。',
  'No controller errors reported.': '控制器未报告错误。',
  'Controller state is unavailable. Previous errors may be outdated.':
    '无法读取控制器状态，此前的错误信息可能已过期。',
  'Drag Mode is available during calibration positioning only.':
    '标定期间仅在采点定位阶段可进入拖动模式。',
  Connected: '已连接',
  Disconnected: '未连接',
  Enabled: '已使能',
  'State unavailable': '状态不可用',
  Unconfirmed: '待确认',
  'Operating Modes': '工作模式',
  'Choose who owns the command channel.': '选择由谁控制命令通道。',
  'Save and exit calibration before changing enablement.':
    '请先暂存并退出标定，再操作使能或下使能。',
  'The current operation is using the robot.': '当前任务正在占用机械臂。',
  'Already enabled': '已处于使能状态',
  'Already disabled': '已处于下使能状态',
  'Save the robot and tool settings before enabling.':
    '请先保存机械臂和工具配置，再使能。',
  'Disable is unsupported by this adapter.': '当前适配器不支持下使能。',
  'Back One Step': '返回上一步',
  'Moving above the next point': '正在抬笔并移动到下一采样点',
  'Automatic screen calibration': '自动屏幕标定',
  'Collection mode': '采样方式',
  'Verification settings': '后续验证参数',
  'Each endpoint needs a confirmed touch. Lost contact is recovered only within a bounded range. Keep the phone and camera fixed.':
    '每个终点都需要确认触摸；丢失接触时仅在限定范围内尝试恢复。请保持手机和相机固定。',
  Fast: '快速',
  Regular: '普通',
  'Confirm retry': '确认重试',
  'Retry in regular mode?': '切换到普通模式重新采样？',
  'No touch detected at fast calibration point {0} within the safe depth':
    '快速标定第 {0} 个采样点在安全深度内未检测到触摸',
  'Fast calibration point {0} did not sustain touch within the safe depth':
    '快速标定第 {0} 个采样点在安全深度内未能维持稳定触摸',
  'Retry in regular mode': '用普通模式重试',
  'Fast probing': '快速探测',
  'No touch was detected before the safety height {0} mm. Sampling stopped.':
    '下降至安全高度 {0} mm 时仍未检测到触摸，采样已停止。',
  'Plane validation failed: {0} of {1} samples agree within 0.5 mm; {2} are required.':
    '平面验收未通过：{1} 个采样点中，{0} 个点的偏差在 0.5 mm 内，至少需要 {2} 个。',
  'No page touch within the fast local height-search budget; check the screen placement before retrying':
    '当前点在快速模式限定的高度范围内未检测到触摸，采样已停止。',
  'Fast calibration exhausted its local height-search budget; check the installation before retrying':
    '本轮快速标定已用完局部补探次数，采样已停止。',
  'No confirmed release within the height probe; stopped instead of reusing a deep press':
    '抬笔后仍未确认触摸释放，采样已停止。',
  'The touch did not release at the approach height':
    '笔尖已抬到探测起点，但手机仍报告触摸，采样已停止。',
  'Adaptive light press did not confirm touch':
    '补探后的轻压未确认触摸，采样已停止。',
  'The phone did not confirm the current touch state; refresh its calibration page and retry':
    '未收到手机对当前触摸状态的确认，请检查手机网页连接后重试。',
  'The visible phone page cannot cover enough of the screen for calibration. Check the camera mapping and expand the phone page before starting.':
    '当前手机网页可覆盖的屏幕范围不足，尚未开始运动。请检查相机校正范围，并展开手机网页后重试。',
  'Sliding collection': '滑动采样',
  'Sliding to the next point': '保持接触，正在滑向下一采样点',
  'Measures each point independently. Recommended for the first calibration.':
    '逐点测量接触高度，首次标定建议使用。',
  'Predicts each press height and lifts between points. For a fixed, horizontal screen.':
    '预测按压高度，点间抬笔移动。适合固定、水平放置的屏幕。',
  'Keeps contact between grid points. For a fixed, horizontal screen with reliable continuous touch.':
    '采样点之间保持触摸并滑动。适合固定、水平放置且能稳定连续触摸的屏幕。',
  'The phone is horizontal and firmly supported; the stylus can maintain continuous touch.':
    '手机已水平放置并稳定支撑，触控笔能够保持连续触摸。',
  'Three direction points establish the axes. Four grid points fit the surface; two independent points check it. Keep hands clear.':
    '先测 3 个方向点，再用 4 个分布点拟合、2 个独立点验证。请保持工作区清空。',
  '{0} / {1} points recorded': '已记录 {0} / {1} 个采样点',
  'Fast calibration exhausted its local height-search budget':
    '快速探测已用完本轮高度补探次数。请检查触控笔和支撑状态，再尝试普通模式。',
  'No touch within the fast local recovery range':
    '当前采样点在限定高度范围内未恢复触摸，采样已停止。',
  'Contact was not sustained at height {0} mm after retry. Check the stylus and phone stability before retrying.':
    '在高度 {0} mm 重试后，仍未确认持续触摸。请检查触控笔接触与手机是否固定，再重新尝试。',
  'The robot did not reach the requested height ({0} mm; measured {1} mm). Check the robot status before retrying.':
    '机械臂未到达目标高度（目标 {0} mm，实测 {1} mm）。请检查机械臂状态后重试。',
  'No touch within the bounded contact depth; check the stylus instead of pressing deeper':
    '已达到本次探测的下降范围，仍未检测到触摸。请检查触控笔和起点位置。',
  'No touch within the bounded descent; reposition and restart':
    '在限定搜索范围内未找到触摸。请调整触控笔起点位置后重试。',
  'Start automatic calibration': '开始自动标定',
  'Confirm clearance and continue verification': '确认悬停安全，继续自动验证',
  'The phone is fixed and the return path is clear. Start automatic probing, safe return and hover checks; I will supervise and can stop the robot.':
    '手机已固定，返回安全位置的路径畅通。开始后将自动探索、返回并检查悬停边界；我会全程观察，必要时停止机械臂。',
  'Finding screen contact': '正在逐步下降，寻找屏幕接触',
  'Lifting to confirm release': '正在抬笔，确认触摸已释放',
  'Measuring contact height': '正在精测接触高度',
  'Confirming stable contact': '正在复验，确认持续接触',
  'Back to Overview': '返回总览',
  'Motion Settings': '运动参数',
  'Save Motion Settings': '保存运动参数',
  Cancel: '取消',
  'Motion settings saved.': '运动参数已保存。',
  'the selected screen': '所选屏幕',
  'Speed, contact and release values for {0}. Saving does not enable or move the robot and keeps the existing calibration geometry.':
    '{0} 的速度、接触与释放参数。保存不会使能或移动机械臂，并保留已有的标定几何。',
  'Focus and Exposure': '对焦与曝光',
  'Automatic focus is locked and exposure is monitored.':
    '已自动锁定焦距，曝光正在自动监测。',
  'Finish camera mapping to calibrate focus and exposure automatically.':
    '完成相机映射后将自动标定焦距和曝光。',
  'Could not calibrate the camera image.': '无法校准相机画面。',
  'Timed out while calibrating the camera image.': '校准相机画面超时。',
  'Clear Applied Perspective': '清除当前透视（保留屏幕）',
  'Calibrating camera focus and exposure': '正在校准相机对焦与曝光',
  ...setupZh,
  ...migratedZh,
  ...assistedCalibrationZh,
};
