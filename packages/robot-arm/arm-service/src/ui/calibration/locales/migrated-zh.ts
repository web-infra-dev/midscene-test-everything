const teachingBoundaryZh: Record<string, string> = {
  'Restoring phone page mapping…': '正在自动恢复手机页面映射…',
  'Phone page needs attention': '手机页面尚未就绪',
  'Open the bound phone page and enter fullscreen. It will reconnect automatically.':
    '请打开已绑定的手机页面并进入全屏，系统会自动重连。',
  'Exit Drag Mode to restore the phone page automatically.':
    '退出拖动模式后，系统会自动恢复手机页面。',
  'Checking the current phone page. Saved tool settings and teaching are retained.':
    '正在检查当前手机页面。已保存的工具参数和示教点会保留。',
  'Camera mapping ready': '相机映射已就绪',
  'Multi-screen calibration': '多屏标定',
  'Calibration batch': '标定队列',
  'Screen calibration results saved': '屏幕标定结果已保存',
  'Finish calibration and return': '完成标定并返回',
  'Shared Safe Position pending': '共用安全位待确认',
  'Advanced debugging': '高级调试',
  'Debug shared Safe Position search': '调试自动寻找共用安全位置',
  'Confirm the motion area is clear. The robot will move.':
    '机械臂将移动，请确认运动区域畅通。',
  'Start search': '开始搜索',
  'Stop search': '停止搜索',
  'Found shared Safe Position: X {0} mm / Y {1} mm / Z {2} mm':
    '找到共用安全位置 · X {0} mm / Y {1} mm / Z {2} mm',
  'Finish the batch screen calibrations before debugging the shared Safe Position.':
    '请先完成批量屏幕标定，再调试共用安全位。',
  'Unverified screens in last Safe Position check':
    '上次安全位检测未确认的屏幕',
  'Screen visibility passed': '屏幕可见性检测通过',
  'Screen visibility did not pass': '屏幕可见性检测未通过',
  'Whole screen': '整屏',
  'Screen interior': '屏内',
  'Largest unresponsive region (samples)': '最大连续无响应区（采样点）',
  'Confirm current shared Safe Position': '人工确认当前共用安全位',
  'Confirm the arm is stationary, clear of the camera and all screens, and does not block any screen in the live view.':
    '请确认机械臂已静止，与相机和所有屏幕保持安全距离，且实时画面中没有遮挡任何屏幕。',
  'The current position must clear the taught camera boundary by at least 20 mm.':
    '当前位置必须与已示教的相机边界保持至少 20 毫米的避让距离。',
  'Batch screens': '队列屏幕',
  'Screen list refresh timed out': '屏幕状态刷新超时',
  'Could not refresh the screen list': '暂时无法刷新屏幕状态',
  'Choose screens in calibration order': '按标定顺序选择屏幕',
  'Move screen up': '将屏幕前移',
  'Move screen down': '将屏幕后移',
  'Preparing screen': '正在准备屏幕',
  'Transferring to screen': '正在转场到目标屏幕',
  'Exploring screen': '正在探索屏幕',
  'Waiting for stylus placement': '等待摆放触控笔',
  'Waiting for calibration acceptance': '等待标定验收',
  'All screens are fixed horizontally, the tool has elastic compliance, and the camera-near side is the bottom of the original image.':
    '所有屏幕均已水平固定，触控工具具有弹性缓冲，相机近侧对应原始画面下方。',
  'All screens are fixed horizontally and the tool has elastic compliance.':
    '所有屏幕均已水平固定，触控工具具有弹性缓冲。',
  'Sampling mode': '采样模式',
  'Reconfirming the tool payload…': '正在重新确认工具负载…',
  'Waiting for the controller to reconfirm the tool payload.':
    '正在等待控制器重新确认工具负载。',
  'Could not reconfirm the robot connection and tool payload before calibration motion.':
    '标定运动前未能重新确认机械臂连接和工具负载。',
  'The controller tool payload differs from the saved tool payload. Sync the saved payload before motion.':
    '控制器当前负载与已保存的工具负载不一致，请在运动前同步工具负载。',
  'Tool payload is not confirmed for the saved tool. Apply it according to the adapter requirements before motion.':
    '尚未确认已保存的工具负载。请在机械臂状态栏同步工具负载后再开始。',
  'Automatic acceptance requires complete contact and plane evidence for the selected sampling mode':
    '自动验收要求接触证据完整，并满足所选采样模式的平面质量要求。',
  'The shared Safe Position must be outside the screen group and meet the minimum parking height.':
    '共用安全位必须位于整组屏幕范围之外，并达到最低停靠高度。',
  'The route to the shared Safe Position is outside the confirmed corridor.':
    '前往共用安全位的路线超出已确认的通行区域。',
  'Installation teaching and motion settings are required for batch parking.':
    '批量避让需要先完成安装示教并设置运动参数。',
  'Teach one shared Safe Position clear of all screens and the space between them. Check clearance for the full arm.':
    '请示教一个共用安全位，避开所有屏幕及屏间区域，并确认整条机械臂的避让空间。',
  'Confirm and record shared Safe Position': '确认并记录共用安全位',
  'Moving to the shared Safe Position': '正在前往共用安全位',
  'Checking screen visibility': '正在检查屏幕是否被遮挡',
  'Checking phone pages and finding the shared Safe Position':
    '正在检查手机页面并寻找共用安全位',
  'Check controller readiness before starting batch calibration.':
    '请先检查机械臂控制器状态，再启动批量标定。',
  'The robot is too close to the taught camera boundary for automatic parking. Check the camera installation and teaching.':
    '机械臂离已示教的相机边界太近，无法自动避让。请检查相机安装和示教位置。',
  'Keep all paired phone pages visible and fullscreen':
    '请保持所有已配对的手机标定页在前台全屏显示。',
  'A camera visibility check is required before recording the shared Safe Position.':
    '记录共用安全位前需确认相机能看清各屏。',
  'The camera could not verify every screen. Check the live view for glare or obstructions.':
    '相机未能确认所有屏幕可见。请检查实时画面中是否有反光或遮挡。',
  'No reachable camera-clear Safe Position was found within the bounded search.':
    '在限定范围内未找到相机视野清晰且可达的安全位。',
  'Shared parking needs the taught tool orientation. The tool is off by {0}° (allowed {1}°). Align it at a confirmed safe position and retry.':
    '工具朝向偏离示教值 {0}°，允许偏差为 {1}°。请在已确认的安全位置对齐工具朝向后重试。',
  'Recheck historical Safe Position': '复验历史共用安全位',
  'Start recheck': '开始复验',
  'No verified historical Safe Position matches the current calibration.':
    '没有找到与当前标定匹配的历史已验证安全位。',
  'The tool orientation changed during the shared parking search. Retry from a stable position.':
    '寻找共用安全位时检测到工具朝向发生变化，请让机械臂停稳后重试。',
  'The historical Safe Position is outside the current parking envelope.':
    '历史安全位超出当前工位允许的避让范围。',
  'No safe route to the historical Safe Position passed preflight from the current pose.':
    '从当前位置到历史安全位的路径未通过安全预检。',
  'The measured arrival was outside the tolerance for the historical Safe Position.':
    '机械臂的实测到位误差超过历史安全位允许的范围。',
  'The tool position changed during shared parking orientation alignment.':
    '共用安全位自动对齐时检测到工具位置变化，已中止本次搜索。',
  'The arm reached a candidate Safe Position, but the camera could not verify every screen.':
    '机械臂已到达候选安全位，但相机未能确认所有屏幕清晰可见。',
  'The camera could not verify every screen after automatic parking. Check the live view or record a Safe Position manually.':
    '自动避让后，相机仍未能确认所有屏幕可见。请检查实时画面或手动记录安全位。',
  'The screen visibility pattern could not be verified. Check the camera view and paired phone pages.':
    '无法识别屏幕显示的可见性图案，请检查相机画面和已配对的手机页面。',
  'The paired phones did not acknowledge the visibility pattern. Keep every page visible and fullscreen.':
    '未收到手机显示图案的确认，请刷新手机标定页并保持所有页面前台全屏。',
  'A phone page or display changed during visibility verification.':
    '可见性检查期间，手机页面或显示状态发生变化。',
  'The screen group changed during visibility verification.':
    '可见性检查期间，屏幕组或相机映射发生变化。',
  'Retry parking': '重试前往共用安全位',
  'Unknown sampling mode': '未知的采样模式',
  'All screens are secured; the measured plane allows limited tilt. The tool has elastic compliance.':
    '所有屏幕已固定；实测平面允许有限倾斜，触控工具有弹性缓冲。',
  'Measured plane: screen secured, limited tilt accepted, compliant tip.':
    '实测平面：屏幕已固定，允许有限倾斜，触控笔尖有弹性缓冲。',
  'Fast exploration requires a secured screen confirmation and a compliant touch tip':
    '快速探索前必须确认屏幕已固定，且触控笔尖有弹性缓冲。',
  'The screen plane was not measured before sampling':
    '采样前没有测量屏幕平面。',
  'The plane needs four measured grid corners':
    '平面测量需要四个实测网格角点。',
  'Automatic acceptance requires the measured-plane sliding run':
    '自动验收需要实测平面并保留滑动采集的运行。',
  'Not confirmed (record the safe position manually)':
    '未确认（手动记录安全位置）',
  Top: '上方',
  Bottom: '下方',
  Left: '左侧',
  Right: '右侧',
  'Auto exploration plans touches on a horizontal plane; the camera-near side only guides the automatic camera-avoidance retreat. Without it, the screen waits for a manually recorded safe position. Page mapping is prepared one screen at a time; the queue prompts for the screen it needs.':
    '自动探索按水平面规划触碰点；相机近侧可选，仅用于自动避让。未选择时该屏结束需手动记录安全位置。页面映射按屏幕逐块准备，队列运行到该屏时会提示。',
  'Auto exploration plans touches on a horizontal plane with the camera-near side at the bottom of the image. Page mapping is prepared one screen at a time; the queue prompts for the screen it needs.':
    '自动探索按水平面规划触碰点，并按“相机近侧＝画面下方”的约定换算坐标；勾选表示已确认屏幕水平固定、触控工具有弹性缓冲。页面映射按屏幕逐块准备，队列运行到该屏时会提示。',
  'The installation teaching (reference position and camera-side boundary) is recorded once for this camera and reused for every screen. The queue prepares each screen page mapping automatically and only stops when it cannot.':
    '示教（参考位与相机侧边界）只需为当前相机记录一次，队列内所有屏幕共用；队列会自动准备每块屏的页面映射，只有无法自动完成时才停下等待。',
  'Fill transfer area from screen calibrations': '按屏幕标定自动填充转场范围',
  'No accepted screen calibration is available for the transfer area.':
    '所选屏幕还没有已验收的标定，无法自动填充转场范围。',
  'Select the main camera first.': '请先选择主相机。',
  'This installation is remembered for the camera; the next run with the same screens starts with one click.':
    '本次安装设置会为该相机记住；下次选同一组屏幕即可一键开始。',
  '{0} screens detected': '{0} 块屏幕已识别',
  'Calibration order: {0}': '标定顺序：{0}',
  'Delete calibration': '删除标定',
  'Delete this calibration?': '删除这块屏幕的标定？',
  'Delete the saved calibration?': '删除已保存的标定？',
  'The record stays in history but stops being active; the screen returns to uncalibrated.':
    '标定记录会保留为历史，但不再生效；该屏幕将回到未标定状态。',
  'The record stays in history but stops being active. The screen returns to uncalibrated.':
    '标定记录会保留为历史，但不再生效，该屏幕将回到未标定状态。',
  'Acceptance required': '待验收',
  'Not configured': '未配置',
  Estimate: '估算',
  'Review the calibration plan again before starting.':
    '标定计划已变化，请重新查看后再开始。',
  'The run calibrates these screens in order; the first one is where the stylus already is.':
    '本次按以下顺序依次标定；第一块是触控笔当前所在的屏幕。',
  Calibrated: '已标定',
  'Not calibrated': '未标定',
  'Starts here': '从这里开始',
  'Pause for acceptance on each screen': '每块屏幕等待人工验收',
  'Automatic transfer between screens uses the swept area below. Check the whole arm, cables and fixtures before starting.':
    '屏幕之间会自动转场，使用下方扫掠范围。开始前请检查整条机械臂、线缆和支架。',
  'Transfer corridor (mm)': '转场走廊（mm）',
  'Confirm the fixed horizontal installation before the automatic batch':
    '开始自动标定前，请确认所有屏幕已水平固定。',
  'Confirm the automatic transfer corridor and clearance before the batch':
    '开始前，请确认自动转场的走廊和净空。',
  'Select the main camera before planning the batch':
    '请先选择主相机，再生成标定计划。',
  'A calibration batch is already active': '已有标定队列在运行。',
  'Finish the current workflow before starting a batch':
    '请先结束当前流程，再启动标定队列。',
  'A camera is required': '请选择相机。',
  'One screen is configured; use the single-screen automatic calibration above.':
    '当前只配置了 1 块屏幕，请使用上方的单屏自动标定。',
  'Save each screen automatically after all acceptance gates pass':
    '每屏通过全部验收门槛后自动保存',
  'Transfer automatically between calibrated screens':
    '在已有标定的屏幕之间自动转场',
  'Transfer coordinates are stylus-tip millimeters in the robot base frame. Include every neighboring screen, fixture and cable in the measured obstacle height.':
    '转场坐标为机械臂基坐标系下的笔尖毫米坐标。测量最高障碍高度时，应包含所有相邻屏幕、支架和线缆。',
  'Global travel tip Z (mm)': '全局横移笔尖 Z（mm）',
  'Highest obstacle Z (mm)': '最高障碍 Z（mm）',
  'Transfer clearance (mm)': '转场净空（mm）',
  'Corridor minimum X (mm)': '走廊最小 X（mm）',
  'Corridor maximum X (mm)': '走廊最大 X（mm）',
  'Corridor minimum Y (mm)': '走廊最小 Y（mm）',
  'Corridor maximum Y (mm)': '走廊最大 Y（mm）',
  'Transfer waypoints': '转场途经点',
  'Optional waypoints: one X,Y pair per line': '可选途经点：每行填写一组 X,Y',
  'I have checked the full arm swept corridor and the measured global clearance.':
    '我已检查整条机械臂扫掠走廊，并确认实测的全局净空。',
  'Enter every measured transfer coordinate.': '请填写全部实测转场坐标。',
  'Enter one X,Y transfer waypoint per line.':
    '请每行填写一组 X,Y 转场途经点。',
  'Confirm the full arm transfer corridor.': '请确认整条机械臂转场走廊。',
  'Save the screen setup before starting a batch.':
    '请先保存屏幕配置，再启动队列。',
  'Start calibration batch': '开始逐屏标定',
  'Stop batch': '停止队列',
  'Clear batch record': '清除队列记录',
  'Continue this screen': '继续当前屏幕',
  'Confirm Placement': '确认摆位',
  'Screen Details': '屏幕详情',
  'Start Position': '起始位置',
  'Calibration Order': '标定顺序',
  'Retry This Screen': '重试当前屏幕',
  'Skip This Screen': '跳过当前屏幕',
  'Check clearance for the full arm, cables and fixtures.':
    '请检查整条机械臂、线缆和支架的转场净空。',
  'Keep the phone page visible and the workspace clear.':
    '保持手机页面在前台，作业区无障碍。',
  'Prepare selected screen mapping': '准备所选屏幕映射',
  'Select the batch screen first.': '请先选择队列中的屏幕。',
  'Record current safe position': '记录当前位置为安全位置',
  'Accept and save this screen': '接受并保存当前屏幕',
  'Retry current screen and continue': '重试当前屏幕后继续',
  'Skip current screen and continue': '跳过当前屏幕后继续',
  'Attempts: {0}': '尝试次数：{0}',
  'Run history': '运行记录',
  'Confirm a clear arm corridor and a travel height above all screens, fixtures and cables':
    '请确认机械臂走廊畅通，且横移高度高于所有屏幕、支架及线缆。',
  'Automatic transfer requires accepted horizontal screen geometry':
    '自动转场需要已接受的水平屏幕几何。',
  'The transfer installation or tool orientation changed':
    '转场安装上下文或工具姿态已变化。',
  'Place the stylus above a calibrated screen or at its saved Safe Position before automatic transfer':
    '自动转场前，请将笔放在已标定屏幕上方或其已保存安全位置。',
  'The global transfer height does not clear the known geometry and approach height':
    '全局转场高度未满足已知几何及接近高度的净空要求。',
  'The transfer path leaves the confirmed arm corridor':
    '转场路径超出了已确认的机械臂走廊。',
  'The target leaves the confirmed batch arm corridor':
    '目标超出了队列已确认的机械臂走廊。',
  'The target screen needs a confirmed mapping and accepted calibration':
    '目标屏幕需要已确认映射及已接受标定。',
  'The transfer height is below the taught installation clearance':
    '转场高度低于安装示教要求的净空。',
  'Unexpected touch during screen transfer': '屏幕转场期间检测到意外触摸。',
  'The target page did not confirm a fresh touch state':
    '目标页面未确认新的触摸状态。',
  'The batch target mapping is no longer confirmed':
    '队列目标的映射已不再处于确认状态。',
  'The batch target mapping changed before motion':
    '动作开始前，队列目标映射已变化。',
  'A calibration batch owns the workstation': '标定队列正在占用工作站。',
  'The calibration batch owns the workstation; stop it before other operations':
    '标定队列正在占用工作站，请先停止队列再执行其他操作。',
  'Place the stylus 2–5 cm above the selected screen and confirm its page mapping':
    '请将触控笔放在所选屏幕上方 2–5 cm，并确认其页面映射。',
  'Starting from the verified transfer entry': '从已验证的转场起点开始探索。',
  'Service restarted; resume this batch explicitly after recovery':
    '服务已重启，请在恢复检查后明确继续此队列。',
  'Calibration batch stopped or paused': '标定队列已停止或暂停。',
  'Refresh the calibration batch before continuing':
    '队列状态已变化，请刷新后继续。',
  'Screen not configured': '屏幕待配置',
  'Screen unavailable': '屏幕暂不可用',
  'Screen mapping required': '屏幕映射待确认',
  'Screen calibration required': '屏幕待标定',
  'Screen acceptance required': '屏幕待验收',
  'Screen context ready': '屏幕上下文就绪',
  'Checking screen readiness': '正在检查屏幕状态',
  'Select this screen to configure its Screen Profile':
    '选择此屏幕以建立对应配置',
  'Complete acceptance for this screen calibration': '请完成此屏幕标定的验收',
  'No calibration is saved for this screen and tool':
    '此屏幕与工具尚无已保存标定',
  'Inspect and confirm the current mapping for this screen':
    '请检查并确认此屏幕当前的映射',
  'The saved mapping for this screen changed; confirm it again':
    '此屏幕已保存的映射发生变化，请重新确认',
  'Multiple pages match this screen': '多个页面匹配此屏幕，请检查页面绑定',
  'The selected screen page is offline, hidden, or needs mapping':
    '所选屏幕页面掉线、位于后台或需要重建映射',
  'The camera mapping for this screen is unavailable; confirm it first':
    '此屏幕的相机映射不可用，请先确认相机映射',
  'No page is paired for this screen; pair it on the phone':
    '此屏幕还没有配对页面，请在手机上配对',
  'The paired page reports a different screen size; re-pair this screen':
    '已配对页面的屏幕尺寸与当前屏幕不一致，请重新配对',
  'The page for this screen is connected but hidden; bring it to the foreground':
    '此屏幕的页面已连接但不在前台，请切回前台',
  'The page for this screen is not connected; open it on the phone':
    '此屏幕的页面未连接，请在手机上打开',
  'The page for this screen has no mapping; rebuild the page mapping':
    '此屏幕的页面还没有映射，请重新建立页面映射',
  'The page mapping for this screen is out of date; re-pair this screen to rebuild it':
    '此屏幕的页面映射已过期，请重新配对以重建映射',
  'Screen image dimensions changed; select this screen to synchronize its configuration':
    '屏幕图像尺寸已变化，请选择此屏幕以同步配置',
  'Screen mapping configuration changed': '屏幕映射配置已变化，需要重新确认',
  'The saved perspective for this screen no longer matches the camera view':
    '此屏幕的透视预设已不再匹配当前相机画面',
  'camera physically moved': '相机位置已变化，需要重新确认映射',
  'screen physically moved': '屏幕位置已变化，需要重新确认映射和机械标定',
  'The workstation changed while reading screen readiness':
    '检查屏幕状态期间工作站配置已变化',
  'Reload the current workstation before selecting a screen':
    '工作站配置已变化，请刷新后重新选择屏幕',
  'Calibration Screen': '标定屏幕',
  'Select a screen for calibration': '选择要标定的屏幕',
  'Target screen: {0}': '目标屏幕：{0}',
  'Target screen: the selected calibration screen':
    '目标屏幕：当前选中的标定屏幕',
  'Expected stylus start: X {0} mm / Y {1} mm':
    '触控笔应放置位置：X {0} mm / Y {1} mm',
  'Expected stylus start: unknown until a screen is calibrated':
    '触控笔应放置位置：在至少一块屏幕完成标定前无法推算',
  'The saved calibration screen is no longer bound to this camera; select a screen again before starting.':
    '上次选择的标定屏幕已不在当前相机的屏幕绑定中，请重新选择后再开始。',
  '"{0}" was re-bound to this camera; its accepted calibration is no longer linked. Recalibrate it to use this screen again.':
    '「{0}」的屏幕绑定已重建，原来的已接受标定不再关联；如需继续使用此屏幕，请重新标定。',
  '"{0}" was re-bound to this camera; its saved calibration is no longer linked.':
    '「{0}」的屏幕绑定已重建，原来的标定不再关联。',
  'The selected screen binding is unavailable': '所选屏幕绑定不可用',
  '"{0}" was re-bound to this camera ({1} old profiles); its accepted calibration is no longer linked. Recalibrate it to use this screen again.':
    '「{0}」的屏幕绑定已重建（{1} 个旧配置），原来的已接受标定不再关联；如需继续使用此屏幕，请重新标定。',
  '"{0}" was re-bound to this camera ({1} old profiles); its saved calibration is no longer linked.':
    '「{0}」的屏幕绑定已重建（{1} 个旧配置），原来的已保存标定不再关联。',
  'Save the screen setup before selecting a target':
    '请先保存屏幕配置，再选择标定屏幕',
  'The workstation changed while selecting the screen':
    '选择屏幕期间工作站配置已变化，请重新选择',
  'Select one screen page; multiple pages match the selected target':
    '多个页面匹配所选屏幕，请明确绑定一个屏幕页面',
  'Open the selected screen page and build its page mapping first':
    '请打开所选屏幕的页面并先完成页面映射',
  'The selected screen page or mapping changed; restart automatic exploration':
    '所选屏幕页面或映射已变化，请重新启动自动探索',
  'Select the camera bound to this Screen Profile':
    '请选择此屏幕配置绑定的相机',
  'This physical screen is already bound to another Screen Profile':
    '该实体屏幕已绑定到另一份屏幕配置',
  'The page does not belong to the selected screen': '此页面不属于所选屏幕',
  'Perspective correction is out of date': '透视校正已失效',
  'Perspective correction needs a check': '透视校正待确认',
  'Perspective status is unconfirmed': '透视状态待确认',
  'Outline may have shifted': '轮廓可能已偏移',
  'The outline is away from its saved position; review it and recalibrate.':
    '轮廓可能已偏离显示区域；请复核后重新校正。',
  'Perspective check': '透视校验',
  'Movement check': '变化检测',
  'Screen-width drift': '屏宽偏移',
  'AI screenshots and taps use the wrong position until you recalibrate.':
    '重新校正前，AI 截图和点击的位置不准。',
  'Check the outline before running AI.': '运行 AI 前请先确认屏幕轮廓。',
  'Check that the camera has not moved or come loose, then recalibrate.':
    '检查相机是否松动或移位，然后重新校正。',
  'Check the phone stand and screen position, then recalibrate.':
    '检查手机支架和屏幕位置，然后重新校正。',
  'Check the camera and the phone position, then recalibrate.':
    '检查相机和手机的位置，然后重新校正。',
  'Confirm the camera and the phone have not moved, then recalibrate.':
    '先确认相机和手机没有移动，再重新校正。',
  'Analyzed at {0}': '分析时间：{0}',
  'Camera movement suspected': '疑似相机移动',
  'More likely the camera moved; screen movement cannot be ruled out.':
    '更像是相机移动；屏幕是否同时移动无法判断。',
  'More likely the screen moved; camera movement is not excluded.':
    '更像是屏幕移动；相机是否同时移动无法完全排除。',
  'The image changed, but the cause is unknown.':
    '画面已变化，但原因无法判断。',
  'Local measurement': '本地测量',
  'AI assistance analysis': 'AI 辅助分析',
  'Stylus: {0}': '触控笔：{0}',
  'Stylus tip moved {0} working pixels from the reference.':
    '笔尖相对参考偏移 {0} 个工作像素。',
  'Drift is {0}% of screen width. AI screenshots and taps use the wrong position until you recalibrate.':
    '偏移 {0}% 屏宽；重新校正前，AI 截图和点击的位置不准。',
  'Mismatch confirmed at {0}; no stable recovery yet.':
    '失配确认于 {0}，尚未稳定恢复。',
  'Local geometry has not confirmed alignment or failure. Detection continues.':
    '本地几何尚未确认对齐或失效，检测继续。',
  'AI analysis: {0}': 'AI 分析：{0}',
  'AI recommendation: {0}': 'AI 建议：{0}',
  'Analyzed frame {0} · {1}': '第 {0} 帧 · {1}',
  'Attempts left this hour: {0}': '本小时剩余 {0} 次',
  'Hide details': '收起详情',
  'View details': '查看详情',
  Historical: '历史',
  'Camera view change detected': '相机视角变化',
  'Screen movement suspected': '疑似屏幕移动',
  'Screen projection changed; cause uncertain': '画面变化，原因待确认',
  'Verifying stylus reference': '触控笔复核中',
  'Stylus reference differs': '触控笔参考不同',
  'Movement check unavailable': '检测暂不可用',
  'Stylus reference will be established automatically': '触控笔参考待建立',
  'Local check: waiting for stationary pose feedback': '等待静止位姿',
  'Stylus reference pose does not match': '位姿与参考不符',
  'Stylus cannot be identified reliably': '触控笔识别不稳',
  'Movement cause uncertain': '原因待确认',
  'AI suggestion: cause remains uncertain': 'AI 建议：原因尚不明确',
  'AI suggestion: possible camera view change': 'AI 建议：疑似相机视角变化',
  'AI suggestion: possible screen movement': 'AI 建议：疑似屏幕移动',
  'AI suggestion: both may have changed': 'AI 建议：相机和屏幕可能均有变化',
  'AI suggestion: inspect the screen outline': 'AI 建议：检查屏幕轮廓',
  'AI suggestion: outline appears aligned; movement remains unconfirmed':
    'AI 建议：轮廓基本吻合，移动尚未确认',
  'Local verification in progress': '本地复核中',
  'AI analysis in progress': 'AI 分析中',
  'Historical AI suggestion': 'AI 历史建议',
  'AI analysis failed': 'AI 分析失败',
  'AI assistance cooling down': 'AI 辅助冷却中',
  'AI assistance rate limit reached': 'AI 辅助已限流',
  'AI assistance unavailable': 'AI 辅助不可用',
  'Local verification is still running; AI assistance waits for stable evidence.':
    '本地复核仍在进行，画面稳定后才会调用 AI 辅助。',
  'This change is being analyzed in the background; local detection continues.':
    '正在后台分析这次变化，本地检测继续。',
  'AI assistance result for this change.': '本次变化的 AI 辅助分析结果。',
  'Result from an earlier frame; the scene has changed since.':
    '较早画面的分析结果，画面此后已变化。',
  'This event will not be retried automatically.': '本次异常不会自动重试。',
  'AI assistance is cooling down; local detection continues.':
    'AI 辅助处于冷却期，本地检测继续。',
  'The hourly attempt limit is reached; local detection continues.':
    '已达本小时尝试上限，本地检测继续。',
  'No model is configured, so AI assistance is unavailable.':
    '未配置模型，AI 辅助不可用。',
  'This event has already been analyzed; the same scene does not trigger another model call.':
    '同次异常已分析，相同场景不会重复调用模型。',
  'A different scene was detected; assistance is waiting for its event conditions.':
    '已出现不同场景，正在等待事件条件。',
  'Local evidence is sufficient; another model call is unnecessary.':
    '本地证据已足够，无需再次调用模型。',
  'Waiting for persistent evidence and a stable scene.':
    '正在等待持续证据和稳定画面。',
  'Another assistance job is running; local detection continues.':
    '其他辅助任务正在运行，本地检测继续。',
  'A new event is waiting for the camera cooldown to end.':
    '新事件正在等待相机冷却结束。',
  'The hourly attempt limit is reached, including failed attempts.':
    '已达本小时尝试上限，失败尝试也计入。',
  'Configure a model to enable automatic event analysis.':
    '配置模型后可自动分析事件。',
  'Next eligible analysis time: {0}': '最早可再次分析：{0}',
  'AI suggestions do not replace local measurements or change calibration.':
    'AI 建议不替代本地测量，也不会修改标定。',
  'No reference scene is available; movement comparison is limited.':
    '缺少参考画面，前后对比受限。',
  'Automatic verification found a changed stylus image. The original reference is kept; check the camera and the tool first.':
    '自动复核发现触控笔画面与参考不同；原始参考已保留，请先检查相机和触控笔安装。',
  'Automatically verifying the saved stylus reference. Keep the robot still and the stylus visible; the original baseline is kept.':
    '正在自动复核已保存的触控笔参考；保持机械臂静止、触控笔可见，原始基准会保留。',
  'The robot session changed. Automatic verification is waiting for a fresh still pose and matching images.':
    '机械臂会话已更换，正在等待最新的静止位姿与吻合画面。',
  'The movement check failed. Earlier observations no longer apply.':
    '变化检测失败，之前的观测已失效。',
  'Screen projection change detected, but the stylus cannot be identified, so the cause is unknown.':
    '已检出画面变化，但触控笔无法可靠识别，原因未知。',
  'The still stylus shows a camera view change. Simultaneous screen movement cannot be determined.':
    '静止触控笔检出相机视角变化；是否同时有屏幕移动无法判断。',
  'The screen projection changed while the stylus stayed still. Screen movement is suspected; camera movement is not excluded.':
    '屏幕投影变化而触控笔稳定；倾向屏幕移动，未排除相机移动。',
  'No stylus reference is saved. Keep the stylus visible and the robot still; capture starts automatically once the screen is aligned.':
    '尚未建立触控笔参考。保持触控笔可见、机械臂静止，屏幕对齐后会自动采集。',
  'Fresh robot pose feedback is unavailable, so the stylus check cannot attribute the change.':
    '缺少最新的静止位姿反馈，触控笔检测无法判断变化原因。',
  'The robot pose differs from the stylus reference. Return to the reference pose before checking the cause.':
    '当前位姿与触控笔参考不符，请回到参考位姿后再检查原因。',
  'The stylus reference could not be matched reliably. Check visibility, focus and lighting.':
    '触控笔参考无法可靠匹配；请检查可见性、对焦和光照。',
  'Several image regions match the reference; the movement cause is uncertain.':
    '画面中有多个区域与参考吻合，变化原因不确定。',
  'The stylus and phone motions do not identify a single cause. Check both the camera and the screen position.':
    '触控笔与手机的位移无法归为同一原因，请同时检查相机和屏幕位置。',
  'No significant change in the stylus or screen reference. Movement below the detection threshold or hidden by symmetry is not excluded.':
    '触控笔和屏幕参考均未见明显变化；低于检测阈值或因对称而无法观测的移动仍未排除。',
  'The stylus check could not attribute the change.':
    '触控笔检测无法判断变化原因。',
  'Automatic capture will retry when the screen is aligned and the robot is stationary.':
    '屏幕对齐且机械臂静止后会自动限频重试采集。',

  'Flange target lies outside configured workspace':
    '机械臂末端目标超出允许范围。请查看目标坐标与边界，不要直接放宽机械臂限位。',
  'Automatic workflow owns the workstation; stop it before manual operations':
    '自动流程正在运行。请查看当前进度；如需手动操作，请先停止自动流程。',
  'Automatic workflow is already running':
    '自动流程已在运行，请查看现有任务进度。',
  'The scroll target was not reached by scrolling; Missing drag':
    '滚动后未到达目标，并且缺少拖拽完成记录。标定结果仍保留，请检查手机页面和触控反馈后重试标准任务。',
  'Sliding contact was lost; lift and retry with tap collection':
    '滑动过程中失去触控反馈。请检查笔尖接触和手机页面，再重新标定。',
  'Reload the saved teaching positions': '示教位置已更新，请刷新后再操作。',
  'Teaching capture interrupted': '示教记录已中断，本次位置未保存。',
  'A teaching capture is already running': '正在记录示教位置，请等待记录完成。',
  'Wait for teaching capture to finish':
    '请等待位置记录完成后再退出拖动；需要立即中断时可使用停止。',
  'Record and save this teaching position first':
    '请先记录并保存这个示教位置。',

  'Reference and Minimum Travel Height': '屏幕参考位（最低通行高度）',
  'Camera-side Boundary': '相机侧边界',
  'Camera-side Boundary at Reference Height': '相机侧边界（参考位高度）',
  'Place the tip 2–5 cm above the phone centre. This is the minimum height for free travel; only screen contact may go lower.':
    '将笔尖移到屏幕中心上方 2–5 cm。此位置同时定义最低安全通行高度；只有触屏动作才允许下降到它以下。',
  'Move straight from the reference towards the camera and stop at a safe boundary. The line through this point, perpendicular to that direction, marks the forbidden camera side. Leave clearance for the whole arm.':
    '从参考位朝相机方向移动，在机械臂本体快要碰到相机但仍安全的位置停下并记录相机参考位。该位置的法兰坐标是相机参考点，机械臂不会到达该点；请为整条机械臂留足空间。',
  'Review the reference and camera-side boundary. Free travel stays at or above the reference height; contact exploration descends only above the screen.':
    '确认参考位和相机侧边界。普通横移不低于参考位高度；接触探索仅在屏幕上方下降。',
  'The phone is horizontal, the stylus is vertical, and the full arm has camera clearance on the reference side of the boundary. There are no other obstacles.':
    '确认手机水平、触控笔竖直，参考位所在一侧的整臂路径不会碰到相机，且没有其他障碍物。',
  'Contact search remains limited to 60 mm below the reference. Other directions are not constrained by a taught box.':
    '接触搜索仍限制在参考位以下 60 mm 内；其他方向不再受示教矩形范围限制。',
  'Record the reference height and one camera-side boundary.':
    '记录屏幕参考位和相机侧边界，无需再记录通行高度。',
  'The reference defines minimum free-travel height. The camera-side boundary limits only one direction.':
    '参考位决定最低通行高度；相机参考位是允许到达的安全位，运动不会到达该点。',
  'Camera-side boundary — top view': '相机侧边界（俯视图）',
  'Reference travel height — side view': '参考位通行高度（侧视图）',
  'Forbidden side': '禁入侧',
  'Allowed side': '允许活动侧',
  'Move towards the camera; record the boundary':
    '朝相机方向移动，记录安全边界',
  'Free travel stays above this line': '普通横移保持在此高度或以上',
  'Only screen contact descends below the reference':
    '只有触屏动作下降到参考位以下',
  'Record the reference and camera-side boundary':
    '请记录屏幕参考位和相机侧边界。',
  'Record the camera-side boundary at least 20 mm from the reference':
    '相机侧边界距离参考位至少需要 20 mm，请沿相机方向重新示教。',
  'Target crosses the taught camera-side boundary':
    '目标越过了相机侧安全边界。请检查相机位置和示教边界，不要直接扩大范围。',
  'Record installation teaching for the current robot, tool and camera':
    '当前示教与设备或示教规则不匹配，请重新记录屏幕参考位和相机侧边界。',
};
const calibrationZh: Record<string, string> = {
  'Build the page mapping before automatic exploration':
    '请先建立页面映射，再开始自动探索。',
  'The device page disconnected, hid, or its mapping changed; restart automatic exploration':
    '设备页面已断开、切到后台或映射发生变化，请重新开始自动探索。',
  'Expected zero or one mapped touch':
    '检测到不明确的触摸状态，当前页面只能有一个映射触点。',
  'The phone did not confirm the current touch state; refresh its calibration page and retry':
    '手机未确认当前触摸状态，请刷新标定页面后重试。',
  'The touch did not release at the approach height':
    '笔尖抬到接近高度后触摸仍未释放。',
  'No confirmed release within the height probe; stopped instead of reusing a deep press':
    '在测高范围内未确认触摸释放，已停止。',
  'No screen touch was found within the search area; place the stylus closer to the centre and retry':
    '搜索范围内未检测到屏幕触摸，请将笔尖移近屏幕中心后重试。',
  'Page mapping changed before sampling': '采样前页面映射已变化，请重新开始。',
  'Touch samples are collinear; move to a different screen area':
    '触点共线，请换到屏幕的其他区域采样。',
  'At least three touch samples are required': '至少需要三个触点样本。',
  'Affine sample weights must be positive and finite':
    '映射拟合的样本权重必须为有限正数。',
  'Touch samples do not define an invertible screen mapping':
    '现有触点无法建立可逆的屏幕映射。',
  'Screen pixel dimensions are required': '请设置屏幕像素尺寸。',
  'Touch samples produce a degenerate screen frame':
    '触点分布无法确定有效的屏幕坐标系。',
  'Screen plane is vertical; automatic exploration requires a mostly horizontal screen':
    '屏幕平面接近竖直，自动探索要求屏幕基本水平。',
  'Measured screen axes are not perpendicular':
    '实测屏幕坐标轴不垂直，请检查触点和屏幕安装。',
  'Measured screen orientation is inconsistent with the contact plane':
    '实测屏幕方向与接触平面不一致。',
  'Invalid camera-near image edge': '原始画面中的相机近侧设置无效。',
  'Perspective rotation must be 0, 90, 180 or 270 degrees':
    '透视校正旋转角度必须为 0、90、180 或 270 度。',
  'Perspective corners must be finite image points':
    '透视校正角点必须是有效的图像坐标。',
  'Perspective quad must be convex and nondegenerate':
    '透视校正四边形必须为有效的凸四边形。',
  'Perspective direction is degenerate': '无法从透视映射确定有效方向。',
  'Fast calibration exhausted its local height-search budget; check the installation before retrying':
    '快速标定已用完局部测高预算。请检查安装状态后重试。',
  'No page touch within the fast local height-search budget; check the screen placement before retrying':
    '在快速标定允许的局部测高范围内仍未检测到触摸。请检查屏幕位置后重试。',
  'Adaptive height probe did not release': '自适应测高后触摸未释放，已停止。',
  'Adaptive light press did not confirm touch':
    '自适应轻压后仍未确认触摸，已停止。',
  'Motion wait aborted; stop is not implied':
    '运动等待已中断；这不代表机械臂已经停止。',
  'Physical completion is unknown': '无法确认机械臂动作是否已完成。',
  'Command belongs to an isolated channel':
    '指令所属连接已被隔离。请确认机械臂状态后重新连接。',
  'MG400 must be enabled, idle and fault-free before initializing the motion queue':
    '初始化运动队列前，MG400 必须已使能、空闲且无故障。',
  'Taught camera direction cannot be mapped to the screen':
    '无法将示教的相机方向换算到屏幕坐标。请重新检查示教位置与标定结果。',
  'No reachable camera-avoidance position': '未找到可达的相机避让位置。',
  'Automatic camera-avoidance pose is below the safe clearance':
    '自动相机避让位置未达到安全间隙。',
  'Fast exploration requires distributed targets':
    '快速探索需要分散的采样目标。',
  'Fast exploration requires four fit corners and two validation targets':
    '快速探索需要四个角部拟合点和两个独立验证点。',
  'Fewer than five grid touches were collected': '采集到的网格触点不足五个。',
  'Fewer than two validation touches were collected':
    '采集到的独立验证触点不足两个。',
  'The phone changed during location':
    '定位过程中手机页面或视口发生变化，请保持页面稳定后重试。',
  'Waiting for fullscreen marker rendering timed out':
    '等待全屏标记绘制超时。请保持手机页面在前台。',
  'Marker quality did not pass automatic mapping gates':
    '标记质量未通过自动映射检查。',
  'Fresh marker mapping evidence is missing':
    '缺少本次标记检测的页面映射数据。',
  'Fast boundary verification': '快速边界验证',
  'Standard boundary verification': '标准边界验证',
  'Measuring touch direction': '测量触摸方向',
  'Fitting the screen frame': '拟合屏幕坐标',
  'Enable and Enter Drag Mode': '使能并进入拖动模式',
  'Corner A': '边界点 A',
  'Corner B': '边界点 B',
  'Saved Teaching Positions': '已保存的示教位置',
  'Go to {0}': '前往{0}',
  'Keep the robot enabled and hold it still to record. You can remain in Drag mode.':
    '保持机械臂使能，停稳后即可记录，无需退出拖动模式。',
  'Enable the robot and hold it still before recording':
    '请使能机械臂并停稳后再记录',
  'Enable the robot before entering Drag mode':
    '进入拖动模式前必须先使能机械臂',
  'Save Teaching and Start Calibration': '保存示教并开始标定',
  'Automatic calibration uses the saved teaching reference. Keep the phone page visible and the workspace clear.':
    '自动标定使用已保存的示教参考位，请保持手机页面在前台、工作区域无遮挡。',
  'Keep the stylus contact direction unchanged; rotation around its axis is allowed':
    '请保持笔尖接触方向一致；允许末端绕笔轴转向。',
  'Restore the taught stylus contact direction before starting':
    '开始前请恢复示教时的笔尖接触方向；无需恢复绕笔轴的转角。',
  'Use the live camera view while dragging. Check the whole arm directly before recording.':
    '拖动时可参考实时画面；记录前，请直接检查整条机械臂的实际位置。',
  'Connect Phone': '连接手机',
  'Waiting for phone': '等待手机连接',
  'Select an online camera to see its preview.':
    '选择已连接的相机，即可查看实时画面。',
  'Tap the iPhone page once so the camera can locate the screen boundary.':
    '请轻点 iPhone 上的标定网页一次，再保持手机不动，等待相机识别屏幕边界。',
  'Keep the entire phone visible in the camera preview.':
    '调整相机，让手机完整出现在画面中。',
  'Scan the code with your phone, then keep the opened page visible and fullscreen.':
    '用手机扫码打开页面，再将页面保持在前台全屏显示。',
  'The page must be in fullscreen before calibration starts: tap Enter full screen on the phone. If the system keeps a status bar or refuses fullscreen, use the phone browser menu, then tap Full screen ready on the phone. System bars may remain; calibration uses the visible page area. Confirm again after resizing or rotating.':
    '标定开始前页面必须处于全屏：请在手机上点“进入全屏”。若系统仍保留状态栏或拒绝全屏，请先通过手机浏览器菜单进入全屏，再点手机上的“已全屏，继续”。系统状态栏可能仍会保留，标定使用页面可见区域。改变尺寸或旋转后需重新确认。',
  'Phone page address': '手机页面地址',
  'Phone connected. You can continue.': '手机已连接，可以继续下一步。',
  'All {0} screen pages are connected. You can continue.':
    '全部 {0} 个屏幕页面已连接，可以继续下一步。',
  '{0} screen pages are connected. You can continue.':
    '已连接 {0} 个屏幕页面，可以继续下一步。',
  'All {0} screen pages are open and assigned to this camera. You can continue.':
    '全部 {0} 个屏幕页面已打开并绑定到该相机，可以继续下一步。',
  'The screen page is open and assigned to this camera. You can continue.':
    '屏幕页面已打开并绑定到该相机，可以继续下一步。',
  'Waiting for {0} fullscreen screen pages.': '等待 {0} 个全屏屏幕页面。',
  'Waiting for a fullscreen phone page.': '等待手机页面进入前台全屏状态。',
  'Every open screen page is listed below. Connect one page for each screen.':
    '下方列出了所有已打开的屏幕页面。请为每块屏幕各连接一个页面。',
  'Observing camera': '观测相机',
  'A page is bound to this camera when it connects; bind an already connected page on its row. The current camera is selected by default.':
    '页面连接时会绑定到该相机；已连接的页面可在对应行绑定。默认选择当前相机。',
  'Connect {0} to {1}': '把 {0} 连接到 {1}',
  Unbound: '未绑定',
  'Bind to this camera': '绑定到该相机',
  'Bind {0} to {1}': '把 {0} 绑定到 {1}',
  'Restore Home': '恢复首页',
  'Restore {0} to its home page': '将 {0} 恢复到首页',
  'Return this page to its home view and release its page-mapping session.':
    '让此页面回到首页视图，并释放当前页面映射会话。',
  'Restored the page to its home view.': '页面已恢复到首页。',
  'Bind each fullscreen page to this camera; an unbound page does not count.':
    '请把每个全屏页面绑定到该相机；未绑定相机的页面不计入。',
  'Screen pages bound to another camera are not listed here ({0}).':
    '已绑定到其他相机的屏幕页面不在此列出（{0} 个）。',
  'Open the page on the phone, then connect it below. You do not need to type the pairing code.':
    '在手机上打开页面后，在下方连接该页面，无需在手机上输入配对码。',
  'Use Restore Home on a page in marker calibration before connecting it here.':
    '标记标定中的页面请先在对应行点击“恢复首页”，再在此连接。',
  'Move the robot arm and stylus away from the screen and avoid reflections on the glass, then retry.':
    '请把机械臂和笔尖移出屏幕范围，避开屏幕上的反光后重试。',
  'Keep each screen page visible and in fullscreen.':
    '请保持每个屏幕页面在前台并全屏显示。',
  '{0} screen pages connected': '{0} 个屏幕页面已连接',
  'Connect {0}': '连接 {0}',
  'Screen pages {0}': '屏幕页面 {0}',
  'Screen pages: {0} connected': '屏幕页面：已连接 {0}',
  'In background': '在后台',
  'Not fullscreen': '未全屏',
  Connected: '已连接',

  'Camera and Phone': '相机与手机',
  'Tool Settings': '工具设置',
  'Reference Position': '参考位',
  'Record Corner A': '记录角 A',
  'Record Corner B': '记录角 B',
  'Clearance Height': '通行高度',
  'Review Installation Teaching': '检查安装示教',
  'Save Teaching and Continue': '保存示教，下一步',
  'Record Current Position': '记录当前位置',
  'Record the reference, phone placement area and clearance height.':
    '依次记录参考位置、手机摆放范围和通行高度。',
  'Exit Drag mode and wait for the robot to stop before recording.':
    '退出拖动模式，待机械臂停稳后记录。',
  'Two corners define the phone placement area, not full-arm collision clearance.':
    '两个角点定义手机摆放范围，不能证明整臂路径无碰撞。',
  'Place the tip 2\u20135 cm above the phone centre. Keep the stylus vertical.':
    '将笔尖放到手机中心上方约 2–5 cm，保持触控笔竖直。',
  'Keep the tip suspended. Move to the first corner of the phone placement area, following the base orientation in the diagram.':
    '保持笔尖悬空，按图中基座方向移到手机摆放范围的第一个角。',
  'Keep the tip suspended. Move to the opposite diagonal corner. These are placement boundaries, not screen corners.':
    '保持笔尖悬空，移动到另一个对角。这是手机摆放范围，不是屏幕四角。',
  'Lift above the reference to a clear travel height. Check the whole arm against the camera stand and cables.':
    '从参考位置抬升到无遮挡的通行高度，检查整臂与相机支架、线缆的间隙。',
  'Recording a new reference clears the other taught points. Saved installation remains unchanged until you save.':
    '重新记录参考位置会清除其他示教草稿点；保存前，已有安装参考保持不变。',
  'Review the recorded positions. The system will lift to the taught clearance height and return to the reference before contact exploration.':
    '检查已记录的位置。系统会先抬到示教的通行高度，再返回参考位置进行接触探索。',
  'Contact search is limited to 60 mm below the reference. Two corners only define the phone placement area.':
    '接触探索最多向参考位置下方搜索 60 mm；两个角点只定义手机摆放范围。',
  'Phone placement area \u2014 top view': '手机摆放范围 · 俯视图',
  'Stylus height \u2014 side view': '笔尖高度 · 侧视图',
  'Two diagonal corners, not screen corners': '两个范围对角，不是屏幕四角',
  'Keep the phone horizontal and the stylus vertical': '手机水平，触控笔竖直',
  'Record the reference, both corners and clearance height':
    '请记录参考位置、两个角点和通行高度',
  'Teach two separated diagonal corners and a clearance height at least 20 mm above the reference':
    '请记录两个分开的对角，并将通行高度设在参考位置上方至少 20 mm',
  'Exit Drag mode and wait for the robot to stop before recording':
    '请退出拖动模式，待机械臂停稳后记录',
  'Main Camera': '主相机',
  'Open the phone binding page and keep it fullscreen. The service detects the page and reads its resolution automatically.':
    '打开手机绑定页面并保持全屏，服务会自动发现页面并读取分辨率。',
  'Keep the phone page visible and fullscreen': '请保持手机页面在前台并全屏',
  'Calibrating camera focus and exposure': '正在标定相机对焦和曝光',
  'Optimizing camera image quality': '正在优化相机成像质量',
  'Installation reference saved independently of calibration.':
    '安装参考已独立保存，不受重标定结果影响。',
  'Update Installation Teaching': '更新安装示教',
  'Save Installation Reference': '保存安装参考',
  'Set the tool length and payload, drag the tip 2\u20135 cm above the phone centre, then exit Drag mode. Enter the clear approach region in robot base coordinates. Include lifting, lateral travel and the safe position.':
    '设置工具长度和负载，将笔尖拖到手机中心上方 2–5 cm 后退出拖动模式。按机械臂基坐标填写无遮挡的接近区域，包含抬升、横移和安全位置。',
  'The phone is horizontal, the stylus is vertical, and the full arm path within this region is clear. Camera visibility alone does not confirm clearance.':
    '确认手机水平、触控笔竖直，区域内整臂路径无遮挡。仅凭相机看见手机不能确认路径安全。',
  Minimum: '最小值',
  Maximum: '最大值',
  'Connect Devices': '连接设备',
  'Teach Installation': '示教安装',
  'Verify and Complete': '验证并完成',
  'Calibration has been verified and saved. The standard task requires a model for target recognition, scrolling and visual assertions; configure a model to run it.':
    '标定已验证并保存。标准任务的目标识别、滚动和视觉断言需要模型；配置模型后可运行标准任务。',
  'Complete one calibration before using Agent approach.':
    '先完成一次基础标定，再使用 Agent 接近。',
  'Approaching the screen': '正在接近屏幕',
  'Keep the phone page visible. Fixed setup approaches automatically using the saved calibration.':
    '保持手机页面在前台。固定布局会利用已有标定自动接近。',
  'Approach using the saved geometry, then explore automatically. Keep the workspace clear.':
    '利用已有几何接近后自动探索，请保持工作区无遮挡。',
  'Fixed setup: horizontal screen, compliant tip, camera toward the bottom of the image.':
    '固定布局：屏幕水平、笔尖有弹性，相机位于原图下方。',
  'Save automatically when verification passes': '验证通过后自动保存',
  'Accepted automatically': '已自动接受',
  'Move to the calibration start': '准备到标定起点',
  'Start first automatic calibration': '开始首次自动标定',
  'Start automatic calibration': '开始自动标定',
  'First automatic calibration. Drag the stylus 2–5 cm above the screen centre, keep the page visible, then start. The workflow opens the page mapping if needed, calibrates, saves and runs the standard task.':
    '首次自动标定：将笔尖拖到屏幕中心上方 2–5 cm，保持页面在前台后开始。流程会在需要时打开页面映射，然后完成标定、保存并运行标准任务。',
  'One-click automatic calibration: prepare the approach, calibrate and save. Run the standard task separately when needed. Keep the page visible and the workspace clear.':
    '一键自动标定：准备接近位、完成标定并保存；标准任务稍后按需单独运行。请保持页面在前台、工作区无遮挡。',
  'This first run uses the taught position. Later runs use the saved geometry. Stop remains available.':
    '首次运行使用示教位置；后续运行使用已保存几何。停止始终可用。',
  'Stop remains available. Every deterministic gate still has to pass before saving.':
    '停止始终可用；保存前仍需通过全部确定性门槛。',
  'Moving to the calibration start': '正在移动到标定起点',
  'Lifts first if needed, traverses above the screen and stops 30 mm above its centre.':
    '需要时先垂直抬起，在屏幕上方横移，最后停在屏幕中心上方 30 mm。',
  'Configure a model to save automatically.': '配置模型后可使用自动保存。',
  'Open the screen page and build its mapping first':
    '请打开屏幕页面并先建立页面映射',
  'Page mapping timed out': '页面映射超时',
  'Automatic workflow timed out': '自动流程超时',
  'Automatic workflow stopped': '自动流程已停止',
  'Restart the robot service before using automatic workflow':
    '使用自动流程前请重启机械臂服务',
  'Automatic workflow stopped or paused; start it again explicitly':
    '自动流程已停止或暂停，请重新显式启动',
  'Automatic workflow did not return a saved calibration':
    '自动流程没有返回已保存的标定',
  'The standard task did not pass': '标准任务未通过',
  'Every deterministic gate must still pass; otherwise the result stays pending for manual acceptance.':
    '仍需通过全部确定性门槛；否则结果会保留为待人工接受。',
  'Automatic acceptance withheld': '自动接受未执行',
  'Automatic acceptance stopped; manual review required':
    '自动接受已停止，需要人工检查',
  'Keep the phone page visible. Start exploration when the tip is above the screen.':
    '保持手机页面在前台，笔尖到达屏幕上方后开始探索。',
  'Camera-near side of the original image': '原始画面中靠近相机的一侧',
  'The camera-near side of the original image is unconfirmed or its mapping is unavailable; record the safe position manually.':
    '原始画面中靠近相机的一侧未确认，或映射不可用；请手动记录安全位置。',
  'Unconfirmed: record safe position manually': '未确认：手动记录安全位置',
  'Top of original image': '原图上方',
  'Right of original image': '原图右方',
  'Bottom of original image': '原图下方',
  'Left of original image': '原图左方',
  'Choose the camera-near side for this mounting in the uncorrected image, regardless of the phone content orientation.':
    '根据当前安装关系，选择原始画面中靠近相机的一侧；与手机内容朝向无关。',
  'Reconnect Screen Page': '重新连接屏幕页面',
  'More than one screen page is associated with this calibration screen. Reconnect the intended phone page and try again.':
    '此标定屏幕关联了多个屏幕页面。请重新连接目标手机页面后重试。',
  'The bound phone page did not return to the marker view. Keep the page open and try again.':
    '已绑定的手机页面未能返回标记页面。请保持页面打开后重试。',
  'Keep the screen and camera in their calibrated positions.':
    '请保持屏幕和相机在标定时的位置。',
  'Connect the phone page to the saved screen {0}.':
    '将手机页面连接到已保存的屏幕“{0}”。',
  'Connect each phone page to its saved screen.':
    '请把每台手机页面分别连接到对应的已保存屏幕。',
  'The saved perspective preset is unavailable.': '找不到已保存的透视预设。',
  'Return and keep calibration draft': '保留标定草稿并返回',
  'Change safe position': '重新记录安全位置',
  'Change the safe position? Screen measurements and boundary checks are retained.':
    '重新记录安全位置？屏幕采样和边界验证结果会保留。',
  'Discard calibration and return': '放弃本次标定并返回',
  'Accept and save calibration': '接受并保存标定',
  'Start standard Midscene task': '开始标准 Midscene 任务',
  'Retry standard Midscene task': '重试标准 Midscene 任务',
  'Stop task and return': '停止任务并返回',
  'Stopping...': '正在停止…',
  'Return without running the task': '暂不运行，返回',
  'Standard Midscene task running': '标准 Midscene 任务运行中',
  'Standard Midscene task complete': '标准 Midscene 任务已完成',
  'Calibration saved: standard Midscene task': '标定已保存：验证标准任务',
  'Calibration and standard task complete': '标定与标准任务均已完成',
  'Calibration has been accepted and saved': '标定已接受并保存',
  'The robot is running the standard task. You can stop and return at any time.':
    '机械臂正在执行标准任务，可随时停止并返回。',
  'Review or download the report, then finish.':
    '查看或下载报告后，完成本次流程。',
  'Next, validate the saved calibration with the standard Midscene task. Returning keeps the calibration.':
    '下一步运行标准 Midscene 任务验证效果；返回会保留已保存的标定。',
  'The standard task passed. The saved calibration is ready.':
    '标准任务通过，已保存的标定可用。',
  'The saved calibration is retained. You can retry or return.':
    '已保存的标定仍然保留，可以重试或返回。',
  'Maximum tap execution error: {0} mm': '点击执行最大误差：{0} mm',
  'Fast mode: screen secured horizontally; compliant tip.':
    '快速模式：屏幕已水平固定，触控笔有弹性缓冲。',
  'Use sliding collection (experimental)': '滑动采集（实验功能）',
  'Horizontal screen confirmed. Later contacts use the first height. Keep the page visible and clear the workspace.':
    '已确认屏幕水平固定，后续按首次高度点按。请保持页面前台，清空工作区。',
  'Place the stylus 2–5 cm above the screen centre. Keep the page visible and clear the workspace.':
    '笔尖放在屏幕中心上方 2–5 厘米。保持页面前台，清空工作区。',
  'Cannot scan? Enter the pairing code.': '无法扫码时输入配对码。',
  'Keep the phone page open.': '保持手机页面打开。',
  'Recalibrate this screen; no new binding is needed.':
    '重新标定此屏幕，无需重新绑定。',
  'Check the camera, then retry.': '检查相机后重试。',
  'Tap Enter Full Screen on the phone. Mapping resumes automatically.':
    '在手机上点击“进入全屏”，将自动继续。',
  'Unlock the phone and open its screen page.': '解锁手机并打开屏幕页面。',
  'Keep the phone page visible and in fullscreen. Mapping continues automatically.':
    '保持手机页面前台、全屏，将自动继续。',

  'Screen devices are already bound': '屏幕设备已绑定',
  'Keep the existing screen page open. It will switch back to markers automatically; no new binding is needed.':
    '请保持原来的屏幕页面打开，页面会自动切回标记，无需重新绑定。',
  'Complete Screen Calibration': '完成屏幕标定',
  'Device Bound': '设备已绑定',
  'Markers Detected': '标记已检测',
  'Waiting for the phone page': '等待手机页面确认',
  'Bring the phone page to the foreground': '请将手机页面切回前台',
  'Enter fullscreen on the phone': '请在手机上进入全屏',
  'Finishing screen calibration': '正在完成屏幕标定',
  'Screen calibration ready': '屏幕标定已就绪',
  'Detect the screen markers again': '请重新检测屏幕标记',
  'Screen calibration could not finish': '屏幕标定尚未完成',
  'Perspective Correction and Page Mapping are ready. Keep this phone page open for robot calibration.':
    '透视校正和页面映射均已就绪。请保持手机页面打开，随后可进行机械臂标定。',
  'The page or camera layout changed. Keep the same bound phone page open and recalibrate this screen; no new binding is needed.':
    '页面或相机布局已变化。请保持同一个手机页面打开，并重新标定此屏幕，无需重新绑定。',
  'Check the camera connection and retry. The saved screen result and phone binding are retained.':
    '请检查相机连接后重试，已保存的屏幕结果和手机绑定会保留。',
  'Tap Enter Full Screen on the phone. Mapping will continue automatically; do not reload or scan again.':
    '请点击手机上的“进入全屏”，随后会自动继续映射，无需刷新或重新扫码。',
  'Unlock the phone and return to its bound screen page. Mapping will continue automatically.':
    '请解锁手机并切回已绑定的屏幕页面，随后会自动继续映射。',
  'Keep the bound phone page visible and in fullscreen. Its next status updates will finish mapping automatically.':
    '请保持已绑定的手机页面位于前台并全屏显示，收到确认后会自动完成映射。',
  'Retry Automatic Mapping': '重试自动映射',
  'Advanced Page Mapping': '页面映射高级工具',
  'Could not refresh screen status. Automatic mapping will continue when the service reconnects.':
    '暂时无法更新屏幕状态，服务连接恢复后将继续自动映射。',
  'The bound screen page is missing. Reopen screen calibration to reconnect it.':
    '所绑定的屏幕页面已失效，请返回屏幕标定重新连接。',
  'Screen session expired. Reopen screen calibration to reconnect the bound phone page.':
    '屏幕会话已失效，请重新进入屏幕标定，连接原手机页面。',

  'Screen calibration complete. Page mapping is ready.':
    '屏幕标定完成，页面映射已就绪。',
  'Marker Calibration · {0}': '标记标定 · {0}',
  'Marker Calibration': '标记标定',
  Calibrated: '已标定',
  'Detect Markers': '检测标记',
  'Detect Markers Again': '重新检测标记',
  'Detect Screens': '检测全部屏幕',
  'Retry Screen Calibration': '重新尝试标定',
  'Add Screen': '添加屏幕',
  'Pair target screens': '配对目标屏幕',
  'Configured address': '配置地址',
  'LAN address': '局域网地址',
  'Local name (mDNS)': '本地名称（mDNS）',
  'This computer': '本机',
  'Pairing page QR code': '配对页二维码',
  'Scan this code with a phone camera.': '可使用手机相机扫描此二维码。',
  'Marker display QR code': '标记展示二维码',
  'Connect a screen page': '连接屏幕页面',
  'Screen page QR code': '屏幕页面二维码',
  'Scan this code on the next empty screen.': '在下一块空屏幕上扫描此二维码。',
  'All screens are assigned to a screen page.': '所有屏幕都已分配屏幕页面。',
  'Screen page address': '屏幕页面地址',
  'Copy screen page address': '复制屏幕页面地址',
  'Open screen page here': '在此打开屏幕页面',
  'Each new page binds the next unassigned screen; opened pages appear below.':
    '每个新页面会自动绑定下一块未分配的屏幕；已打开的页面显示在下方。',
  'Create Screen': '新建屏幕',
  'Screen Name': '屏幕名称',
  'Create and bind screen': '新建并绑定屏幕',
  'Create a screen, then bind its device page': '先新建屏幕，再绑定设备页面',
  'Choose a screen name that is not already in use.':
    '请使用尚未占用的屏幕名称。',
  'Give each physical screen a unique name. After creating it, open its binding link on the device or assign an already open page. Keep the same page open for calibration and automatic page mapping.':
    '为每块实体屏幕填写唯一名称。新建后，在设备上打开绑定链接，或分配已经打开的页面。标定和自动页面映射始终使用同一个页面。',
  'The device page is in the background.': '设备页面当前处于后台。',
  'The device page is disconnected.': '设备页面已断开连接。',
  'Open the bound screen page on the device, keep the screen unlocked and the page in the foreground. Mapping becomes available automatically after its next heartbeat.':
    '请在设备上打开已绑定的屏幕页面，保持屏幕解锁且页面位于前台。收到页面心跳后，将自动允许建立映射。',
  'Page mapping is already running': '页面映射正在进行，请等待完成。',
  'Configure the camera and screen corners before mapping':
    '请先配置相机并确认屏幕四角，再建立映射。',
  'The device page is disconnected. Open the bound page on the device and wait for it to reconnect.':
    '设备页面已断开。请在设备上打开已绑定页面，等待连接恢复。',
  'The device page is in the background. Bring it to the foreground and keep the screen unlocked before mapping.':
    '设备页面处于后台。请先切回该页面并保持屏幕解锁，再建立映射。',
  'Fast mode: I confirm the screen is horizontal and secured, with a compliant touch tool.':
    '快速模式：我确认屏幕水平固定，且触控工具具有弹性缓冲。',
  'Fast mode uses six grid points and direct descent after the first contact. Horizontal height is assumed, not measured at every point. Boundary verification and final acceptance remain required.':
    '快速模式采集六个网格点，首次接触后直接下探至已知高度。后续使用水平高度假设，不逐点测量倾斜；仍需完成边界验证和最终验收。',
  'Use sliding collection between grid points (experimental)':
    '网格点间使用滑动采集（实验性）',
  'Fast mode assumes a horizontal, secured screen and a compliant touch tool. After the first height search, later contacts go directly to the known height. If sliding collection is selected, contact is maintained between grid points. Confirm the setup is unchanged, keep the page visible and clear the workspace.':
    '快速模式假设屏幕水平固定、触控工具具有弹性缓冲。首次探测高度后，后续直接到达已知接触高度；选择滑动采集时，网格点之间保持接触。请确认安装未变、设备页面位于前台，并清空运动区域。',
  'Fast exploration requires confirmation that the screen is horizontal and secured':
    '快速探索前必须确认屏幕已水平固定。',
  'Sliding contact was lost; lift and retry with tap collection':
    '滑动采集时丢失触摸反馈，请抬起后改用点按采集重试。',
  'Horizontal height (assumed)': '水平高度（假设值）',
  'Available screen pages': '可用屏幕页面',
  'Waiting screen pages': '等待中的屏幕页面',
  'Assign {0} to a screen': '把 {0} 分配到屏幕',
  Assign: '分配',
  'Waiting for a screen page to open...': '等待屏幕页面打开…',
  '{0} is connected to another screen. Open the page on the screen you are calibrating.':
    '{0} 已连接到另一块屏幕。请在当前正在标定的屏幕上打开该页面。',
  'These corners match the outline saved for {0}. Each screen needs its own screen page; open one page per screen, then detect again.':
    '当前四角与已保存的“{0}”轮廓重合。每块屏幕都需要独立的屏幕页面，请为每块屏幕分别打开一个页面后重新检测。',
  '{0} matches the outline saved for {1}. Each screen needs its own screen page; open one page per screen, then detect again.':
    '“{0}”与已保存的“{1}”轮廓重合。每块屏幕都需要独立的屏幕页面，请为每块屏幕分别打开一个页面后重新检测。',
  '{0} and {1} share the same outline. Recalibrate one of them.':
    '“{0}”与“{1}”的轮廓完全重合，请重新标定其中一块屏幕。',
  'If the code cannot be scanned, enter the pairing code shown on each screen card.':
    '如果无法扫码，可在手机页面输入每块屏幕卡片上显示的配对码。',
  'Assigned to {0}': '已分配给 {0}',
  Unassigned: '未分配',
  'Release {0}': '释放 {0}',
  'That screen page is still being created.':
    '该屏幕页面仍在创建中，请稍后重试。',
  'Page mapping will be built automatically. Keep the screen page open and in full screen.':
    '将自动建立页面映射，请保持屏幕页面打开并处于全屏。',
  'Screen pages switched to page mapping.': '屏幕页面已切换到页面映射。',
  'Screen calibration service did not create a session.':
    '屏幕标定服务没有创建会话。',
  'Open each screen page on its target screen, then keep every screen still while the camera detects all registered markers.':
    '请在每块目标屏幕上打开对应的屏幕页，然后保持所有屏幕静止，等待相机检测全部已登记标记。',
  'Or enter this code on the phone page.': '也可以在手机页面输入此配对码。',
  'Pairing page address': '配对页地址',
  'Copy pairing page address': '复制配对页地址',
  'Pairing page address copied': '配对页地址已复制',
  'Unable to copy the pairing page address': '无法复制配对页地址',
  'Open the selected address on each target screen, or scan the code on a phone.':
    '请在每块目标屏幕上打开所选地址，或直接使用手机扫描二维码。',
  'Open {0} on each target screen, then enter the pairing code below.':
    '请在每个目标屏幕打开 {0}，然后输入下方配对码。',
  'Pairing code': '配对码',
  'Scan or enter a pairing code': '扫码或输入配对码',
  'Open the page on the phone, then select it below to connect. You do not need to type the pairing code.':
    '打开手机页面，在下方选择该页面后连接，不需要在手机上输入配对码。',
  'Open the screen page on the phone. It appears here automatically.':
    '手机打开屏幕页面，页面会自动出现在这里。',
  'Copy pairing code': '复制配对码',
  'Pairing code copied': '配对码已复制',
  'Unable to copy the pairing code': '无法复制配对码',
  Paired: '已配对',
  'Remove {0}': '删除 {0}',
  'All screens are ready': '所有屏幕已就绪',
  'Move your hand away. Detecting in {0}…': '请移开手，{0} 秒后开始检测…',
  'Keep still. Retrying in {0}…': '请保持不动，{0} 秒后自动重试…',
  'Keep the device page visible and in fullscreen.':
    '请保持设备页面位于前台并全屏显示。',
  'Tap Enter full screen on the phone; detection starts by itself.':
    '请在手机上点击“进入全屏”，检测会自动开始。',
  'Marker detection response is empty': '未收到标记检测结果，请重试。',
  'Multi-screen calibration results': '多屏标定结果',
  'The screens are applied. Select the main screen again in the camera mapping step.':
    '屏幕已应用。请在“相机映射”步骤重新选择主屏幕。',
  'The detected screens were not applied automatically.':
    '检测到的屏幕未能自动应用。',
  'Each screen has its own perspective result. Review successful screens individually and retry only the screens that failed.':
    '每个屏幕都有独立的透视结果。请分别检查成功屏幕，并只重试失败屏幕。',
  'Each screen has its own perspective result. Review or retry screens individually, then apply all successful results together.':
    '每个屏幕都有独立的透视结果。可以分别检查或重试，最后一次性应用所有成功结果。',
  'No screen produced a usable calibration result':
    '没有任何屏幕生成可用的标定结果',
  'Review Result': '检查结果',
  'Recalibrate This Screen': '重新标定此屏幕',
  'Apply All Results': '应用全部结果',
  'Applied {0} screen calibrations': '已应用 {0} 块屏幕的标定结果',
  'Active Screen': '活动屏幕',
  'Screen name': '屏幕名称',
  'Screen name for {0}': '页面 {0} 的屏幕名称',
  'Other screens': '其他屏幕',
  'These screens are not linked to a page right now. Naming them here keeps the stage labels correct.':
    '这些屏幕暂时没有关联的页面；在这里改名可以保持主画面标签正确。',
  'Screen {0}': '屏幕 {0}',
  'Screen {0} name': '屏幕 {0} 名称',
  'A screen name cannot be empty.': '屏幕名称不能为空。',
  'Screen names must be unique.': '屏幕名称不能重复。',
  'Renamed the screens.': '已更新屏幕名称。',
  'Perspective Correction · {0} · {1}': '透视校正 · {0} · {1}',
  'Show markers': '显示标记',
  'Detect markers': '检测标记',
  'Review result': '检查结果',
  'Open this address in full screen on the target screen, then keep the screen still while the camera detects the calibration markers.':
    '请在目标屏幕上全屏打开此地址，并在相机检测标定标记时保持屏幕静止。',
  'Calibration display address': '标定显示地址',
  'Creating calibration session...': '正在创建标定会话…',
  'Copy calibration address': '复制标定地址',
  'Address copied': '地址已复制',
  'Unable to copy the address': '无法复制地址',
  'Open calibration display here': '在此打开标定显示页面',
  'Waiting for the target screen': '正在等待目标屏幕',
  'The calibration display has not reported its full-screen dimensions yet.':
    '标定显示页面尚未上报全屏尺寸。',
  'Markers are ready': '标记已就绪',
  'Detecting markers': '正在检测标记',
  'Keep the camera and screen stationary.': '请保持相机和屏幕静止。',
  'Calibration session': '标定会话',
  'Marker detection failed': '标记检测失败',
  'Run marker calibration to create a perspective preset for this screen.':
    '请运行标记标定为该屏幕创建透视预设。',
  'Marker match': '标记匹配误差',
  'Calibration Match': '标定匹配误差',
  Markers: '标记',
  'Calibration Positions': '标定位置',
  'Corner Validation Error': '角点验证误差',
  'Valid Frames': '有效帧',
  'Reprojection Error': '重投影误差',
  'Corner Jitter': '角点抖动',
  'Marker calibration completed without a result.':
    '标记标定已完成，但没有结果。',
  'Return to Safe Position': '复位到安全位置',
  'Return to Safe Position?': '复位到安全位置？',
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
  'Connect Ethernet → Detect → Connect': '连接网线 → 自动探测 → 自动连接',
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

  'Workstation Settings': '工作台设置',
  'Change Robot': '更换机械臂',
  'Change Robot Connection?': '更改机械臂连接？',
  'Update the current connection settings. Saved measurements are retained. Connecting does not enable or move the robot.':
    '更新当前连接设置并保留已保存的测量数据。连接不会使能或移动机械臂。',
  'Connect a different robot and set up its tool and calibration again. Previous settings and logs remain on disk. Connecting does not enable or move the robot.':
    '连接另一台机械臂后，需要重新设置工具并完成标定。之前的设置和日志保留在磁盘中。连接不会使能或移动机械臂。',
  'No current {0} settings are selected. Enter the current measurements; previous records will be kept.':
    '尚未选定当前{0}设置。请填写当前实测值，历史记录会保留。',
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
  'Automatic Screen Exploration': '自动探索屏幕',
  'Automatic Exploration': '自动探索',
  'Restart Automatic Exploration': '重新自动探索',
  'Reconnect the saved main camera screen before starting automatic workflow.':
    '请先恢复已保存主相机的屏幕配置，再启动自动流程。',
  'Stop automatic workflow': '停止自动流程',
  'Waiting for page mapping': '正在等待页面映射',
  'Agent is checking the mapping': 'Agent 正在检查映射',
  'Automatic approach and calibration': '正在自动接近并标定',
  'Agent is checking the saved result': 'Agent 正在检查已保存结果',
  'Running the standard task automatically': '正在自动运行标准任务',
  'Check the mapping, approach, calibrate, save and run the standard task automatically. Keep the page open and the workspace clear.':
    '自动检查映射、接近、标定、保存并运行标准任务。请保持页面打开、工作区无遮挡。',
  'Review Automatic Calibration': '确认自动标定',
  'Accept Automatic Calibration': '接受自动标定',
  'Discard this automatic calibration?': '放弃这次自动标定？',
  Discard: '放弃',
  'Start automatic screen exploration?': '开始自动探索屏幕？',
  'Place the stylus about 2–5 cm above the centre of the display, keep the device page in the foreground, and clear the workspace. The robot will find the screen, sample it and run boundary verification. This placement is only the starting pose; you will record the safe position separately before accepting.':
    '把触控笔尖移到屏幕显示区中心上方约 2–5 厘米，保持设备页面在前台，并清空工作区。机器人会自动寻找屏幕、采样并执行边界验证。这个位置只是起始位姿；接受前还需要单独记录安全位置。',
  'Find the screen': '寻找屏幕',
  'Sample and fit': '采样并拟合',
  'Verify boundary': '验证边界',
  Accept: '接受',
  'Checking the page and controller': '检查页面与控制器',
  'Finding the screen': '正在寻找屏幕',
  'Measuring the touch direction': '正在测量触摸方向',
  'Measuring the screen plane': '正在测量屏幕平面',
  'Building the screen frame': '正在建立屏幕坐标系',
  'Sampling the screen': '正在采样屏幕',
  'Fitting the calibration': '正在拟合标定',
  'Verifying the physical boundary': '正在验证物理边界',
  'Automatic exploration complete': '自动探索完成',
  'Preparing automatic exploration': '正在准备自动探索',
  'Review the residuals below, then accept once to save and use this calibration.':
    '请检查下方残差，然后点击一次“接受”保存并使用该标定。',
  'The robot is moving. Keep the workspace clear; Stop and Emergency Stop remain available.':
    '机器人正在运动，请保持工作区清空；停止和急停始终可用。',
  'The robot is exploring the screen. Stop and Emergency Stop remain available.':
    '机器人正在自动探索屏幕；停止和急停始终可用。',
  'Plane RMSE': '平面 RMSE',
  'Grid RMS': '网格 RMS',
  'Validation max': '验证最大残差',
  'Surface compensation': '表面补偿',
  'Height range': '高度差',
  'Plane hold-out': '平面留出残差',
  'Move the stylus clear of the screen, then record the safe position.':
    '把笔尖移离屏幕后记录安全位置。',
  'Review the residuals, then accept once.': '检查残差后接受一次。',
  'Keep the workspace clear; Stop stays available.':
    '保持工作区清空；停止始终可用。',
  'Place the stylus 2–5 cm above the screen centre; keep the device page visible.':
    '把笔尖放到屏幕中心上方约 2–5 厘米，并保持设备页面在前台。',
  'Manual five-point sampling remains available as a fallback.':
    '手动 5 点采样仍可作为备用。',
  'Build the page mapping first, then start automatic exploration.':
    '请先建立页面映射，再开始自动探索。',
  'Horizontal screen confirmed; later contacts reuse the first height.':
    '已确认屏幕水平固定；后续触点复用首次高度。',
  'Place the stylus 2–5 cm above the screen centre; keep the page visible.':
    '把笔尖放到屏幕中心上方约 2–5 厘米，并保持页面可见。',
  Coverage: '覆盖率',
  'Automatic boundary verification': '自动边界验证',
  '{0} · {1} / {2}': '{0} · {1} / {2}',
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
  'Run a closed hover circuit over the four corners, then return to observation?':
    '沿包含四个角点的闭合边界悬浮一圈，然后返回观察位？',
  'Run the four hover corners and a closed boundary circuit, then return to observation?':
    '执行四角悬停及一圈闭合沿边悬停，然后返回观察位？',
  'Run Hover Boundary Verification': '运行悬停边界验证',
  'Confirm Hover Corners and Boundary': '确认悬停四角与沿边轨迹',
  'Lightly touch the inset corners, then demonstrate each inner edge with a lift between strokes?':
    '轻触内缩四角，再分段示意四边，每段结束后抬笔？',
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
  'Hover around the closed boundary; the four corners are included. Observe position, direction and coverage.':
    '沿闭合边界悬浮一周，四个角点包含在内；观察位置、方向和覆盖。',
  'Hover at the four exact corners, then trace all four edges. Observe position, direction and coverage.':
    '悬停于四个精确角点，然后沿四边移动；请观察位置、方向和覆盖范围。',
  'Lightly touch the inset corners, then demonstrate each inner edge separately, lifting between strokes.':
    '在内缩四角分别轻触并抬起，再分段示意内部四边，每段之间抬笔。',
  'Light contact · depth capped at 0.1 mm · inset taps and separate strokes · lift between edges':
    '轻触示意 · 下压上限 0.1 mm · 内缩点按和分段滑动 · 每段结束后抬笔',
  'Exact physical boundary · 0 mm inset · verification speed and acceleration: 0.15 × base settings':
    '物理精确边界 · 内缩 0 mm · 验证速度与加速度为基础值的 0.15 倍',
  'Running: {0} · {1} / {2}': '正在执行：{0} · {1} / {2}',
  'Four Corners': '四角',
  'Four Edges': '四边',
  'Hover Boundary': '悬浮边界',
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
  'Try automatic detection first. Enter the controller address only if prompted.':
    '先自动探测，仅在提示时填写控制器地址。',
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
  'Both physical dimensions may stay blank: Automatic Exploration measures them from touch samples. Manual calibration requires both.':
    '物理宽高可以同时留空，自动探索会根据触点采样测量；手动标定则必须填写两项。',
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
  'Change Connection': '更换连接',
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
  'Record the safe position': '记录安全位置',
  'The pose where you placed the stylus was only the starting point and is not saved as the safe position. Use Drag Mode or the teach pendant to move the stylus clear of the screen, then record the position the robot should return to after actions.':
    '你放置笔尖的位置只是自动探索的起点，不会作为安全位置保存。请用拖动模式或示教器把笔尖移到屏幕外，再记录动作结束后机器人应返回的安全位置。',
  'Record the safe position before accepting the automatic calibration':
    '请先记录安全位置，再接受自动标定。',
  'Record the safe position before verification':
    '请先记录安全位置，再执行验证。',
  'Record the safe position during the observation stage':
    '请在观察位阶段记录安全位置。',
  'Record the safe position before running boundary verification':
    '请先记录安全位置，再执行边界验证。',
  'Record the safe position before saving the calibration':
    '请先记录安全位置，再保存标定。',
  'This calibration has no recorded safe position; record one before returning to it':
    '此标定还没有记录安全位置；请先记录后再复位。',
  'This calibration has no recorded safe position; screen actions require one':
    '此标定还没有记录安全位置；执行屏幕操作前需要先记录。',
  'Saved calibration has no recorded safe position':
    '已保存的标定缺少安全位置记录',
  'Hover verification': '悬停验证',
  'Contact verification': '接触验证',
  'Save this contact point': '保存此接触点',
  'Run hover verification': '运行悬停验证',
  'Run contact verification': '运行接触验证',
  'Looks right, continue': '正确，继续',
  'Try again': '重试',
  'Save calibration and finish': '保存标定并完成',
  'Run Standard Task Trial': '运行标准任务试运行',
  'Running standard task...': '正在运行标准任务…',
  'Standard task trial passed': '标准任务试运行通过',
  'Standard task trial failed': '标准任务试运行失败',
  'All recorded actions passed the server checks. The candidate is still unaccepted.':
    '所有记录动作已通过服务端检查。候选标定仍未接受。',
  'The standard task did not pass.': '标准任务未通过。',
  'The candidate is still unaccepted.': '候选标定仍未接受。',
  'Download trial report': '下载试运行报告',
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
  'Setup illustration': '配置示意图',
  'Discard this draft and restore the saved configuration?':
    '放弃此草稿并恢复已保存的配置？',
  'The controller may be in teach-pendant mode. Switch it to TCP mode before reconnecting.':
    '控制器可能处于示教器模式，请先切换到 TCP 模式再重新连接。',
};

