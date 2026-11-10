import { readFileSync } from 'node:fs';
import {
  CALIBRATION_CLICK_RADIUS_PX,
  CALIBRATION_MARKERS,
  CALIBRATION_PHONE_POLICY,
  CALIBRATION_POINT_POLICY,
  calibrationCaptureTargets,
} from '../../assisted-contracts.js';

import { markerSvg } from '../../camera/calibration-markers.js';
import { mountCalibrationPhonePage } from './client.js';

// Inline the small phone assets so LAN, standalone and packaged SDK links serve the same page.
const asset = (name: string) =>
  readFileSync(new URL(`../../../assets/phone/${name}`, import.meta.url));
const awakeScript = asset('awake.js').toString('utf8');
const awakeVideo = `data:video/mp4;base64,${asset('awake.mp4').toString('base64')}`;
const touchStyles = asset('touch.css').toString('utf8');

export function phoneMarkerElements(markerCodes?: readonly number[]) {
  return CALIBRATION_MARKERS.map(
    (m, i) =>
      `<div class="mapping-marker" style="left:${100 * m.x}%;--marker-y:${100 * m.y}%;--inset-y:${100 * (0.16 + 0.68 * m.y)}%">${markerSvg(markerCodes?.[i] ?? m.code).replace('<svg ', `<svg class="marker" data-code="${markerCodes?.[i] ?? m.code}" data-purpose="${m.purpose}" `)}</div>`,
  );
}

