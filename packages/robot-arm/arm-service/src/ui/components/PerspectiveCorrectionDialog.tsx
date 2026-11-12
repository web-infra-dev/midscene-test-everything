import { validateQuad } from '@midscene/robotics-shared/camera/vision-geometry';
import {
  PERSPECTIVE_ROTATIONS,
  type PerspectiveRotation,
  type PerspectiveTarget,
  type ScreenQuad,
} from '@midscene/robotics-shared/camera/vision-types';
import type { CameraCorrection } from '@midscene/robotics-shared/contracts';
import {
  Alert,
  Button,
  InputNumber,
  Modal,
  Segmented,
  Space,
  Tag,
  Typography,
} from 'antd';
import { Check, Crosshair, RotateCcw, ScanLine } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CameraCornerEditor, CorrectedPreview } from '../calibration';
import { useLanguage } from '../i18n';
import type { CameraMarkerDetection } from './ScreenMarkerPreview';
import './PerspectiveCorrectionDialog.less';

function problem(
  points: ScreenQuad,
  sourceWidth: number,
  sourceHeight: number,
  target: PerspectiveTarget,
) {
  try {
    validateQuad(points);
  } catch {
    return 'The four corners must form a valid convex quadrilateral.';
  }
  for (const point of Object.values(points))
    if (
      point.x < 0 ||
      point.x >= sourceWidth ||
      point.y < 0 ||
      point.y >= sourceHeight
    )
      return 'Every corner must stay inside the captured camera frame.';
  if (
    ![target.width, target.height].every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 7680,
    ) ||
    !PERSPECTIVE_ROTATIONS.includes(target.rotation)
  )
    return 'Output size and rotation are invalid.';
}

export type PerspectiveDraft = Pick<
  CameraMarkerDetection,
  'correction' | 'screenWidthPx' | 'screenHeightPx' | 'rotation'
> &
  ({ source: string } | CameraMarkerDetection);

