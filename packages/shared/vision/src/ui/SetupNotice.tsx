import { Alert } from 'antd';
import type { ReactNode } from 'react';

export type SetupNoticeTone = 'error' | 'warning' | 'info' | 'success';

export interface SetupNoticeData {
  tone: SetupNoticeTone;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function SetupNotice({
  notice,
  className,
}: {
  notice?: SetupNoticeData;
  className?: string;
}) {
  if (!notice) return null;
  return (
    <div className="robot-setup-notice" data-setup-notice>
      <Alert
        className={className}
        type={notice.tone}
        showIcon
        role={notice.tone === 'error' ? 'alert' : 'status'}
        message={notice.title}
        description={notice.description}
        action={notice.action}
      />
    </div>
  );
}
