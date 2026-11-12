import type { ReactNode } from 'react';

/** Keep safety actions in the dialog header, outside its scrolling content. */
export function RobotDialogTitle({
  title,
  safetyControls,
}: {
  title: ReactNode;
  safetyControls?: ReactNode;
}) {
  return (
    <div className="robot-dialog-title">
      <span className="robot-dialog-title-label">{title}</span>
      {safetyControls}
    </div>
  );
}
