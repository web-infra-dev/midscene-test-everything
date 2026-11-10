export const assistedCalibrationZh: Record<string, string> = {
  'Phone step acknowledgement timed out. Touch at this position is unknown.':
    '手机未在时限内确认本步，当前位置的接触状态未知。请检查标定页和连接后重试。',
  'The phone cancelled the active pointer. Touch at this position is unknown.':
    '手机浏览器取消了当前触点，当前位置的接触状态未知。',
  'Phone contact changed while the robot was stationary. This position could not be measured.':
    '机械臂静止期间，手机回报的触点未稳定，本次位置未计入测量。',
  'Calibration positions': '标定位置',
  'Safe Parking Position': '安全避让位',
  '{0} · outside frame': '{0} · 画面外',
  'Check camera mapping before starting calibration':
    '开始标定前需要重新检查相机映射。',
  'The robot was stopped manually. Confirm recovery before sampling.':
    '机械臂已手动停止。恢复采样前，请确认恢复。',
  'Emergency stop was triggered. Confirm recovery before sampling.':
    '急停已触发。解除急停后，请确认恢复。',
  'Resolve the controller fault and confirm recovery before sampling.':
    '请处理控制器报警，再确认恢复。',
  'Connection interrupted. Checking readiness before returning to sampling setup.':
    '连接中断，重连并检查机械臂状态后将返回采样准备。',
  'Resume the robot to continue calibration.':
    '请在顶部恢复机械臂运行，再继续标定。',
  'Check controller recovery before collecting points.':
    '采样前，请先检查并恢复控制器。',
  'Prepare the robot and tool payload before collecting points.':
    '采样前，请确认机械臂已使能并已应用工具负载。',
  'No measurement recorded for this step.': '本次标定未保存这一步的测量记录。',
  'Boundary verification': '边界验证',
  'Preparing boundary verification': '正在准备边界验证',
  'Continue to boundary verification': '继续边界验证',
  'Sampling and fitting are followed by automatic hover and contact boundary verification. Record the Safe Position afterwards, then review and save.':
    '采样拟合后自动执行悬停与接触边界验证，再记录安全位置、检查并保存。',
  'I confirm the screen is horizontal and secured, the setup is ready, and the workspace is clear for sampling and automatic boundary verification.':
    '我已确认屏幕水平固定、配置就绪、工作区净空，可以开始采样和自动边界验证。',
  'The screen is horizontal and securely fixed.': '屏幕已水平放置并固定。',
  'I confirm the setup and clear workspace for sampling and automatic boundary verification.':
    '我已确认配置及工作区净空，允许采样与自动边界验证。',
  'Boundary verification is complete. Record a Safe Position clear of the screen and camera; release the robot before recording.':
    '边界验证已完成。请记录远离屏幕和摄像头的安全位置，记录前松开机械臂。',

  'Keep the phone page visible in full screen to continue.':
    '请保持手机标定页在前台全屏显示后继续。',
  'Open the calibration page from the iOS Home Screen to continue.':
    '请将标定页添加到主屏幕，再从主屏幕图标打开。',
  'Waiting for the phone to enter full screen…': '等待手机进入全屏…',
  'Detect screen markers': '识别屏幕标记',
  'Set up camera first': '先校正相机',
  'Save screen area': '保存屏幕范围',
  'Open the marker page on the target screen to detect its edges.':
    '请在待识别的屏幕上打开标记页，以识别屏幕边缘。',
  'Grid RMS {0} mm · Holdout maximum {1} mm · Coverage {2}%':
    '网格均方根误差 {0} mm · 留出最大偏差 {1} mm · 覆盖率 {2}%',
  'Run inner contact boundary': '执行接触内框验证',
  'Inner boundary checked': '接触内框已完成',
  'Image trial: {0} / {1} hits': '看图试点：命中 {0} / {1}',
  'Try three image-guided taps': '从相机画面试点（3 点）',
  'Maximum landing error: {0} CSS px': '最大落点偏差：{0} CSS px',
  'Drag the four corners to include the full display and system bars.':
    '直接拖动四个角点，让绿框包含完整显示区域和系统栏。',
  '{0} fit markers · {1} held out · maximum {2} CSS px':
    '{0} 个拟合标记 · {1} 个独立验证标记 · 最大偏差 {2} CSS px',
  'Target circles and measured landings': '目标圆与实际落点',
  'Check all four display edges, including the system bars, before continuing.':
    '请对照两幅画面，核对四边是否包含完整屏幕和系统栏。',
  'Arm calibration': '机械臂标定',
  'Camera correction': '相机校正',
  'Boundary checks': '边界验证',
  'Locating targets in the corrected image…': '正在从校正图识别圆心…',
  'Automatic exploration': '自动探索',
  'Return to safe position': '回到安全位置',
  'Park the stylus clear of the camera and screen. Release the arm before recording. Clearance will be checked against the measured plane.':
    '请将笔尖拖到屏幕之外、避开镜头的位置，松手后记录。系统将在平面拟合完成后复核离屏间隙。',
  'The saved position clears the measured plane. Check the return path before moving.':
    '已确认安全位置与屏幕平面的间隙。请检查返回路径上的障碍物，再让机械臂回位。',

  'Local height compensation must be finite and within 5mm of the original plane':
    '测得的局部高度补偿超过原平面 ±5mm，未采用。原采点和平面保留，请检查触点数据和笔头。',
  'Raise Reference Position': '抬高并重记参考位',
  'Continue Collection': '继续采点',
  'Collection paused: the reference position is too low. Confirmed points are retained. Raise the stylus clear of the screen without changing tool orientation, record a higher reference position, then continue. Keep the phone and camera fixed.':
    '参考位偏低，采点已暂停，已确认的触点保留。保持笔的朝向不变，先向上抬离屏幕，重新记录更高的参考位，再继续采点。手机和相机保持不动。',
  'Keep the tool orientation unchanged when raising the reference position':
    '抬高参考位时请保持笔的朝向不变，否则不能复用已采点。',
  'Raise the reference position further before continuing collection':
    '参考位仍偏低，请再抬高一些后重新记录。',

  'Local XY mapping is inconsistent; check phone stability and touch positions':
    '前五点的 XY 映射误差过大，请检查手机是否固定、触点位置是否稳定。',
  'Repair round {0}/2; probed {1}/{2} missed points.':
    '修正第 {0}/2 轮，已补探测 {1}/{2} 个漏点。',
  'After local height compensation, confirm hover clearance to continue with 15 new random targets.':
    '局部高度补偿后需要重新悬停确认，确认后自动验证新一组随机 15 点。',
  'Stop Automatic Repair': '停止自动修正',
  'Automatically Repair Missed Points (up to 2 rounds)':
    '自动修正漏点（最多两轮）',
  'Two repair rounds completed; some clicks still missed. Inspect the stylus and setup.':
    '两轮修正已完成，仍有漏点。请检查电容笔和设备摆放。',
  'Repair contact missed the target; check positioning before compensation':
    '补探测触点偏离目标，已停止修正，请检查定位。',
  'Too many missed points; inspect the setup before continuing':
    '漏点过多，已停止修正，请先检查设备摆放和电容笔。',
  'Probe a Missed Point': '漏点补探测',
  'Keep the setup fixed. Probe the selected point once from the reference position in 0.5 mm steps, at most 5 mm below the predicted contact height. This does not measure stylus force. Watch the stylus and stop if compression is excessive.':
    '保持手机和工具不变。从参考位以 0.5mm 步长探测一次，最深不超过预计接触高度以下 5mm。这不是力控；观察笔头，压缩过大时立即停止。',
  'Probing the selected point; the original calibration is retained.':
    '正在补探测所选漏点，原标定保留。',
  'Stop Point Probe': '停止补探测',
  'Probe Missed Point {0}': '补探测漏点 {0}',
  'Height Difference from Predicted Contact (mm)':
    '相对预计触点的 Z 高度差（mm，正值表示更高）',
  'Contact was measured inside the target. Apply local height compensation while retaining the original plane and samples; repeat hover and click verification.':
    '已在目标内取得触点。仅补偿附近的接触高度，原平面和采点保留；之后需重新悬停和点击验证。',
  'The contact is too far from the target. Check positioning before applying compensation.':
    '触点离目标过远。先检查定位，暂不允许采用补偿。',
  'Apply Local Height Compensation': '采用局部高度补偿',
  'No touch within the bounded repair depth; check the stylus instead of pressing deeper':
    '已达到补探测深度上限仍无触摸，请检查笔头，不再继续下压。',
  'Release the robot before recording the reference position':
    '松开机械臂后再记录参考位。',
  'Reference position was not recorded': '尚未记录参考位。',
  'Record a calibration reference position before collecting points':
    '请先记录标定参考位，再开始采点。',

  'Calibration Reference Position': '标定参考位',
  'Record Reference Position': '记录参考位',
  'Set a calibration reference position': '设置标定参考位',
  'Reference position recorded': '参考位已记录',
  'Change Reference Position': '重新记录参考位',
  'Point collection is complete. Separately record a safe position for normal actions, with clearance above the screen and outside the camera view. Release the robot before recording. Collected points are retained.':
    '采点已完成。请单独记录日常动作使用的安全位，保持与屏幕的安全间隙，并避开相机视线。松开机械臂后再记录，已有采点结果会保留。',

  'Multiple simultaneous touches made this probe ambiguous; collection stopped':
    '检测到多个同时触点，无法确定本次探测结果，采集已停止。',
  'Place the stylus 20–50 mm above the center of the screen. Release the robot and record the starting position. Recording does not move the robot.':
    '将笔尖放在屏幕中央上方约 2–5 cm。松开机械臂并记录起始位置，记录时不执行移动。',
  'Record a starting position 20–50 mm above the center of the screen. Automatic collection first probes nearby contacts, then nine targets.':
    '记录屏幕中央上方约 2–5 cm 的起始位置。自动采集先探测附近触点，再采集九个目标。',
  'Three direction points establish the axes. Six grid points fit the plane; three independent points check it. Keep hands clear.':
    '先探测中心和两个方向，再采集九个网格点。其中六点参与拟合，三点独立验证。请保持工作区清空。',
  'Point recorded. The robot lifts and returns automatically.':
    '触点已记录，机械臂正在自动抬笔并返回。',
  'Recording this step’s touch and measured position. Do not touch the robot.':
    '正在记录本步触点和实测位置，请勿触碰机械臂。',
  'The robot is approaching the screen in bounded steps.':
    '机械臂正在以有限的小步接近屏幕。',
  'Missing phone feedback stops automatic collection.':
    '手机反馈缺失会停止自动采集。',
  'The phone is fixed, the stylus is above its center, and the work area is clear. I will supervise automatic probing and can stop it.':
    '手机已固定，笔尖位于屏幕中央上方，工作区已清空。我会看护自动探测，并可随时停止。',
  'Establishing initial mapping: {0} / 3': '建立初始映射：{0} / 3',

  'Midscene Execution Model': 'Midscene 执行模型',
  'Screen Detection Model': '屏幕检测模型',
  'Used only for camera perspective correction. Midscene execution uses its own model settings.':
    '仅用于相机透视校正，Midscene 执行使用独立的模型设置。',
  'Used for Midscene task execution. Screen detection uses its own model settings.':
    '用于 Midscene 任务执行，屏幕检测使用独立的模型设置。',

  Hit: '命中',
  'Hit rate': '命中率',
  'Required hits': '通过要求',
  'Retry Click Verification': '重新点击验证',
  'Verify 15 random circles; all 15 must be hit. Each circle is 26 CSS px in diameter; any click inside it counts.':
    '随机验证 15 个圆点，15 个全部命中才可通过。每个圆点直径 26 CSS px，点中圆内任意位置均计为命中。',
  'Collected points and hover verification are retained. Move any overlay aside, then retry with new random targets.':
    '采点和悬停验证结果已保留。请移开可能遮挡目标的悬浮按钮，然后重新随机点击验证，无需重新标定。',

  Miss: '未命中',
  'The click missed the 26 CSS px target.': '点击未命中直径 26 CSS px 的目标。',
  'Collected points and the fitted screen are retained. Record a higher safe position, then continue verification without collecting again.':
    '本轮采点和拟合结果已保留。重新记录更高的安全位置后即可继续验证，无需重新采集。',
  'Maximum fit residual: {0} mm (diagnostic only). Acceptance requires Hover Verification and Click Verification.':
    '最大拟合残差：{0} mm（仅供诊断）。需完成悬停验证和点击验证才能验收。',
  'Point collection needs retry': '本轮采集未通过',
  'Drag Mode active': '拖动模式已开启',
  'Drag Mode remains active. Check the error, then collect again. Retrying clears this attempt; the recorded safe position is retained.':
    '拖动模式保持开启。请根据提示检查后重新采集；重试会清空本轮采点，已记录的安全位置会保留。',
  'Point collection timed out. Collect again; Drag Mode remains active.':
    '本轮采集已超时，请重新采集；拖动模式保持开启。',

  'Phone and camera setup are ready. Start calibration here, then record a safe position and collect nine points.':
    '手机与相机已配置。在此开始标定，随后记录安全位置并采集九个触点。',

  'Phone page changed. Restart point collection.':
    '手机标定页面已切换，请重新开始本轮采点。',
  'Phone page changed. Confirm the setup and restart verification.':
    '手机标定页面已切换。确认手机、相机和机械臂位置未变后，重新验证。',
  'Restart Calibration': '重新开始标定',
  Recalibrate: '重新标定',
  'Check Camera Mapping': '检查相机映射',
  'Check Recovery': '检查并恢复控制器',
  'The controller requires recovery. Keep the robot stationary, resolve any alarm, then check recovery here. This does not enable or move the robot.':
    '控制器需要恢复。请保持机械臂静止，排除报警后，在此检查并恢复；此操作不会使能或移动机械臂。',
  'Waiting for phone data. Recorded points are retained.':
    '正在等待手机数据，已采集的点会保留。',
  'Calibration stopped. Check the cause and restart here. Phone and camera settings are retained.':
    '标定已停止。排除原因后，在此重新开始；手机与相机配置会保留。',

  '1. Collect 9 Points': '① 采集 9 个稳定触点',
  'Point Collection': '采点标定',
  'Start Collection': '开始采集',
  'Stop Collection': '停止采集',
  'Collect Again': '重新采集',
  'Point collection complete': '采集完成',
  'Collect calibration points': '采集标定点',
  'Collect nine calibration points': '采集九个标定点',
  'Calibration targets and recorded contacts': '标定目标与已记录触点',
  'Each point pairs a confirmed touch with the refined contact height. Keep the phone and camera fixed.':
    '手机确认触点后，机械臂细化接触高度并记录这一对测量值。请保持手机和相机固定。',
  '{0} / 9 points recorded': '已记录 {0} / 9 个点',
  'Green dots show the actual contacts recorded for calibration.':
    '绿点表示实际记录的标定触点。',
  'Record a position above the whole screen before collection. Its clearance will be checked against the fitted screen plane.':
    '采点前，请先记录屏幕上方的安全位置。采集完成后会检查离屏间隙。',
  'The phone page was reloaded. Start point collection again.':
    '手机页面已刷新，请重新开始采点。',
  'Point collection stopped. Start again.': '采集已停止，请重新开始。',
  'Point collection timed out. Start again.': '采集超时，请重新开始。',

  'Keep the phone calibration page open and wait for the connection to recover.':
    '请保持手机标定页面打开，并等待连接恢复。',
  'Logical screen size': '逻辑尺寸',
  'Unknown phone model': '型号未知',
  'Bring the phone page to the foreground at normal zoom.':
    '请回到手机标定页，并恢复默认缩放。',
  'Scan the QR code again to connect.': '请用手机重新扫码连接。',
  'Phone paused': '手机页面已暂停',
  'Phone disconnected': '手机连接已断开',
  'Phone screen: {0} × {1} CSS px': '手机整屏：{0} × {1} CSS px',
  'From phone screen · {0} × {1} px': '来自手机整屏比例 · {0} × {1} px',
  'Restart the arm and vision services to load model detection details.':
    '请重启机械臂与视觉服务，以加载模型检测详情功能。',
  'Model Input and Output': '模型输入与输出',
  'Model Input Image': '模型输入图片',
  Prompt: '提示词',
  'Model Output': '模型输出',
  'Parsed Output': '解析结果',
  'SDK-extracted assistant text. See Parsed Output for the parsed JSON.':
    'SDK 提取的原始回复文本；解析后的 JSON 请展开下方“解析结果”。',
  'Model screen detection needs review': '模型检测结果需要检查',
  'No model response was received.': '未收到模型回复。',
  'Perspective preview is generated automatically. Check the corners and orientation before selecting Use This Result.':
    '已自动生成透视校正预览。检查四角和方向后，再选择“使用此结果”。',
  'A calibration command is already running.': '当前有标定指令正在执行。',
  'Wait for the current calibration command to finish.':
    '请等待当前标定指令执行完成。',
  'Click verification failed': '点击验证未通过',
  'Enable the robot with the saved tool before starting capture.':
    '开始采集前，请使用已保存的工具参数使能机械臂。',
  'Scan the QR code to open the calibration page.':
    '扫描二维码，打开手机标定页面。',
  'Same local network · Keep the page open': '同一局域网 · 保持页面打开',
  'Save the touch tool before connecting the phone.':
    '请先保存触控工具，再连接手机。',
  'Connect the phone and map the camera before starting calibration.':
    '请先连接手机并完成相机映射，再开始标定。',
  'Save a touch tool and start the main camera before starting phone calibration.':
    '请先保存触控工具并启动主相机，再开始手机标定。',
  'Connect Phone': '连接手机',
  'Scan with your phone to connect': '用手机扫码连接',
  'Access URL': '访问网址',
  'Copy URL': '复制',
  'URL copied': '已复制',
  'Phone connected': '手机已连接',
  'Waiting for phone': '等待手机连接',
  'Open the calibration page on your phone. Screen dimensions will be measured from stable contacts.':
    '在手机上打开标定页面。系统会根据稳定触点测量屏幕尺寸，无需手动填写。',
  'Computer network address': '电脑网络地址',
  'Keep the phone and computer on the same local network. Keep this page open without zooming or rotating.':
    '手机和电脑需处于同一局域网。保持页面打开，不要缩放或旋转。',
  'Copy calibration link': '复制标定链接',
  'Connect the phone calibration page before mapping the camera.':
    '先连接手机标定页面，再进行相机映射。',
  'Detect the complete display, including the status bar. Review the corners, then save and apply perspective correction.':
    '检测包含状态栏的完整显示区域。检查四角后，保存并应用透视校正。',
  'After applying perspective correction, page markers are checked automatically to map phone touches to the image.':
    '应用透视校正后，系统会自动检查页面标记，建立手机触点与图像的对应关系。',
  'Checking page markers…': '正在检查页面标记与校正画面…',
  'Retry Camera Mapping': '重试相机映射',
  'Page marker mapping was not returned. Retry camera mapping.':
    '未收到页面标记映射，请重试相机映射。',
  'Page markers detected': '页面标记已识别',
  '9 fit markers · 4 independent checks · mean {0}, maximum {1} CSS px':
    '9 个拟合标记 · 4 个独立验证点 · 平均 {0}、最大 {1} CSS px',
  'Marker shape error: {0} px': '标记形状误差：{0} px',
  'Wait for verification to finish, or stop the robot.':
    '请等待验证结束，或先停止机械臂。',
  'Safe Position': '安全位置',
  'Record Safe Position': '记录安全位置',
  'Hover Verification': '悬停验证',
  'Returning to safe position': '正在回到安全位置',
  'Safe position recorded': '已记录安全位置',
  'Move the stylus above the whole screen. Release the robot, then record the safe position. Recording exits Drag Mode; it does not move the robot.':
    '将笔尖移到屏幕上方，留出足够间隙。请松开机械臂，再点击“记录安全位置”。系统将退出拖动模式并记录当前位置。',
  'Release the robot, then select Return to Safe Position. The robot will exit Drag Mode, lift away from the screen and return to the recorded position.':
    '采点完成。请松开机械臂，再点击“回到安全位置”。机械臂将退出拖动模式，先离屏抬升，再返回已记录的位置。',
  'The robot is lifting away from the screen and returning to the recorded safe position.':
    '机械臂正在离屏抬升并返回已记录的安全位置。',
  'The robot has returned to the saved safe position. Hover verification follows all four corners and edges of the full phone display, including areas outside the webpage. Confirm clearance before automatic contact.':
    '机械臂已回到安全位置。悬停验证将经过手机整屏四角和四边，包含网页以外的区域。请观察并确认安全间隙，再进行自动点击。',
  'Wait for the safe return to finish, or stop the robot.':
    '请等待回位结束，或先停止机械臂。',
  'Saved safe position must be at least the safe clearance away from the fitted screen. Record a higher safe position. Collected points are retained.':
    '已记录的安全位置离屏间隙不足。请重新记录更高的安全位置；本轮采点已保留，无需重新采集。',
  'Click Verification': '点击验证',
  'Verification Result': '验证结果',
  'Start Click Verification': '开始点击验证',
  'Save and Use': '保存并启用',
  'Calibration progress': '标定进度',
  'Detect the phone page markers in Camera Mapping before collecting.':
    '请先在相机映射步骤检测手机页面标记。',
  Collecting: '采集中',
  'Ready to capture': '可以开始采集',
  'Contact Duration': '接触时长',
  'The stylus is mounted securely, these motion settings are suitable, and the work area is clear.':
    '触控笔已固定，已确认运动参数适合当前安装，工作区域已清空。',
  'Set a safe position': '设置安全位置',
  'Run Hover Verification': '执行悬停验证',
  'The stylus cleared the entire screen and the hover path is correct.':
    '笔尖经过整个屏幕上方时均有足够间隙，悬停路径正确。',
  'Confirm Hover Verification': '确认悬停验证',
  'Calibration complete': '标定完成',
  'Calibration finished. You can close this tab.': '标定已结束，可以关闭此页。',
  'Could not finish calibration. Check the connection and try again.':
    '未能结束标定，请检查连接后重试。',
  'Review measured clicks': '检查点击测量结果',
  'Verifying clicks': '正在验证点击',
  'Mean Error': '平均误差',
  'Review calibration measurements': '请复核以下标定测量值',
  'Review targets allow {0}% relative measurement error.':
    '以下建议值均有 {0}% 的相对容差。',
  '{0} {1}% (target ≥{2}%)': '{0} {1}%（建议 ≥{2}%）',
  '{0} {1}% (target ≤{2}%)': '{0} {1}%（建议 ≤{2}%）',
  'Grid RMS {0} mm ({3}% of short edge) · Holdout maximum {1} mm ({4}%) · Coverage {2}%':
    '网格均方根误差 {0} mm（屏幕短边的 {3}%） · 独立验证最大误差 {1} mm（{4}%） · 覆盖率 {2}%',
  'Grid RMS': '网格均方根误差（占屏幕短边）',
  'Holdout maximum': '独立验证最大误差（占屏幕短边）',
  'Touch coverage': '触点覆盖率',
  'Plane RMS': '平面均方根误差（占高度补偿范围）',
  'Plane inliers': '平面拟合内点占比',
  'Plane sample span': '平面采点跨度（占对应屏幕边长）',
  'Holdout height error': '独立验证高度误差（占高度补偿范围）',
  'Screen axis skew': '屏幕两轴投影偏斜率',
  'Fit marker mean error': '拟合标记平均误差（占页面短边）',
  'Fit marker maximum error': '拟合标记最大误差（占页面短边）',
  'Check marker mean error': '验证标记平均误差（占页面短边）',
  'Check marker maximum error': '验证标记最大误差（占页面短边）',
  'Maximum Error': '最大误差',
  Target: '目标',
  Error: '误差',
  'Touch Duration': '触摸时长',
  'These measurements cover the web viewport. System bars use the fitted full-screen mapping and are not directly touch-verified by this page.':
    '这些测量覆盖网页显示区域。状态栏等系统区域使用拟合的整屏映射，本页面无法直接验证其触摸结果。',
  'I have reviewed the measurements and confirm the phone, camera and tool have not moved.':
    '已检查测量结果，并确认手机、相机和工具位置均未改变。',
  'Open the calibration page on the phone. No physical screen dimensions are required.':
    '在手机上打开标定页面，无需填写屏幕物理宽高。',
  'Keep the phone and computer on the same local network.':
    '手机与电脑需处于同一局域网。',
  'Keep the phone fixed, level and within reach of the stylus.':
    '将手机水平固定在触控笔可触达的位置。',
  'The phone reports touch coordinates. Stable contact points measure the screen plane and full-screen dimensions.':
    '手机页面上报触点坐标，后续稳定采点会测量接触平面和整屏尺寸。',
  'Record a safe position, collect nine contacts, then verify clicks with measured phone touches.':
    '先记录安全位置，再采集九个触点，再通过手机实际触点验证点击。',
  'The robot probes, records contacts and lifts automatically. Keep hands clear while collection runs.':
    '机械臂会自动探测、记录触点并抬笔。采集期间请勿触碰手机或机械臂。',
  'Page markers link web touches to the corrected image. Stable paired positions establish scale; independent targets measure click accuracy.':
    '页面标记连接网页触点和校正图，稳定配对位置建立物理尺度，独立点击目标量化网页区域的触摸精度。',
};