export function PerspectiveCorrectionDialog({
  open,
  cameraName,
  detection,
  onClose,
  onDetectAgain,
  onApply,
}: {
  open: boolean;
  cameraName: string;
  detection?: PerspectiveDraft;
  onClose(): void;
  onDetectAgain(): void;
  onApply(
    correction: CameraCorrection,
    target: PerspectiveTarget,
  ): Promise<void>;
}) {
  const zh = useLanguage() === 'zh';
  const [points, setPoints] = useState<ScreenQuad>();
  const [target, setTarget] = useState<PerspectiveTarget>();
  const [mode, setMode] = useState<'detected' | 'manual'>('detected');
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!detection) return;
    setPoints(structuredClone(detection.correction.points));
    setTarget({
      width: detection.screenWidthPx,
      height: detection.screenHeightPx,
      rotation: detection.rotation,
    });
    setMode('source' in detection ? 'manual' : 'detected');
    setError(undefined);
  }, [detection]);
  if (!detection || !points || !target) return null;
  const correction: CameraCorrection = {
    points,
    sourceWidth: detection.correction.sourceWidth,
    sourceHeight: detection.correction.sourceHeight,
    rotation: target.rotation,
  };
  const problemText = problem(
    points,
    correction.sourceWidth,
    correction.sourceHeight,
    target,
  );
  const source =
    'source' in detection
      ? detection.source
      : `data:image/jpeg;base64,${detection.jpeg}`;
  const apply = async () => {
    if (problemText || applying) return;
    setApplying(true);
    setError(undefined);
    try {
      await onApply(correction, target);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setApplying(false);
    }
  };
  return (
    <Modal
      centered
      className="robot-dialog perspective-correction-dialog"
      destroyOnClose
      footer={
        <Space wrap>
          <Button onClick={onClose}>{zh ? '关闭' : 'Close'}</Button>
          <Button icon={<Crosshair size={16} />} onClick={onDetectAgain}>
            {zh ? '重新识别标记' : 'Detect markers again'}
          </Button>
          <Button
            disabled={Boolean(problemText)}
            icon={<Check size={16} />}
            loading={applying}
            onClick={() => void apply()}
            type="primary"
          >
            {zh ? '使用此结果' : 'Use this result'}
          </Button>
        </Space>
      }
      onCancel={onClose}
      open={open}
      title={`${zh ? '透视校正' : 'Perspective correction'} · ${cameraName}`}
      width="min(1120px, 94vw)"
    >
      <div className="perspective-correction-body">
        <div className="perspective-correction-toolbar">
          {!('source' in detection) && (
            <Space wrap size={6}>
              <Tag color="success">
                {detection.markerIds.length}/6 {zh ? '标记' : 'markers'}
              </Tag>
              <Tag>
                {detection.validFrames}/{detection.frameCount}{' '}
                {zh ? '有效帧' : 'valid frames'}
              </Tag>
              <Tag>
                {zh ? '角点抖动' : 'Corner jitter'}{' '}
                {detection.jitterPx.toFixed(2)} px
              </Tag>
              <Tag>{detection.errorPx.toFixed(2)} px</Tag>
            </Space>
          )}
          <Space wrap>
            {!('source' in detection) && (
              <Segmented
                onChange={(value) => setMode(value as 'detected' | 'manual')}
                options={[
                  { value: 'detected', label: zh ? '识别结果' : 'Detected' },
                  { value: 'manual', label: zh ? '编辑四角' : 'Edit corners' },
                ]}
                value={mode}
              />
            )}
            {mode === 'manual' && (
              <Button
                icon={<RotateCcw size={16} />}
                onClick={() => {
                  setPoints(structuredClone(detection.correction.points));
                  setMode('source' in detection ? 'manual' : 'detected');
                }}
              >
                {zh ? '还原四角' : 'Reset corners'}
              </Button>
            )}
          </Space>
        </div>
        <Alert
          showIcon
          type="info"
          message={
            zh
              ? '对照原始画面与透视校正结果，必要时编辑四角。'
              : 'Compare the original frame with the corrected result, and edit the corners when needed.'
          }
        />
        {problemText && <Alert showIcon type="warning" message={problemText} />}
        {error && <Alert showIcon type="error" message={error} />}
        <div className="perspective-correction-grid">
          <section className="perspective-correction-panel">
            <header>{zh ? '原始画面' : 'Original'}</header>
            <CameraCornerEditor
              disabled={mode !== 'manual'}
              onChange={(next) => setPoints(next.points)}
              src={source}
              value={correction}
            />
          </section>
          <section className="perspective-correction-panel">
            <header>
              {zh ? '校正结果' : 'Corrected'}
              <small>
                {target.width} × {target.height}
              </small>
            </header>
            <CorrectedPreview
              correction={{ ...correction, rotation: target.rotation }}
              size={target}
              src={source}
            />
          </section>
        </div>
        <section className="perspective-correction-output">
          <div>
            <Typography.Text strong>
              {zh ? '输出尺寸与旋转' : 'Output size and rotation'}
            </Typography.Text>
            <Typography.Text type="secondary">
              {zh
                ? '屏幕方向错误时选择 90° 或 270°。'
                : 'Choose 90° or 270° when the screen lies on its side.'}
            </Typography.Text>
          </div>
          <Space wrap>
            <InputNumber
              addonAfter={zh ? '宽' : 'width'}
              max={7680}
              min={1}
              onChange={(value) =>
                setTarget({ ...target, width: value ?? target.width })
              }
              value={target.width}
            />
            <InputNumber
              addonAfter={zh ? '高' : 'height'}
              max={7680}
              min={1}
              onChange={(value) =>
                setTarget({ ...target, height: value ?? target.height })
              }
              value={target.height}
            />
            <Segmented
              onChange={(value) =>
                setTarget({
                  ...target,
                  rotation: value as PerspectiveRotation,
                })
              }
              options={PERSPECTIVE_ROTATIONS.map((value) => ({
                label: `${value}°`,
                value,
              }))}
              value={target.rotation}
            />
          </Space>
        </section>
      </div>
    </Modal>
  );
}
