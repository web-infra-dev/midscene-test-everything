const template = document.createElement('template');
template.innerHTML = `
  <form id="hid-form" class="session-setup-form">
    <label>设备服务地址<input name="host" type="url" value="http://localhost:5801" required></label>
    <label>访问凭证<input name="token" type="password" autocomplete="off" required></label>
    <label>手机<select name="deviceId" required disabled></select></label>
    <div class="hid-actions">
      <button type="button" id="query">查询设备</button>
      <button type="submit" id="connect" disabled>连接</button>
    </div>
    <p id="hid-notice" role="status" aria-live="polite" hidden></p>
  </form>
`;
const form = template.content.firstElementChild;
const host = form.elements.namedItem('host');
const token = form.elements.namedItem('token');
const deviceId = form.elements.namedItem('deviceId');
const query = form.querySelector('#query');
const connect = form.querySelector('#connect');
const disconnect = document.createElement('button');
disconnect.id = 'hid-disconnect';
disconnect.type = 'button';
disconnect.textContent = '断开设备';
const notice = form.querySelector('#hid-notice');
const disconnectNotice = document.createElement('span');
disconnectNotice.setAttribute('role', 'status');
const toolbar = document.createElement('div');
toolbar.className = 'hid-device-toolbar';
toolbar.append(disconnectNotice, disconnect);
let querying;
let connected = false;

function showNotice(message = '') {
  notice.textContent = message;
  notice.hidden = !message;
}

function resetDevices() {
  deviceId.replaceChildren(new Option('查询设备后选择一台手机', ''));
  deviceId.disabled = true;
  connect.disabled = true;
}

async function request(path, options) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '请求失败，请重试。');
  return data;
}

function post(path, input, signal) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
}

for (const field of [host, token]) {
  field.addEventListener('input', () => {
    querying?.abort();
    resetDevices();
    showNotice();
  });
}
deviceId.addEventListener('change', () => {
  connect.disabled = !deviceId.value;
});
query.addEventListener('click', async () => {
  if (!host.reportValidity() || !token.reportValidity()) return;
  const cancellation = new AbortController();
  querying = cancellation;
  query.disabled = true;
  resetDevices();
  showNotice();
  try {
    const { devices } = await post(
      '/ios-hid/devices',
      { host: host.value, token: token.value },
      cancellation.signal,
    );
    if (cancellation.signal.aborted) return;
    const status = { available: '可用', busy: '使用中', offline: '离线' };
    for (const device of devices) {
      const option = new Option(
        `${device.name} · ${status[device.status] ?? '离线'}`,
        device.id,
      );
      option.disabled = device.status !== 'available';
      deviceId.add(option);
    }
    deviceId.disabled = !devices.length;
    if (!devices.some((device) => device.status === 'available'))
      showNotice('没有可用手机，请到设备管理台检查连接。');
  } catch (error) {
    if (!cancellation.signal.aborted) showNotice(error.message);
  } finally {
    if (querying === cancellation) {
      querying = undefined;
      query.disabled = false;
    }
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!deviceId.value || connect.disabled) return;
  const input = {
    host: host.value,
    token: token.value,
    deviceId: deviceId.value,
  };
  host.disabled = true;
  token.disabled = true;
  deviceId.disabled = true;
  query.disabled = true;
  connect.disabled = true;
  showNotice();
  try {
    await post('/session', input);
    location.reload();
  } catch (error) {
    showNotice(error.message);
  } finally {
    host.disabled = false;
    token.disabled = false;
    deviceId.disabled = false;
    query.disabled = false;
    connect.disabled = !deviceId.value;
  }
});
disconnect.addEventListener('click', async () => {
  disconnect.disabled = true;
  disconnectNotice.textContent = '';
  try {
    await request('/session', { method: 'DELETE' });
    location.reload();
  } catch (error) {
    disconnectNotice.textContent = error.message;
  } finally {
    disconnect.disabled = false;
  }
});

// The published Playground renders its shell asynchronously. Mount only the
// HID-specific controls in its existing setup card or preview column.
function mountControls() {
  if (connected) {
    const preview = document.querySelector('.right-panel-content');
    if (preview && toolbar.parentElement !== preview) preview.prepend(toolbar);
  } else {
    const card = document.querySelector('.session-setup-card');
    if (card && form.parentElement !== card) card.append(form);
  }
}

resetDevices();
void request('/session')
  .then((session) => {
    connected = Boolean(session.connected);
    new MutationObserver(mountControls).observe(
      document.getElementById('root'),
      {
        childList: true,
        subtree: true,
      },
    );
    mountControls();
  })
  .catch((error) => showNotice(error.message));
