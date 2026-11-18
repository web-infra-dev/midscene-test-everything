import { readFileSync } from 'node:fs';

const logo = readFileSync(
  new URL('../../assets/phone/midscene-logo.png', import.meta.url),
).toString('base64');

// The QR page is served over the LAN. The logo needs no separate request.
export const midscenePhoneLogo = `<img class="midscene-phone-logo" src="data:image/png;base64,${logo}" width="20" height="19" alt="">`;

export const phoneConnectionBrandStyles = `
#midscene-phone-brand {
  position: fixed;
  top: max(24px, env(safe-area-inset-top));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 7px;
  color: #334135;
  font: 600 14px/1.2 system-ui, sans-serif;
  white-space: nowrap;
  pointer-events: none;
}
#midscene-phone-brand[hidden] { display: none; }
@media (max-height: 460px) {
  #midscene-phone-brand { display: none; }
}
`;
