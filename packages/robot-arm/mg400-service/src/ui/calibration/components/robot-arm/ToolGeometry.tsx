import { Button } from 'antd';
import { t, useCalibrationLanguage } from '../../i18n';
import { TOOL_AXES, type ToolAxis } from './setup-draft';

const vectors = { X: [38, -12], Y: [28, 22], Z: [0, -34] } as const;
function endpoint(axis: ToolAxis) {
  const [x, y] = vectors[axis[1] as keyof typeof vectors];
  const sign = axis[0] === '+' ? 1 : -1;
  return { x: x * sign, y: y * sign };
}
export function DirectionDrawing({ axis }: { axis: ToolAxis }) {
  useCalibrationLanguage();
  const tip = endpoint(axis);
  return (
    <svg viewBox="0 0 110 94" aria-hidden="true">
      {(['X', 'Y', 'Z'] as const).map((name) => {
        const [x, y] = vectors[name];
        return (
          <g key={name} opacity="0.45">
            <line
              x1="55"
              y1="45"
              x2={55 + x}
              y2={45 + y}
              stroke="currentColor"
            />
            <text x={55 + x + 3} y={45 + y} fontSize="9" fill="currentColor">
              {name}
            </text>
          </g>
        );
      })}
      <circle cx="55" cy="45" r="5" fill="currentColor" />
      <line
        x1="55"
        y1="45"
        x2={55 + tip.x}
        y2={45 + tip.y}
        stroke="currentColor"
        strokeWidth="5"
      />
      <circle cx={55 + tip.x} cy={45 + tip.y} r="3" fill="currentColor" />
    </svg>
  );
}

export function ToolDirectionPicker({
  axis,
  disabled,
  onChange,
  error,
}: {
  axis?: ToolAxis;
  disabled: boolean;
  onChange: (axis: ToolAxis) => void;
  error?: string;
}) {
  useCalibrationLanguage();
  return (
    <div className="robot-form-field" data-setup-field="tool/mountingAxis">
      <span>{t('Tool Mounting Direction')}</span>
      <span className="robot-field-help">
        {t(
          'Choose the drawing that matches your mounting. These axes belong to the flange.',
        )}
      </span>
      <fieldset
        className="robot-tool-directions"
        aria-label={t('Tool Mounting Direction')}
      >
        {TOOL_AXES.map((value) => (
          <Button
            key={value}
            aria-label={t('Mount Tool Along {0}', [value])}
            aria-pressed={axis === value}
            disabled={disabled}
            onClick={() => onChange(value)}
          >
            <DirectionDrawing axis={value} />
            <span>
              {t('Along')} {value}
            </span>
          </Button>
        ))}
      </fieldset>
      {error && (
        <span className="robot-field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
