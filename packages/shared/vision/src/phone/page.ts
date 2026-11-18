import {
  CALIBRATION_CLICK_RADIUS_PX,
  CALIBRATION_MARKERS,
  CALIBRATION_PHONE_POLICY,
  CALIBRATION_POINT_POLICY,
  calibrationCaptureTargets,
} from '@midscene/robotics-shared/assisted-contracts';

import { markerSvg } from '../camera/calibration-markers.js';
import { midscenePhoneLogo, phoneConnectionBrandStyles } from './brand.js';
import { mountCalibrationPhonePage } from './client.js';

/** A dependency-free phone surface. It has no robot control endpoints. */
export function calibrationPhonePage(
  pageId: string,
  options: { appearance?: 'airlink' } = {},
): string {
  const airlink = options.appearance === 'airlink';
  const grid = calibrationCaptureTargets({ width: 100, height: 100 })
    .map(
      ({ x, y }) =>
        `<span class="capture-grid-point" style="left:${x}%;top:${y}%"></span>`,
    )
    .join('');
  const markers = CALIBRATION_MARKERS.map(
    (m) =>
      `<div class="mapping-marker" style="left:${100 * m.x}%;top:${100 * m.y}%">${markerSvg(m.code).replace('<svg ', `<svg class="marker" data-code="${m.code}" data-purpose="${m.purpose}" `)}</div>`,
  ).join('');
  return `<!doctype html><html${airlink ? ' lang="en"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="referrer" content="no-referrer"><title>${airlink ? 'Midscene AirLink · Camera alignment' : 'Midscene Calibration'}</title><style>
*{box-sizing:border-box}html{touch-action:none;overscroll-behavior:none}body{--marker-size:min(100px,18vmin);margin:0;background:#fff;color:#1f2329;font:14px -apple-system,BlinkMacSystemFont,sans-serif;touch-action:none;overscroll-behavior:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}#surface{position:fixed;inset:0;overflow:hidden;touch-action:none}
#instructions{position:absolute;z-index:1;left:50%;top:50%;transform:translate(-50%,-50%);width:calc(100% - 48px);max-width:320px;display:grid;gap:8px;text-align:center;pointer-events:none}header{font-weight:600;font-size:13px}#message{color:#646a73;font-size:12px;line-height:1.5}#connection{color:#646a73;font-size:11px}#connection:empty,#touch-status:empty{display:none}#touch-status{font-size:11px;color:#ad5700}
body[data-stage]:not([data-stage=markers]) .mapping-marker{visibility:hidden}.mapping-marker{position:absolute;transform:translate(-50%,-50%);pointer-events:none}body[data-stage=markers] #instructions{top:31%}@media(max-height:450px){body[data-stage=markers] #instructions header,body[data-stage=markers] #connection{display:none}}.marker{display:block;flex:none;width:var(--marker-size);height:var(--marker-size);image-rendering:pixelated}
#target{display:none;position:absolute;z-index:2;place-items:center;width:26px;height:26px;transform:translate(-50%,-50%);border:2px solid #1677ff;border-radius:50%;background:#e8f1ff}#target-number{position:relative;color:#1677ff;font-size:12px;font-weight:600}#target[data-phase=verify]{width:${CALIBRATION_CLICK_RADIUS_PX * 2}px;height:${CALIBRATION_CLICK_RADIUS_PX * 2}px;border:2px solid #1677ff;background:#e8f1ff;box-shadow:none}#target[data-phase=verify]:before{display:none}#target[data-phase=verify].touched{background:#b7eb8f;border-color:#389e0d;box-shadow:0 0 0 12px #52c41a30;animation:verify-contact .65s ease-out}#target[data-phase=verify].touched #target-number{color:#237804}@keyframes verify-contact{0%{transform:translate(-50%,-50%) scale(.8);box-shadow:0 0 0 0 #52c41a70}100%{transform:translate(-50%,-50%) scale(1);box-shadow:0 0 0 12px #52c41a30}}@keyframes breathe{50%{box-shadow:0 0 0 14px #1677ff0d}}@media(prefers-reduced-motion:reduce){#target{animation:none!important;transition:none}}

.capture-grid-point{display:none;position:absolute;width:26px;height:26px;border:2px solid #8c8c8c;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none}

body[data-stage=collect] #instructions,body[data-stage=interrupted] #instructions{top:12px;transform:translateX(-50%);width:70%;gap:3px;padding:6px;background:#ffffffe6;border-radius:8px}body[data-stage=collect] #instructions header{display:none}.capture-grid-point{text-align:center;line-height:22px;font-size:12px;color:#8c8c8c}.capture-grid-point.is-complete{border-color:#21866a;color:#21866a;background:#e8f5ee}
#contact-feedback{position:absolute;z-index:4;pointer-events:none;display:none;width:26px;height:26px;border-radius:50%;background:#fa8c16;transform:translate(-50%,-50%)}#contact-feedback.active{display:block;animation:contact-pulse .65s ease-out}@keyframes contact-pulse{0%{box-shadow:0 0 0 0 #fa8c1670}100%{box-shadow:0 0 0 12px #fa8c1600}}
#hit-feedback{position:absolute;z-index:3;pointer-events:none;opacity:0;display:grid;place-items:center;width:38px;height:38px;border:3px solid #52c41a;border-radius:50%;color:#237804;background:#f6ffed;font-size:25px;font-weight:bold;transform:translate(-50%,-50%)}#hit-feedback.active{animation:hit-flash 1s ease-out forwards}@keyframes hit-flash{0%,55%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.5)}}@media(prefers-reduced-motion:reduce){#hit-feedback.active{animation:hit-flash-still 1s forwards}@keyframes hit-flash-still{0%,70%{opacity:1}100%{opacity:0}}}
#target[data-phase=failed]{border-color:#cf1322;background:#fff1f0}body[data-image-trial=true] #target[data-phase=verify]{background:#cf29b6;border:0}body[data-image-trial=true] #target-number{display:none}
#boundary-guide{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}#boundary-guide polygon{fill:none;stroke:#1677ff;stroke-width:2}#boundary-guide[data-group=contact] polygon{stroke:#389e0d}
body[data-stage=collect] #target,body[data-stage=collect] #instructions{display:none}
${
  airlink
    ? `
${phoneConnectionBrandStyles}
#instructions { gap: 6px; }
#page-title { color: #20251f; font-size: 17px; font-weight: 650; line-height: 1.2; }
#message { color: #515a51; font-size: 13px; line-height: 1.45; }
`
    : ''
}
</style></head><body data-stage="markers"${airlink ? ' data-appearance="airlink"' : ''}><main id="surface">${airlink ? `<div id="midscene-phone-brand">${midscenePhoneLogo}Midscene AirLink</div>` : ''}<div id="instructions"><header id="page-title">${airlink ? 'Connecting to AirLink' : 'Midscene · Calibration'}</header><div id="message"></div><div id="connection"></div><div id="touch-status" role="status"></div></div>${markers}<svg id="boundary-guide" aria-hidden="true"><polygon id="boundary-contour" /></svg><div id="capture-grid">${grid}</div><div id="target"><span id="target-number"></span></div><div id="contact-feedback"></div><div id="hit-feedback" aria-hidden="true">✓</div></main><script>(${mountCalibrationPhonePage.toString()})(${JSON.stringify({ ...CALIBRATION_POINT_POLICY, ...CALIBRATION_PHONE_POLICY, verificationRadiusPx: CALIBRATION_CLICK_RADIUS_PX })}, ${JSON.stringify(pageId)});
</script></body></html>`;
}
