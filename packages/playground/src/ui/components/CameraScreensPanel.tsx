import { Button, Card, Popconfirm, Tag, Typography } from 'antd';
import { Trash2 } from 'lucide-react';
import { type CameraScreenEntry, cameraScreenName } from '../camera-screens';
import { useLanguage, useT } from '../i18n';
import './CameraScreens.less';

export function CameraScreensPanel({
  screens,
  selectedId,
  onSelect,
  onRemove,
}: {
  screens: CameraScreenEntry[];
  selectedId: string;
  onSelect: (id: string) => void;
  onRemove: (screen: CameraScreenEntry) => void;
}) {
  const t = useT();
  const zh = useLanguage() === 'zh';
  return (
    <Card
      className="camera-screens-card"
      size="small"
      title={t('cameraScreens')}
    >
      <div className="camera-screen-list">
        {screens.length === 0 && (
          <Typography.Text type="secondary">
            {t('screensAppearAfterScan')}
          </Typography.Text>
        )}
        {screens.map((screen) => (
          <div
            className={`camera-screen-item${
              screen.id === selectedId ? ' is-active' : ''
            }`}
            key={screen.id}
          >
            <button
              className="camera-screen-select"
              onClick={() => onSelect(screen.id)}
              type="button"
            >
              <span className="camera-screen-name">
                {cameraScreenName(screen, zh)}
                {screen.base && (
                  <Typography.Text type="secondary">
                    {' '}
                    · {t('screenBase')}
                  </Typography.Text>
                )}
              </span>
              <Tag color={screen.hasCorrection ? 'green' : undefined}>
                {screen.hasCorrection
                  ? t('screenCorrected')
                  : t('screenNotCorrected')}
              </Tag>
            </button>
            {!screen.base && (
              <Popconfirm
                cancelText={zh ? '取消' : 'Cancel'}
                description={t('deleteScreenBody')}
                okButtonProps={{ danger: true }}
                okText={t('deleteScreen')}
                onConfirm={() => onRemove(screen)}
                title={t('deleteScreenTitle')}
              >
                <Button
                  aria-label={t('deleteScreen')}
                  danger
                  icon={<Trash2 size={14} />}
                  size="small"
                  type="text"
                />
              </Popconfirm>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
