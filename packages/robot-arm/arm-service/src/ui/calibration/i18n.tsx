import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import type { ReactNode } from 'react';
import { create } from 'zustand';
import { zh } from './locales/zh';
export type Language = 'en' | 'zh';
export const useCalibrationLanguage = create<{
  language: Language;
  setLanguage: (language: Language) => void;
}>((set) => ({ language: 'zh', setLanguage: (language) => set({ language }) }));
export function t(
  message: string,
  values: readonly unknown[] = [],
  language: Language = useCalibrationLanguage.getState().language,
): string {
  const template = language === 'zh' ? (zh[message] ?? message) : message;
  return template.replace(/\{(\d+)\}/g, (match, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : match,
  );
}
export function calibrationErrorText(message: string): string {
  const parkingOrientation =
    /^Shared parking needs the taught tool orientation\. The tool is off by ([\d.]+)° \(allowed ([\d.]+)°\)\. Align it at a confirmed safe position and retry\.$/.exec(
      message,
    );
  if (parkingOrientation)
    return t(
      'Shared parking needs the taught tool orientation. The tool is off by {0}° (allowed {1}°). Align it at a confirmed safe position and retry.',
      parkingOrientation.slice(1),
    );
  const unstableCorner =
    /^Fast calibration point (\d+) did not sustain touch within the safe depth/.exec(
      message,
    );
  if (unstableCorner)
    return (
      t(
        'Fast calibration point {0} did not sustain touch within the safe depth',
        [unstableCorner[1]],
      ) + message.slice(unstableCorner[0].length)
    );
  const missedCorner =
    /^No touch detected at fast calibration point (\d+) within the safe depth/.exec(
      message,
    );
  if (missedCorner)
    return (
      t(
        'No touch detected at fast calibration point {0} within the safe depth',
        [missedCorner[1]],
      ) + message.slice(missedCorner[0].length)
    );
  const boundary =
    /^Target crosses the taught camera-side boundary by ([\d.]+) mm$/.exec(
      message,
    );
  if (boundary)
    return t('The target exceeds the taught camera-side boundary by {0} mm.', [
      boundary[1],
    ]);
  const lostContact =
    /^(?:Refined press at Z|The refined press at Z) (-?[\d.]+) mm (?:did not maintain touch|did not produce a confirmed touch) after retry$/.exec(
      message,
    );
  if (lostContact)
    return t(
      'Contact was not sustained at height {0} mm after retry. Check the stylus and phone stability before retrying.',
      [lostContact[1]],
    );
  const floor =
    /^No page touch before the first-contact safety floor (-?[\d.]+) mm$/.exec(
      message,
    );
  if (floor)
    return t(
      'No touch was detected before the safety height {0} mm. Sampling stopped.',
      [floor[1]],
    );
  const inliers =
    /^Insufficient plane inliers: (\d+)\/(\d+) within 0.5 mm; (\d+) required$/.exec(
      message,
    );
  if (inliers)
    return t(
      'Plane validation failed: {0} of {1} samples agree within 0.5 mm; {2} are required.',
      inliers.slice(1),
    );
  const missedPosition =
    /^Refined press target Z (-?[\d.]+) mm was not reached \(actual (-?[\d.]+) mm\)$/.exec(
      message,
    );
  if (missedPosition)
    return t(
      'The robot did not reach the requested height ({0} mm; measured {1} mm). Check the robot status before retrying.',
      [missedPosition[1], missedPosition[2]],
    );
  const marker =
    /^Calibration marker (\d+) could not be decoded uniquely \((\d+) matches\)\.(?: Keep all calibration markers visible and in focus\.)?$/.exec(
      message,
    );
  if (!marker) return t(message);
  return t(
    'Calibration marker {0} could not be decoded uniquely ({1} matches).',
    [marker[1], marker[2]],
  );
}
export function CalibrationLanguageProvider({
  children,
}: {
  children: ReactNode;
}) {
  const language = useCalibrationLanguage((s) => s.language);
  return (
    <ConfigProvider locale={language === 'zh' ? zhCN : enUS}>
      {children}
    </ConfigProvider>
  );
}

export const useLanguage = () =>
  useCalibrationLanguage((state) => state.language);
