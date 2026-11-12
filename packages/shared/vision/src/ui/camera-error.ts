export function cameraSetupErrorText(message: string): string {
  if (message.includes('The browser did not report the page position'))
    return '无法确定网页在屏幕上的位置。在 iPhone 的 Safari 中选择「分享 → 添加到主屏幕」，从主屏幕图标打开标定页并按提示轻点一次，然后重新识别。也可以手动调整四角。';
  if (
    /marker .*could not be decoded uniquely|calibration markers.*visible/i.test(
      message,
    )
  )
    return '屏幕标记识别不清，请调整对焦或避开反光，确保所有标记清晰可见后重试。';
  if (/normal zoom|entire screen visible/i.test(message))
    return '请将手机辅助页恢复为默认缩放，并让摄像头拍到完整屏幕。';
  if (/fit error|reprojection/i.test(message))
    return '屏幕边缘未对齐，请调整四个角点或重新识别后重试。';
  if (/timeout|timed out/i.test(message))
    return '识别超时，请检查相机连接后重试。';
  if (/marker|mapping.*error|reprojection/i.test(message))
    return '暂时无法校验屏幕，请保持手机辅助页打开，并确认标记完整、清晰。';
  return message.replace(/^Error:\s*/, '');
}
