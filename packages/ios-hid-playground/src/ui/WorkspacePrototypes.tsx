import { PlaygroundApp } from '@midscene/arm-kit-playground/shell';
import type { PlaygroundControllerResult } from '@midscene/arm-kit-playground/shell/controller/types.ts';
import { PlaygroundConversationPanel } from '@midscene/arm-kit-playground/shell/panels/PlaygroundConversationPanel.tsx';
import { Button, Dropdown, Popover, Segmented, Tabs, message } from 'antd';
import { useState } from 'react';
import { type Route, navigate } from './routes';
import './workspace-prototypes.css';
import { BluetoothStatusIcon as ConnectionIcon } from './MultiDeviceApp';

// Design fixtures only. These are never passed to Host or session creation.
const phones = [
  { id: 'desk', name: '主力 iPhone', source: 'USB', online: true },
  { id: 'test', name: '测试 iPhone', source: '独立摄像头', online: true },
  { id: 'spare', name: '备用 iPhone', source: 'AirPlay', online: false },
];
type Issue = 'bluetooth' | 'camera';
function WarningIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m10.3 4.4-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-2.6l-8-14a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4m0 4h.01" />
    </svg>
  );
}
export function WorkspacePrototypes({ variant }: { variant: 'a' | 'b' | 'c' }) {
  const [selected, setSelected] = useState('desk');
  const phone = phones.find((item) => item.id === selected)!;
  const [issues, setIssues] = useState<Record<string, Issue>>({});
  const [retrying, setRetrying] = useState(false);
  const issue = variant === 'b' ? issues[selected] : undefined;
  const online = variant === 'b' || phone.online;
  const chooseScenario = (value: string | number) => {
    if (value === 'normal') setIssues({});
    else {
      const id = value === 'camera' ? 'test' : 'desk';
      setSelected(id);
      setIssues({ [id]: value as Issue });
    }
  };
  const retryCamera = () => {
    setRetrying(true);
    // Simulates recovery in this design fixture; it never accesses hardware.
    setTimeout(() => {
      setIssues((current) => {
        const next = { ...current };
        delete next[selected];
        return next;
      });
      setRetrying(false);
      void message.success('原型演示：摄像头画面已恢复，请手动重新执行任务');
    }, 700);
  };
  const connectionGuide = (
    <div className="prototype-status">
      <strong>重新连接蓝牙</strong>
      <p>在手机「设置 → 蓝牙」中连接 Midscene，并保持辅助触控开启。</p>
      <p className="prototype-muted">
        恢复后可重新执行任务，不会自动重试之前的操作。
      </p>
      <Button size="small" onClick={() => navigate('connect')}>
        打开设备设置
      </Button>
    </div>
  );

  const status = (
    <div className="prototype-status">
      <strong>{phone.name}</strong>
      <dl>
        <dt>画面来源</dt>
        <dd>
          {phone.source} ·{' '}
          {issue === 'camera' ? '无画面' : online ? '画面正常' : '未连接'}
        </dd>
        <dt>蓝牙键鼠</dt>
        <dd>
          <span
            className={issue === 'bluetooth' ? 'prototype-status-error' : ''}
          >
            {issue === 'bluetooth' || !online ? '已断开' : '已连接'}
          </span>
        </dd>
        <dt>指针验证</dt>
        <dd>{issue ? '连接恢复后重新验证' : online ? '已通过' : '等待连接'}</dd>
      </dl>
      {variant === 'b' && issue === 'bluetooth' && (
        <p className="prototype-status-explanation">
          画面正常，蓝牙输入不可用。
        </p>
      )}
      {variant === 'b' && issue === 'camera' && (
        <p className="prototype-status-explanation">
          摄像头无画面，蓝牙仍已连接。
        </p>
      )}
      {!online && <Button onClick={() => navigate('connect')}>重新连接</Button>}
    </div>
  );
  const deviceLabel = (item: typeof phone) => (
    <>
      {variant === 'b' && issues[item.id] ? (
        <span className="prototype-tab-warning">
          <WarningIcon />
        </span>
      ) : (
        <span
          className={`prototype-dot${variant === 'b' || item.online ? '' : ' offline'}`}
        />
      )}
      {item.name}
    </>
  );
  const add = (
    <Button type="text" onClick={() => navigate('connect')}>
      ＋ 添加设备
    </Button>
  );
  const conversation = (controller: PlaygroundControllerResult) => (
    <div className="prototype-workspace">
      <div className="prototype-picker">
        <span>
          {variant === 'b' ? '交互原型 · 状态演示' : '交互原型 · 示例设备'}
        </span>
        {variant === 'b' ? (
          <Segmented
            size="small"
            value={Object.values(issues)[0] ?? 'normal'}
            options={[
              { value: 'normal', label: '正常' },
              { value: 'bluetooth', label: '蓝牙断开' },
              { value: 'camera', label: '摄像头异常' },
            ]}
            onChange={chooseScenario}
          />
        ) : (
          <Segmented
            size="small"
            value={variant}
            options={['a', 'b', 'c'].map((value) => ({
              value,
              label: value.toUpperCase(),
            }))}
            onChange={(value) => navigate(`prototype-${value}` as Route)}
          />
        )}
      </div>
      <div className="prototype-device-bar">
        {variant === 'a' ? (
          <Dropdown
            trigger={['click']}
            menu={{
              selectedKeys: [selected],
              items: phones.map((item) => ({
                key: item.id,
                label: deviceLabel(item),
              })),
              onClick: ({ key }) => setSelected(key),
            }}
          >
            <Button type="text">
              {deviceLabel(phone)} <span className="prototype-chevron">⌄</span>
            </Button>
          </Dropdown>
        ) : variant === 'b' ? (
          <Tabs
            size="small"
            activeKey={selected}
            onChange={setSelected}
            tabBarExtraContent={add}
            items={phones.map((item) => ({
              key: item.id,
              label: deviceLabel(item),
            }))}
          />
        ) : (
          <span className="prototype-device-heading">
            设备 <span className="prototype-muted">3</span>
          </span>
        )}
        {variant !== 'c' && variant !== 'b' && (
          <Popover trigger="click" content={status} placement="bottomLeft">
            <Button
              type="text"
              size="small"
              className="prototype-connection-trigger"
              aria-label="设备连接状态"
              title="设备连接状态"
              icon={
                <ConnectionIcon
                  active={online && !issue}
                  warning={Boolean(issue) || !online}
                />
              }
            />
          </Popover>
        )}
        {variant !== 'b' && add}
      </div>
      {variant === 'b' && issue && (
        <output className="prototype-issue-notice">
          <WarningIcon />
          <span>
            {issue === 'bluetooth'
              ? '蓝牙已断开，暂时无法执行任务。'
              : '摄像头无画面，暂时无法执行任务。'}
          </span>
          {issue === 'bluetooth' ? (
            <Popover
              trigger="click"
              placement="bottomLeft"
              content={connectionGuide}
            >
              <Button type="link" size="small">
                连接指引
              </Button>
            </Popover>
          ) : (
            <Button
              type="link"
              size="small"
              loading={retrying}
              onClick={retryCamera}
            >
              重试摄像头
            </Button>
          )}
        </output>
      )}
      {variant === 'c' && (
        <div className="prototype-device-list">
          {phones.map((item) => (
            <button
              type="button"
              key={item.id}
              className={selected === item.id ? 'selected' : ''}
              onClick={() => setSelected(item.id)}
            >
              <span>{deviceLabel(item)}</span>
              <span className="prototype-muted">
                {item.source} · {item.online ? '已连接' : '已断开'}
              </span>
            </button>
          ))}
          <Popover trigger="click" content={status} placement="bottomLeft">
            <Button type="text" size="small">
              查看当前设备连接状态
            </Button>
          </Popover>
        </div>
      )}
      <div
        className={`prototype-task${issue ? ' prototype-task-unavailable' : ''}`}
        ref={(element) => element?.setAttribute('inert', '')}
      >
        <PlaygroundConversationPanel
          controller={{
            ...controller,
            state: {
              ...controller.state,
              sessionViewState: {
                ...controller.state.sessionViewState,
                connected: true,
              },
            },
          }}
          appVersion="1.17.5"
          title="iOS HID Playground"
        />
      </div>
    </div>
  );
  return (
    <PlaygroundApp
      sessionReady={false}
      serverUrl={location.origin}
      appVersion="1.17.5"
      renderSetup={conversation}
      renderPendingPreview={() => (
        <div className="prototype-screen">
          <div className="prototype-preview-title">
            <span>
              {phone.name}{' '}
              <span className="prototype-muted">／ {phone.source}</span>
            </span>
            <Popover trigger="click" content={status}>
              <Button
                type="text"
                size="small"
                className="prototype-preview-state"
                aria-label="查看画面与输入状态"
              >
                {issue === 'camera'
                  ? '画面中断'
                  : online
                    ? '画面正常'
                    : '未连接'}{' '}
                <ConnectionIcon
                  active={online && !issue}
                  warning={Boolean(issue) || !online}
                />
              </Button>
            </Popover>
          </div>
          <div
            className={`prototype-preview-body${issue === 'camera' ? ' prototype-frame-stale' : ''}`}
          >
            {online ? (
              <div className="prototype-phone">
                <div className="prototype-phone-time">
                  9:41 <span>▮▮▮ ▰</span>
                </div>
                <div className="prototype-phone-island" />
                <h2>设置</h2>
                <div className="prototype-phone-search">搜索</div>
                <div className="prototype-phone-account">
                  <span>👤</span>
                  <div>
                    iPhone<small>Apple 账户、iCloud 等</small>
                  </div>
                </div>
                {[
                  '飞行模式',
                  '无线局域网',
                  '蓝牙',
                  '蜂窝网络',
                  '通用',
                  '辅助功能',
                  '显示与亮度',
                ].map((item, index) => (
                  <div className="prototype-phone-row" key={item}>
                    <i
                      style={{
                        background: [
                          '#ff9500',
                          '#007aff',
                          '#007aff',
                          '#34c759',
                          '#8e8e93',
                          '#007aff',
                          '#007aff',
                        ][index],
                      }}
                    />
                    {item}
                    <span>{item === '蓝牙' ? '开启　' : ''}›</span>
                  </div>
                ))}
                <div className="prototype-phone-home" />
              </div>
            ) : (
              <div className="prototype-disconnected">
                <strong>设备已断开</strong>
                <p>重新连接后继续使用此设备。</p>
                <Button onClick={() => navigate('connect')}>重新连接</Button>
              </div>
            )}
            {issue === 'camera' && (
              <div className="prototype-frame-overlay">
                <div>
                  <span className="prototype-large-warning">
                    <WarningIcon />
                  </span>
                  <strong>摄像头画面已中断</strong>
                  <p>当前为最后一帧，恢复前无法执行任务。</p>
                  <Button loading={retrying} onClick={retryCamera}>
                    重试摄像头
                  </Button>
                </div>
              </div>
            )}
          </div>
          <div className="prototype-preview-foot">
            {issue === 'bluetooth'
              ? '画面仍可预览 · 等待蓝牙重新连接'
              : issue === 'camera'
                ? '最后一帧 · 示例画面，非实时视频'
                : '示例画面 · 不执行手机操作'}
          </div>
        </div>
      )}
    />
  );
}