/** A dependency-free phone surface. It has no robot control endpoints. */
export function calibrationPhonePage(
  pageId: string,
  markerCodes?: readonly number[],
): string {
  const grid = calibrationCaptureTargets({ width: 100, height: 100 })
    .map(
      ({ x, y }) =>
        `<span class="capture-grid-point" style="left:${x}%;top:${y}%"></span>`,
    )
    .join('');
  const markers = phoneMarkerElements(markerCodes).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><meta name="screen-orientation" content="portrait"><meta name="x5-orientation" content="portrait"><meta name="x5-fullscreen" content="true"><meta name="full-screen" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="referrer" content="no-referrer"><title>Midscene Calibration</title><style>
*{box-sizing:border-box}html{touch-action:none;overscroll-behavior:none}body{isolation:isolate;--marker-size:min(100px,18vmin);margin:0;background:#fff;color:#1f2329;font:14px -apple-system,BlinkMacSystemFont,sans-serif;touch-action:none;overscroll-behavior:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}#surface{position:fixed;inset:0;overflow:hidden;touch-action:none}body[data-portrait-fallback=true]{background:#000}body[data-portrait-fallback=true] #surface{inset:auto;left:50%;top:50%;width:var(--portrait-width);height:var(--portrait-height);transform:translate(-50%,-50%) rotate(var(--portrait-rotation));transform-origin:center}
#instructions{position:absolute;z-index:1;left:50%;top:50%;transform:translate(-50%,-50%);width:calc(100% - 48px);max-width:320px;display:grid;gap:8px;text-align:center;pointer-events:none}header{font-weight:600;font-size:13px}#message{color:#646a73;font-size:12px;line-height:1.5}#connection{color:#646a73;font-size:11px}#connection:empty,#touch-status:empty{display:none}#touch-status{font-size:11px;color:#ad5700}
body[data-preview][data-connection-error=true] .mapping-marker,body[data-stage]:not([data-stage=markers]) .mapping-marker{visibility:hidden}body[data-inset-markers=true] .mapping-marker{top:var(--inset-y)}.mapping-marker{top:var(--marker-y);position:absolute;transform:translate(-50%,-50%);pointer-events:none}body[data-stage=markers] #instructions{top:31%}@media(max-height:450px){body[data-stage=markers] #instructions header,body[data-stage=markers] #connection{display:none}}.marker{display:block;flex:none;width:var(--marker-size);height:var(--marker-size);image-rendering:pixelated}
#target{display:none;position:absolute;z-index:2;place-items:center;width:26px;height:26px;transform:translate(-50%,-50%);border:2px solid #1677ff;border-radius:50%;background:#e8f1ff}#target-number{position:relative;color:#1677ff;font-size:12px;font-weight:600}#target[data-phase=verify]{width:${CALIBRATION_CLICK_RADIUS_PX * 2}px;height:${CALIBRATION_CLICK_RADIUS_PX * 2}px;border:2px solid #1677ff;background:#e8f1ff;box-shadow:none}#target[data-phase=verify]:before{display:none}@media(prefers-reduced-motion:reduce){#target{animation:none!important;transition:none}}

.capture-grid-point{display:none;position:absolute;width:26px;height:26px;border:2px solid #8c8c8c;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none}

body[data-stage=collect] #instructions,body[data-stage=interrupted] #instructions{top:12px;transform:translateX(-50%);width:70%;gap:3px;padding:6px;background:#ffffffe6;border-radius:8px}body[data-stage=collect] #instructions header{display:none}.capture-grid-point{text-align:center;line-height:22px;font-size:12px;color:#8c8c8c}.capture-grid-point.is-complete{border-color:#21866a;color:#21866a;background:#e8f5ee}
${touchStyles}
#approach-guides{display:none}body:is([data-stage=touch-preview],[data-stage=positioning],[data-stage=collect][data-probe-phase=local]) #approach-guides{display:block}body:is([data-stage=touch-preview],[data-stage=positioning]) #instructions{top:max(12px,env(safe-area-inset-top));transform:translateX(-50%)}
#target[data-phase=failed]{border-color:#cf1322;background:#fff1f0}body[data-image-trial=true] #target[data-phase=verify]{background:#cf29b6;border:0}body[data-image-trial=true] #target-number{display:none}
body[data-verification=true] #instructions,body[data-stage=collect] #target,body[data-stage=collect] #instructions{display:none}
#fullscreen-controls{position:fixed;z-index:5;top:39%;left:50%;transform:translate(-50%,-50%);width:min(80vw,340px);text-align:center}#fullscreen-controls button{padding:8px 16px}#fullscreen-help:not([hidden]){display:block;background:white}#wake-gesture{display:none}body[data-wake-blocked=true] #wake-gesture{display:inline-block}body[data-display-ready=false] .mapping-marker,body[data-display-ready=false] #target{visibility:hidden}body:is([data-stage=collect],[data-stage=safety],[data-stage=verify],[data-stage=returning],[data-stage=completed]) #wake-gesture{display:none}#fullscreen-controls{pointer-events:none}#fullscreen-controls button{pointer-events:auto}
</style></head><body data-display-ready="false" data-wake-video="${awakeVideo}" data-stage="markers"${markerCodes ? ' data-preview data-connection-error="true"' : ''}><main id="surface"><div id="instructions"><header>Midscene · Calibration</header><div id="message"></div><div id="connection"></div><div id="touch-status" role="status"></div></div>${markers}<div id="approach-guides" aria-hidden="true">
          <span class="approach-reference" data-corner="1">1</span>
          <span class="approach-reference" data-corner="2">2</span>
          <span class="approach-reference" data-corner="3">3</span>
          <span class="approach-reference" data-corner="4">4</span>
          <div class="approach-target"><span>+</span></div>
        </div><div id="verification-guide" aria-hidden="true" hidden></div><div id="capture-grid">${grid}</div><div id="target"><span id="target-number"></span></div><div id="mapping-trail" aria-hidden="true"></div><div id="mapping-hit" aria-hidden="true"></div></main><div id="fullscreen-controls"><button id="marker-fullscreen" data-fullscreen-control type="button"></button><small id="wake-gesture" role="status"></small><small id="fullscreen-help"></small></div><script>${awakeScript}
;(${mountCalibrationPhonePage.toString()})(${JSON.stringify({ ...CALIBRATION_POINT_POLICY, ...CALIBRATION_PHONE_POLICY, verificationRadiusPx: CALIBRATION_CLICK_RADIUS_PX })}, ${JSON.stringify(pageId)}, globalThis.RobotScreenCalibAwake);
</script></body></html>`;
}
