import type { ReactNode } from 'react';
export function ScreenMappingView({
  live,
  corrected,
  size,
  actions,
  t,
}: {
  live?: ReactNode;
  corrected?: ReactNode;
  size?: { width: number; height: number };
  actions?: ReactNode;
  t: (message: string) => string;
}) {
  return (
    <div className="screen-range-card">
      <section>
        <header>
          <strong>{t('Live Preview')}</strong>
          <div className="range-actions">{actions}</div>
        </header>
        <div className="screen-range-stage">{live}</div>
      </section>
      <section>
        <header>
          <strong>{t('Corrected View')}</strong>
          {size && (
            <small>
              {size.width} × {size.height} px
            </small>
          )}
        </header>
        <div className="screen-range-stage">{corrected}</div>
      </section>
    </div>
  );
}