export const migratedZh: Record<string, string> = {
  'Pair Phone and Recalibrate': '配对手机并重新校正',
  'Recalibrate All Screens': '重新标定全部屏幕',
  'Showing existing perspective parameters': '当前显示已有透视参数',
  'These are saved corners, not a fresh check. If the phone or camera moved, pair the phone and recalibrate.':
    '这些是已保存的角点，不是本次校验的结果。若手机或相机移动过，请重新配对手机并校正。',
  'Perspective verified': '透视已校验',
  'Perspective stale': '透视已失效',
  'Perspective needs review': '透视待确认',
  'Perspective unverified': '透视未校验',
  'Perspective correction no longer matches this camera view': '透视校正已失效',
  'Perspective correction may no longer match this camera view':
    '透视校正待确认',
  Recalibrate: '重新校正',
  'Drift {0}% of screen width': '偏移 {0}% 屏宽',
  'View detection frame': '查看检测画面',
  'Detection frame': '检测画面',
  'This preview uses existing parameters. It does not confirm that the phone page is connected or that the current screen position matches. If the phone or camera moved, pair the phone and recalibrate.':
    '此预览使用已有参数，不代表手机页面已连接，也不代表参数与当前屏幕位置匹配。手机或相机移动后，请配对手机并重新校正。',
  'Pair Phone': '配对手机',
  'Review and Apply': '检查并应用',
  'Next: pair the phone, keep its page visible and in fullscreen, then detect markers and review the corrected image. Robot coordinate calibration follows after page mapping is ready.':
    '下一步：配对手机并保持页面前台全屏，随后检测标记、检查校正画面。页面映射就绪后，再进行机械臂坐标标定。',
  'Existing parameters are used for this preview. Recalibrate to match a new screen position.':
    '预览正在使用已有参数。屏幕位置改变后，需要重新校正。',
  'Open the screen page on the phone and keep it visible in fullscreen.':
    '手机打开屏幕页面，保持前台全屏。',
  'Detection starts automatically after the paired page is ready.':
    '配对页面就绪后，自动开始检测。',
  'Check the screen outline and corrected image before using the result.':
    '确认屏幕轮廓与校正画面正确后，再使用结果。',
  'Wait for the current Drag Mode transition': '请等待当前拖动模式切换完成',
  'Find and Connect': '自动探测并连接',
  'Screen name (optional)': '屏幕名称（选填）',
  'Detecting and connecting to the controller…': '正在探测并连接控制器…',
  'Detect Again': '重新探测',
  'The controller is detected and connected automatically. Connection settings appear only when needed.':
    '自动探测并连接控制器，仅在需要时提示配置。',
  'No usable controller found. Check the Ethernet connection, computer network and TCP/IP development mode, or enter a controller address.':
    '未找到可用控制器。请检查网线、电脑网络及 TCP/IP 开发模式，或手动填写控制器地址。',
  'MG400 is reachable but is not serving TCP clients (vendor code -1). Switch to TCP/IP development mode, then reconnect.':
    '已找到 MG400，但控制器拒绝 TCP 控制请求（错误码 -1）。请切换到 TCP/IP 二次开发模式后重新连接。',
  'Multiple controllers are reachable. Specify the controller address to use.':
    '发现多个可用控制器，请填写需要连接的控制器地址。',
  'A different controller address was found. Review the connection before replacing the current installation.':
    '发现不同地址的控制器，请确认连接设置后再更换当前机械臂。',
  'This robot requires connection settings.': '此机械臂需要填写连接设置。',

  ...teachingBoundaryZh,
  'Leave both dimensions blank to measure the screen during automatic exploration. Manual calibration requires both dimensions.':
    '宽高均可留空，自动探索时将测量屏幕尺寸。手动标定需要填写宽高。',
  'Enter both physical dimensions, or leave both blank for automatic exploration.':
    '请填写完整宽高，或将两项均留空以使用自动探索。',
  'Measure the screen with automatic exploration, or enter both physical dimensions before manual calibration':
    '请通过自动探索测量屏幕，或在手动标定前填写完整的物理宽高',
  'Measured Screen Size': '实测屏幕尺寸',
  'Measured During Automatic Exploration': '自动探索时测量',

  'Delete Screen': '删除屏幕',
  'Delete Screen?': '删除屏幕？',
  'Remove this screen binding and its perspective correction. You can create and bind a screen again.':
    '移除此屏幕的绑定和透视校正，之后可重新新建并绑定屏幕。',
  'Screen deleted. Create and bind a screen to start again.':
    '屏幕已删除，可重新新建并绑定屏幕。',
  'Page Mapping': '页面映射',
  'Open Page Mapping': '打开页面映射',
  'Automatic Exploration Interrupted': '自动探索已中断',
  'Automatic Exploration Details': '自动探索详情',
  Phase: '阶段',
  'Not started': '尚未开始',
  Page: '页面',
  'Start pose': '起始位姿',
  'Automatic exploration interrupted': '自动探索已中断',
  'The previous automatic run ended before acceptance, so no new calibration was saved. Start Automatic Exploration again below; the interrupted draft will be replaced.':
    '上一次自动探索在完成接受前中断，没有保存新的标定。请在下方重新开始自动探索；这次中断的草稿会被替换。',
  'Motion did not complete': '运动未完成',
  'Automatic exploration stopped': '自动探索已停止',
  'The automatic step did not complete in time; check the controller and try again.':
    '自动探索的这一步未在超时内完成；请检查控制器连接和状态后重试。',
  'The touch point reached the first-contact safety floor without page feedback; the arm lifted and retried, then stopped.':
    '触点在到达安全下限前没有页面反馈；机械臂已在该点抬起并重试一次，仍未触发，已停止。',
  'MG400 is not enabled after Sync': 'MG400 在 Sync 后未使能',
  'MG400 is still moving after Sync': 'MG400 在 Sync 后仍在运动',
  'MG400 command completion is unknown':
    'MG400 未在超时内确认命令，控制器连接可能已中断；请检查连接、DobotStudio 是否占用，并重新连接后再试',
  'Automatic Calibration': '自动标定',
  'Place the stylus about 2–5 cm above the centre of the display, keep the device page in the foreground, and clear the workspace.':
    '把笔尖放到屏幕显示区中心上方约 2–5 厘米，保持设备页面在前台，并清空工作区。',
  'Manual Calibration (Fallback)': '手动标定（备用）',
  'Manual five-point sampling and two boundary confirmations remain available. Use this if automatic exploration is unavailable or you need to re-verify existing geometry.':
    '手动 5 点采样和两组边界确认仍可使用。自动探索不可用，或需要重新验证已有几何时使用。',
  'Start Manual Calibration': '开始手动标定',
  'One start pose; record the safe position before accepting.':
    '一次人工起点；接受前记录安全位置。',
  '1. Place the Stylus': '① 放好笔尖',
  '2–5 cm above the centre': '显示区中心上方 2–5 厘米',
  '2. Robot Samples and Fits': '② 机器人采样并拟合',
  '3×3 touch grid · plane + mapping': '3×3 触点网格 · 平面 + 映射',
  '3. Record and Accept': '③ 记录并接受',
  'Accept once': '只接受一次',
  'Safe position + residuals': '安全位置 + 残差',
  'Manual five-point calibration remains available': '仍可使用手动 5 点标定',
  'Screen size': '屏幕尺寸',
  Missing: '缺失',
  'Another installation owns the automatic workflow':
    '另一套安装正在执行自动流程，请等待完成或先停止该流程',
  'Start the selected main camera and wait for a fresh frame before building page mapping.':
    '请先启动所选主相机，待画面正常后再建立页面映射。',
  'Select the main camera screen before building page mapping.':
    '请先选择主相机对应的屏幕，再建立页面映射。',
  'Page mapping does not match the selected main camera':
    '页面映射与所选主相机不一致，请重新准备',
  'Retry page mapping': '重试页面映射',
  'Page mapping is being prepared; wait for it to finish':
    '页面映射正在准备，请等待完成',
  'Page mapping installation does not match the active workstation':
    '页面映射对应的安装与当前工作台不一致，请刷新页面',
  'Stop robot motion and exit Drag Mode before preparing page mapping':
    '请先停止机械臂运动并退出拖动模式，再准备页面映射',
  'Page mapping request failed. Check the screen service and retry.':
    '页面映射请求失败，请检查屏幕服务后重试。',
  'The task is no longer accepting actions':
    '本次任务已结束或停止，无法继续执行动作',
  'Preparing page mapping': '正在准备页面映射',
  'Keep the phone page visible and fullscreen. Calibration and task controls become available when page mapping is ready.':
    '请保持手机页面在前台并全屏显示。页面映射就绪后，才能启动标定和标准任务。',
  'Build Page Mapping First': '先建立页面映射',
  'Build the page mapping first': '先建立页面映射',
  'Build the page mapping first.': '请先建立页面映射。',
  'Automatic exploration uses the page-to-screen mapping. Open the mapping tool, build it, then return here.':
    '自动探索依赖页面到整屏的映射。请先打开映射工具完成建立，再回到这里。',
  'Build the page mapping first. Automatic exploration stays disabled until the mapping and page session are ready.':
    '请先建立页面映射。映射和页面会话就绪前，自动探索保持不可用。',
  'Screen pixel size is not configured': '屏幕像素尺寸未配置',
  'Page mapping pixel size does not match the selected Screen Profile':
    '页面映射像素尺寸与当前 Screen Profile 不一致',
  'Page mapping is not ready': '页面映射尚未建立',
  'Open one page and build its page mapping first':
    '请先打开一个页面并建立页面映射',
  'Close extra page sessions; automatic exploration needs exactly one':
    '请关闭多余的页面会话；自动探索只支持一个',
  'Page mapping service is not configured': '页面映射服务未配置',
  'Place the stylus 2–5 cm above the screen centre, keep the page visible, then start. One run checks the camera mapping, approaches when a saved calibration exists, calibrates and saves. The standard task is a separate, on-demand run. Stop remains available.':
    '将笔尖放在屏幕中心上方 2–5 cm，保持页面在前台后开始。一次运行会检查相机映射；已有标定时自动接近，然后完成标定并保存。标准任务稍后按需单独运行。停止始终可用。',
  'Start Automatic Calibration': '开始自动标定',
  'Show QR Code': '显示二维码',
  'Waiting for the screen page address…': '正在获取屏幕页面地址…',
  'Waiting for the pairing code…': '正在获取配对码…',
  'Open this address on the phone, then enter the pairing code. The QR code still binds automatically.':
    '在手机上打开这个地址，然后输入配对码。二维码仍可自动绑定。',
  'Scan the QR code with the phone. Keep the page in the foreground; detection starts automatically.':
    '用手机扫描二维码。保持页面在前台，检测会自动开始。',
  'The camera stays fixed. No corner editing or manual confirmation is needed.':
    '相机保持不动，无需编辑角点或手动确认。',
  'Scan to connect the phone': '扫码连接手机',
  'Scan the QR code with the phone': '用手机扫描二维码',
  'Scan with the phone. Keep the page visible and in fullscreen; detection starts by itself.':
    '用手机扫码，并保持页面可见、全屏；检测会自动开始。',
  'Camera mapping applied automatically': '相机映射已自动应用',
  'Automatic camera mapping needs review: {0}': '相机映射需要复核：{0}',
  'Unable to apply camera mapping.': '无法应用相机映射。',
  'Keep the area clear and the device page foregrounded.':
    '保持工作区无遮挡，并让设备页面在前台。',
  'The first run uses the taught position; later runs use the saved geometry.':
    '首次运行使用示教位置，后续运行使用已保存几何。',
  'The workflow opens the page mapping if it is missing, uses the fixed horizontal slide settings, and accepts the result automatically only when the deterministic geometry, boundary and camera-avoidance gates pass. A withheld result stays pending for manual review.':
    '缺少页面映射时流程会自动打开；使用固定水平滑动设置；只有确定性几何、边界和相机避让门槛全部通过时才自动接受。未通过时保留为待人工复核。',
  'Place the stylus 2–5 cm above the centre of the screen and start automatic exploration. The robot finds the screen, samples a 3×3 grid, fits the plane and page mapping and verifies the boundary. It then stops so you can record the safe position and accept once.':
    '把笔尖放到屏幕中心上方约 2–5 厘米，点击开始自动探索。机器人会自动寻找屏幕、采样 3×3 网格、拟合平面与页面映射并验证边界，然后暂停，让你记录安全位置并接受一次。',
  'Keep the area clear, the emergency stop within reach, and the device page foregrounded.':
    '保持工作区清空、急停按钮触手可及，并让设备页面保持前台。',
  'Automatic exploration needs a valid page mapping. It measures the screen size when the Screen Profile leaves it blank; manual five-point calibration stays available as a fallback.':
    '自动探索需要有效的页面映射。Screen Profile 未填写物理宽高时，自动探索会测量屏幕尺寸；手动 5 点标定仍可作为备用。',
  'Automatic exploration uses the current page mapping and the configured or measured physical screen size. The starting pose is not the safe position; you record that separately after verification, and it never saves without your single acceptance. Boundary verification still uses the full rectangular touch area; rounded screen corners are not masked.':
    '自动探索使用当前页面映射，以及已配置或实测的屏幕物理尺寸；起始位姿不是安全位置，需要在验证后单独记录，没有你的一次接受不会保存。边界验证仍按整块矩形触控区执行，不对圆角做掩膜。',
  'The manual fallback records at least five distributed contact points, P1/P2 and an observation pose. Hover verification checks the border; contact verification checks press depth and the closed edge path.':
    '手动备用流程记录至少 5 个分散触点、P1/P2 和观察位；悬停验证检查边界，接触验证检查压入深度和闭合路径。',
  'Opens the automatic tool. It maps webpage coordinates to the screen; it does not move the robot or replace this screen calibration.':
    '打开自动工具。它只建立网页到整屏的坐标映射，不移动机械臂，也不替代本次屏幕标定。',
  'Scan this code with the phone camera, or open the device address once. Then keep the page in the foreground; all remaining connection steps happen on this computer.':
    '用手机相机扫描二维码，或在设备上打开一次设备地址；之后保持页面在前台，其余连接操作都在电脑完成。',
  'Device Address QR Code': '设备地址二维码',
  'Device Address': '设备地址',
  'Choose the network the device joined. The address must be reachable from that device.':
    '请选择设备接入的网络。该地址必须能从此设备访问。',
  'No LAN address was detected. Set ROBOT_SCREEN_CALIB_PUBLIC_URL to an address the device can reach.':
    '未检测到局域网地址。请将 ROBOT_SCREEN_CALIB_PUBLIC_URL 设置为设备可访问的地址。',
  'Waiting Devices': '待连接设备',
  'Waiting for the device page to open': '等待设备打开连接页面',
  'Connect This Device': '连接此设备',
  'Select a waiting device.': '请选择待连接设备。',
  'Match the short device identifier using the camera preview. No code entry or device movement is needed. If the service restarts, the device page automatically returns to this waiting list.':
    '通过相机预览核对设备页面上的简短标识，无需输入配对码或移动设备。服务重启后，设备页面会自动返回待连接列表。',

  'This panel builds the page-to-screen mapping. It does not move the robot. Robot sampling, boundary verification and acceptance happen in Screen Calibration under Automatic Exploration.':
    '此处只建立页面到整屏的映射，不移动机械臂；机械臂采样、边界验证和接受在屏幕标定的“自动探索”中完成。',
  'A robot operation is active. Stop it before capturing calibration markers.':
    '机械臂任务正在运行，请先停止任务再采集标定定位点。',
  'Page mapping service unavailable': '页面映射服务不可用',
  'Start Robot: services + console to connect this Playground to the page mapping service.':
    '请通过 Robot: services + console 联合启动，以连接 Playground 与页面映射服务。',

  'Feedback Device Session': '反馈设备会话',
  'Select a device session': '选择设备会话',

  "The selected camera's perspective preset supplies the screen size and corners. Start the camera and apply Perspective Correction in Cameras first; edit the values only if the device orientation differs.":
    '屏幕尺寸和四角自动取自所选相机的透视预设。请先在相机视图启动相机并应用透视校正；仅在设备方向不同时修改这些值。',
  'Full-Screen Pixel Width': '整屏像素宽度',
  'Full-Screen Pixel Height': '整屏像素高度',
  'Confirm screen corners in device order: TL, TR, BR, BL. Select the full display rectangle, not the webpage boundary. When the device lies sideways, the labels follow the device orientation and may not match the image corners.':
    '按设备方向依次确认左上、右上、右下、左下四角，选择整屏显示矩形，而非网页边界。设备横放时，四角标签跟随设备方向，可能与画面上的角不一致。',
  'Screen Corner Preview': '屏幕四角预览',
  'Original frame: {0} × {1}': '原始图像：{0} × {1}',
  'Confirm Screen Feedback Configuration': '确认并保存屏幕反馈配置',
  'Build Page Mapping': '建立页面映射',
  'Enter fullscreen on the device page before building the page mapping.':
    '请先在设备页面进入全屏，再建立页面映射。',
  'The device page shows a fullscreen prompt. Enter fullscreen there, then return here. The mapping is built for the fullscreen viewport.':
    '设备页面会显示全屏提示；在设备上进入全屏后回到这里。页面映射会按全屏视口建立。',
  'Invalidate After Device Movement': '设备移动后使映射失效',
  'Close this device session and discard its in-memory feedback?':
    '关闭此设备会话并丢弃内存中的触点记录？',
  'Close Device Session': '关闭设备会话',
  'Building the mapping saves the current screen configuration automatically.':
    '建立映射时会自动保存当前屏幕配置。',
  'Mapping in progress': '正在建立映射',
  'Page mapping ready': '页面映射已就绪',
  'Page mapping required': '尚未建立页面映射',
  'Mapping Version': '映射版本',
  'Fit / Validation RMS / Maximum': '拟合均方根 / 验证均方根 / 最大残差',
  'Latest Touch': '最近触点',
  'Full-screen coordinates unavailable': '整屏坐标不可用',
  'No touch feedback yet': '尚无触点反馈',
  'Keep the device, camera and lighting stable during mapping. Residuals measure consistency, not physical pixel accuracy. Moving the device or camera requires reconfirming the screen corners and rebuilding the mapping.':
    '映射时请保持设备、相机和光照稳定。残差只反映一致性，不代表真实像素精度。移动设备或相机后，需要重新确认四角并建立映射。',
  'Select a running camera first.': '请先选择运行中的相机。',
  'Confirm four screen corners on a fresh camera frame.':
    '请在最新相机图像上确认四个屏幕角点。',
  'Screen feedback configuration saved.': '屏幕反馈配置已保存。',
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
  'top edge': '上边缘',
  'bottom edge': '下边缘',
  'left edge': '左边缘',
  'right edge': '右边缘',
  'The outline matches the phone screen': '轮廓与手机屏幕吻合',
  'The outline does not match the phone screen': '轮廓与手机屏幕不吻合',
  'Ignore this mismatch and continue': '忽略本次偏差，继续使用',
  'Outline mismatch ignored': '已忽略轮廓偏差',
  'Using the current correction. Recalibrating restores the outline check.':
    '继续使用当前校正，重新校正后将恢复轮廓检查。',
  'The outline may not match the phone screen': '轮廓可能不与手机屏幕吻合',
  'The image is too unclear for a geometric measurement. The model reports the {0} off the phone screen; treat that as a prompt to check, not as a measurement.':
    '画面太模糊，无法做几何测量。模型认为{0}离开了手机屏幕；这只能作为复查提示，不是测量结果。',
  'The image is too unclear for a geometric measurement. The model reports a mismatch; treat that as a prompt to check, not as a measurement.':
    '画面太模糊，无法做几何测量。模型认为轮廓与屏幕不符；这只能作为复查提示，不是测量结果。',
  'The image is too unclear for a geometric measurement. The model thinks the outline looks aligned; that opinion is advisory only.':
    '画面太模糊，无法做几何测量。模型认为轮廓看起来吻合，该意见仅供参考。',
  'The image is too unclear for a geometric measurement, and the model check failed too. Pair the phone and calibrate again if it may have moved.':
    '画面太模糊，无法做几何测量，模型检查也失败了。如果手机可能移动过，请重新配对并校正。',
  'The outline does not match the phone screen.': '轮廓与手机屏幕不吻合。',
  'The outline could not be verified from this frame':
    '无法根据当前画面判定轮廓是否有效',
  'The outline extends about {0}% of the screen width past the phone screen.':
    '轮廓超出手机屏幕约 {0}% 屏宽。',
  'The phone screen edge is about {0}% of the screen width outside the {1}.':
    '手机屏幕边缘位于{1}外侧约 {0}% 屏宽处。',
  'The outline is about {0}% of the screen width away from the phone screen.':
    '轮廓与手机屏幕相差约 {0}% 屏宽。',
  'Measured drift is {0}% of the screen width. The corrected image is safe to reuse.':
    '实测偏移为 {0}% 屏宽，可继续使用当前校正画面。',
  'The screen boundary was not clear enough to measure. If the phone or camera moved, pair the phone and calibrate again.':
    '画面中屏幕边界不够清晰，无法测量。若手机或相机移动过，请重新配对手机并校正。',
  'Save it anyway? Corrected screenshots and AI taps stay wrong until the outline is fixed.':
    '仍要保存吗？在修正轮廓之前，校正截图和 AI 点击都会是错的。',
  'Some outlines do not match their phone screens.':
    '部分轮廓与手机屏幕不吻合。',
  'Apply them anyway?': '仍要应用吗？',
  'Annotated camera frame': '带标注的相机画面',
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
  'Detected Result': '检测结果',
  'Check this result before applying': '应用前请检查此结果',
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
  'Corrected View': '校正画面',
  'Camera Profile': '相机配置',
  'Starting camera…': '正在启动相机…',
  'Camera is not connected': '相机未连接',
  'Camera could not be started': '相机启动失败',
  'Camera stopped': '相机已停止',
  'Waiting for the service': '正在等待服务',
  Capture: '拍照',
  'Perspective Correction': '透视校正',
  'Place the corners manually': '手动调整四角',
  'The camera frame could not be loaded': '无法加载相机画面',
  'Check that the camera is streaming, then retry.':
    '请确认相机正在出图，然后重试。',
  'Open Last Photo': '打开最近一张照片',
  'Stop Camera': '停止相机',
  'Retry this camera': '重试此相机',
  'Start this camera': '启动此相机',
  'The camera is not connected': '相机未连接',
  Retry: '重试',
  Start: '启动',
  '% · confirm before use': '% · 使用前请确认',
  'Perspective Correction Details': '透视校正详情',
  'Corrected preview available. Open Perspective Correction to review the result.':
    '校正预览已就绪，请打开透视校正检查结果。',
  'Clear perspective correction, output size, and detected corners for this camera. Saved screens and presets are kept.':
    '清除此相机的透视校正、输出尺寸及检测角点，保留已保存的屏幕和预设。',
  'Clear Perspective Correction': '清除透视校正',
  'Clear Calibration Data': '清除标定数据',
  'Replace screens': '更换屏幕',
  'Clear every applied perspective correction for this camera?':
    '清除该相机下所有屏幕已应用的透视校正吗？',
  'Clear the applied perspective correction for {0}?':
    '清除 {0} 已应用的透视校正？',
  'Saved screens are kept for recalibration.':
    '已保存的屏幕会保留，下次透视校正可重新标定。',
  'Screen bindings and page links are deleted; pair the pages and select the screen again.':
    '将删除屏幕绑定和页面关联，需重新配对页面并重新选屏。',
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
  'Mirrors the picture in the capture itself, so marker calibration and perspective correction see the same orientation the operator does. A running stream is updated immediately.':
    '直接镜像采集画面，使标记标定和透视校正与操作人员看到的方向一致。正在运行的流会立即更新。',
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
  'Show Connected iPhone Cameras': '显示已连接的 iPhone 相机',
  'Off by default. Turn this on to add an iPhone Continuity Camera.':
    '默认关闭，开启后可添加 iPhone 连续互通相机。',
  'Default Capture Settings': '默认采集设置',
  'Default Width': '默认宽度',
  'Default Height': '默认高度',
  'Default Frame Rate': '默认帧率',
  'A camera profile overrides these defaults. Both apply the next time a camera starts.':
    '相机配置会覆盖这些默认值，均在下次启动相机时生效。',
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
  'Measure from the marked origin to the tip, including the adapter and holder.':
    '从标记的原点测量至尖端，包括转接件与支架。',
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
  'not enough edge points, kept the mask outline': '边缘点不足，已保留掩膜轮廓',
  'two edges came out parallel, kept the mask outline':
    '两条边平行，已保留掩膜轮廓',
  'the fitted lines moved too far, kept the outline':
    '拟合直线偏移过大，已保留轮廓',
  'the fitted lines left the area window': '拟合直线超出区域窗口',
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
  'Corner jitter {0} px over {1} frames': '{1} 帧内角点抖动 {0} px',
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
  '{0} frames': '{0} 帧',
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
  'Measure from flange origin to tip{0}': '测量法兰坐标系原点至尖端的距离{0}',
  ' along {0}': ' 沿 {0}',
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
  '{0}/{1} · jitter {2} px': '{0}/{1} · 抖动 {2} px',
  'moved {0} px': '偏移 {0} px',
  '{0} (turned)': '{0}（旋转）',
  Language: '语言',
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
  'Wait until the robot is stationary and fault-free before saving.':
    '请等待机械臂静止且无故障后再保存。',
  'Controller parameter application is unconfirmed. Reload and check the saved values.':
    '控制器参数应用尚未确认，请重新加载并核对保存值。',
  'Controller motion settings failed: {0}': '控制器运动参数操作失败：{0}',
  'Controller Motion Parameters': '控制器运动参数',
  'Jog Settings': '点动设置',
  'Playback Settings': '再现设置',
  'Joint Speed': '关节速度',
  'Joint Acceleration': '关节加速度',
  'Joint Jerk': '关节加加速度',
  'Coordinate Speed': '坐标系速度',
  'Coordinate Acceleration': '坐标系加速度',
  'Coordinate Jerk': '坐标系加加速度',
  'Applies to manual jogging.': '作用于手动点动。',
  'Base motion profile for program and screen motions; screen action ratios still apply.':
    '程序与屏幕动作的基础参数；屏幕动作比例仍会叠加。',
  'Affects program and script motion; applies automatically and does not change Jog Settings.':
    '作用于程序/脚本运动，拖动后自动应用，不改变点动设置。',
  'Global Speed (%)': '全局速度倍率 (%)',
  'Global Speed': '全局速度',
  'Applying…': '应用中…',
  'Set all': '批量设置',
  'Fill with maximum values': '填入最大值',
  'Restore default values': '恢复默认值',
  'Fills both tabs; Save and Apply to write.':
    '填入两个 tab；点击“保存并应用”后生效。',
  'About global speed': '全局速度说明',
  'About jog settings': '点动设置说明',
  'About playback settings': '再现设置说明',
  'Disable the robot before editing or saving Jog Settings and Playback Settings. Global Speed can still be adjusted.':
    '下使能后才能修改和保存点动/再现参数；全局速度仍可实时调整。',
  'Disable the robot before editing or saving controller motion parameters.':
    '请先下使能机械臂，再修改或保存控制器运动参数。',
  'Controller-wide program/script speed. It applies immediately when the slider settles; no Save needed.':
    '控制器级的程序/脚本运行速度，滑块停稳后立即生效，无需保存。',
  'It scales program/script motion only. Jog Settings absolute speeds are unchanged.':
    '只缩放程序/脚本运动，不改变点动设置中的绝对速度。',
  'Applies to manual jogging (MoveJog); it is not scaled by the global speed.':
    '作用于手动点动（MoveJog），不参与全局速度缩放。',
  'J1–J4 use °/s and °/s². X/Y/Z use mm/s and mm/s²; R uses °/s and °/s².':
    'J1–J4 使用 °/s、°/s²；X/Y/Z 使用 mm/s、mm/s²；R 使用 °/s、°/s²。',
  'Ranges come from the controller. Jog Settings and Playback Settings can be edited and applied only while the robot is disabled.':
    '范围来自控制器。点动/再现参数需要下使能后才能修改和应用。',
  'Base profile for program/replay motion; Global Speed stacks on top of these speeds.':
    '程序/回放运动的基础参数；全局速度倍率会在这组速度上叠加。',
  'Joint groups include velocity, acceleration and jerk. The coordinate group has one shared XYZ value plus R.':
    '关节组包含速度、加速度和加加速度；坐标系组只有一份 XYZ 和一份 R。',
  'Screen action ratios still stack. Jog Settings and Playback Settings can be edited and applied only while the robot is disabled.':
    '屏幕动作比例仍会叠加。点动/再现参数需要下使能后才能修改和应用。',
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
  'Sub-pixel': '亚像素',
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
  'Jog {0}': '{0} 点动',
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
  'Recover the workstation before jogging.': '请先完成工作站恢复，再执行点动。',
  'Save the robot settings before jogging.': '请先保存机械臂设置，再执行点动。',
  'Remedy: {0}': '处理建议：{0}',
  'Controller Errors': '控制器错误',
  'Raw Joint Angles': '原始关节角度',
  'Joint Recovery Guide': '关节恢复指引',
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
  'Back to Overview': '返回总览',
  'Motion Settings': '运动参数',
  'Save Motion Settings': '保存运动参数',
  Cancel: '取消',
  'Motion settings saved.': '运动参数已保存。',
  'the selected screen': '所选屏幕',
  'Speed, contact and release values for {0}. Saving does not enable or move the robot and keeps the existing calibration geometry.':
    '{0} 的速度、接触与释放参数。保存不会使能或移动机械臂，并保留已有的标定几何。',
  'Avoiding the camera': '正在避让相机',
  'Auto avoid camera': '自动避让相机',
  'Moving to the camera-avoidance position': '正在移动到相机避让位',
  'Moving to the camera-avoidance position. Keep the workspace clear; Stop stays available.':
    '正在移动到相机避让位。请保持工作区清空，停止按钮始终可用。',
  'Hold the tip 2\u20135 cm above the screen centre. Free travel stays at this height or above.':
    '将笔尖停在屏幕中心上方 2–5 cm，自由移动不得低于此高度。',
  'Hold the tip 2\u20135 cm above the centre of "{0}". Free travel stays at this height or above.':
    '将笔尖停在「{0}」屏幕中心上方 2–5 cm，自由移动不得低于此高度。',
  'Move towards the camera at the reference height. Stop before any part of the arm gets close to the camera or stand.':
    '保持参考高度，向相机移动；在机械臂任何部位靠近相机或支架前停下。',
  'Hold still, then record. Drag Mode can stay on.':
    '保持静止后记录，无需退出拖动模式。',
  'Save and Calibrate': '保存并标定',
  'Free travel stays above the reference height and on the screen side of the boundary.':
    '自由移动保持在参考高度以上、边界的屏幕一侧。',
  'Check the whole arm directly before recording.':
    '记录前请直接检查整个机械臂的位置。',
  'Minimum Travel Height': '最低通行高度',
  'Keep the whole arm clear': '整个机械臂都需留出安全距离',
  'Use the taught positions, then calibrate and verify.':
    '使用示教位置，完成标定与验证。',
  '1. Teach Positions': '1. 记录示教位置',
  'Reference height + boundary': '参考高度与边界',
  '2. Sample and Calibrate': '2. 采样与标定',
  'Touch samples \u00b7 plane + mapping': '触点采样 · 平面与映射',
  '3. Verify and Complete': '3. 验证并完成',
  'Auto-save': '自动保存',
  'Calibration saved': '标定已保存',
  // Device strip and the camera mapping checklist.
  Devices: '设备',
  'Connect Screen Page': '连接屏幕页面',
  'Connect the screen page the camera sees.': '连接相机看到的屏幕页面。',
  'Perspective correction and camera mapping for this camera.':
    '该相机的透视校正与相机映射。',
  'Screen page': '屏幕页面',
  'Screen pages': '屏幕页面',
  'Screen pages {0}/{1}': '屏幕页面 {0}/{1}',
  'Screen pages: {0} of {1} connected': '屏幕页面：已连接 {0} / {1}',
  'Open Camera and Phone': '打开相机与手机',
  'Screen page in background': '屏幕页面在后台',
  'Screen page not connected': '屏幕页面未连接',
  'Action needed': '需要处理',
  'No camera': '未选择相机',
  'Perspective check failed': '透视校验未通过',
  'Perspective preset ready': '透视预设就绪',
  'No perspective preset': '没有透视预设',
  'Camera mapping confirmed': '相机映射已确认',
  'Camera mapping needed': '相机映射待确认',
  'Camera online': '相机在线',
  'View Phone Page': '查看屏幕页面',
  'Correct Perspective': '校正透视',
  'Set Up Perspective': '设置透视',
  'Camera Mapping Needed': '相机映射待确认',
  'Save the setup draft before confirming camera mapping.':
    '请先保存配置草稿，再确认相机映射。',
  'Confirm that the corrected image matches the screen.':
    '确认校正画面与屏幕一致。',
  'Connect the screen page, correct the perspective, then confirm that the corrected image matches the screen.':
    '连接屏幕页面，校正透视，然后确认校正画面与屏幕一致。',
  'Keep the screen page visible and fullscreen on the phone.':
    '保持手机上的屏幕页面可见并全屏。',
  'Perspective correction maps the four screen corners to a rectangle. Camera mapping records that this corrected image matches the physical screen; automatic exploration needs that confirmation.':
    '透视校正把屏幕四角变换为矩形。相机映射确认这张校正画面与实体屏幕一致，自动探索标定需要这一步的确认。',
  'Only the camera moved; redo the perspective correction.':
    '只有相机被移动：重做透视校正即可，不需要重新标定。',
  'The phone or its base moved; recalibrate.':
    '手机（或机械臂底座）被移动：需要重新标定。',
  'The stylus check could not attribute the change.':
    '触控笔无法判断是哪一侧移动：建议人工确认后重新标定。',
  'The stylus and phone motion are consistent with camera movement. Check the perspective correction.':
    '触控笔与手机的位移符合相机移动特征，请检查透视校正。',
  'The phone moved relative to the stationary stylus. Check the screen and robot calibration.':
    '手机相对静止的触控笔发生了位移，请检查屏幕位置和机械标定。',
  'No stylus reference is saved. Keep the stylus visible and the robot stationary, then save an aligned perspective preset.':
    '尚未保存触控笔参考。请保持笔尖可见、机械臂静止，并在透视轮廓吻合后保存预设。',
  'Fresh stationary robot pose feedback is unavailable; the stylus check cannot attribute the change.':
    '未获得机械臂静止时的最新位姿，暂时无法通过触控笔判断移动原因。',
  'The robot pose differs from the stylus reference. Return to the reference pose before checking the cause.':
    '机械臂位姿与触控笔参考不一致，请回到采集参考时的位姿后再检查原因。',
  'The stylus or phone reference could not be matched. Check visibility, focus and lighting.':
    '无法匹配触控笔或手机参考，请检查遮挡、对焦和光照。',
  'Several image regions match the reference; the movement cause is uncertain.':
    '画面中有多处与参考相似，暂时无法确定移动原因。',
  'The stylus and phone motions do not identify a single cause. Check both the camera and screen position.':
    '触控笔与手机的位移无法归结为单一原因，请同时检查相机和屏幕位置。',
  'The stylus and phone references show no significant movement; they do not explain the perspective mismatch.':
    '触控笔与手机参考均未检测到明显位移，无法解释本次透视失效。',
  'Keep the robot stationary with fresh pose feedback before recording the stylus reference.':
    '采集触控笔参考前，请保持机械臂静止并确保位姿反馈正常。',
  'The stylus reference could not be recorded: {0}': '未能保存触控笔参考：{0}',
  'Robot storage is in use by another process. Stop that service before continuing.':
    '安装配置正被另一个服务占用。请停止重复启动的服务，再刷新列表。',
  'Installation registry is unavailable':
    '安装配置索引尚未就绪，请刷新列表重试。',
  'Robot storage is unavailable': '安装配置存储不可用，请检查存储目录后重试。',
  'Invalid storage lock': '安装配置存储锁无效，请检查服务日志和存储目录。',
  Finish: '完成',
  'Next Step': '下一步',
  Diagnostics: '诊断信息',
  'Setup Complete': '配置完成',
  'Recalibrate Screen': '重新标定屏幕',
  'Review results': '查看结果',
  'Custom mounting': '自定义安装',
  'Saved configuration is unavailable. Start the arm service.':
    '无法读取已保存的配置，请启动机械臂服务。',
  'These values are for existing installations and troubleshooting. The guided steps keep the normal path simple.':
    '这些参数用于已有安装的维护和故障排查，日常配置请按引导步骤操作。',
  'Compare the two images, drag the corners if they are off, or run marker detection again.':
    '对比两张图像，若角点有偏差，请拖动调整或重新检测标记。',
  'This app commands the robot over TCP. The controller refuses commands in the teach pendant or DobotStudio mode.':
    '本应用通过 TCP 控制机械臂。控制器处于示教器或 DobotStudio 模式时会拒绝指令。',
  'Disable the robot before applying the saved tool payload.':
    '应用已保存的工具负载前，请先下使能机械臂。',
  Completed: '已完成',
  Failed: '失败',
  Stopped: '已停止',
  Skipped: '已跳过',
  Running: '运行中',
  Waiting: '等待中',
  Stopping: '停止中',
  'Saved screen outline': '已保存的屏幕轮廓',
  'Outline verification unavailable': '暂时无法检查屏幕轮廓',
  'Keep the camera running. Outline verification will retry automatically.':
    '请保持相机运行，系统会自动重试检查。',
  'A confirmed mismatch needs stable aligned frames before recovery.':
    '已确认的偏移需要多帧稳定对齐后才能恢复。',
  'The saved screen outline no longer matches the camera view. Recalibrate before moving.':
    '屏幕轮廓已偏移，请重新校正相机映射后再移动。',
  'Calibration changed or stopped during outline verification':
    '检查屏幕轮廓时标定已变更或停止。',
  'Camera correction changed during outline verification':
    '检查屏幕轮廓时相机映射已变更，请重新检查。',
  ...setupZh,
};
