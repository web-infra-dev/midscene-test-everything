import type { CalibrationPhoneStatus } from '@midscene/robotics-shared/assisted-contracts';
import { t } from '../../i18n';

const names = {
  touchstart: 'Raw touch start',
  touchend: 'Raw touch end',
  touchcancel: 'Raw touch cancelled',
  pointerdown: 'Touch down',
  pointerup: 'Touch released',
  pointercancel: 'Touch cancelled by browser',
  lostpointercapture: 'Pointer capture ended',
  'target-reset': 'Sampling target reset',
  'step-feedback': 'Phone sampling reply',
};
export function TouchDiagnostics({ phone }: { phone: CalibrationPhoneStatus }) {
  const d = phone.diagnostics;
  const last = d?.events
    .slice()
    .reverse()
    .find((e) => e.kind === 'pointerdown' || e.kind === 'touchstart');
  return (
    <details className="robot-touch-diagnostics">
      <summary>{t('Phone touch diagnostics')}</summary>
      <p>
        {t(
          d?.version === 2
            ? 'Document Touch / Pointer capture enabled'
            : 'Refresh the phone page to enable document Touch / Pointer diagnostics',
        )}
      </p>
      <p>
        {d
          ? t('Computer received phone update {0} at {1}', [
              d.updateSequence,
              new Date(d.receivedAt).toLocaleTimeString(),
            ])
          : t('Waiting for phone diagnostics')}
      </p>
      <p>
        {last?.point
          ? t('Last touch received: {0}, {1}', [
              Math.round(last.point.x),
              Math.round(last.point.y),
            ])
          : t('No touch-down event in the recent history')}
      </p>
      <p>
        {t(
          'These events confirm browser input and delivery, not successful calibration. Only the last 40 events from this page are retained.',
        )}
      </p>
      {d && (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>{t('Event')}</th>
                <th>{t('Page time (ms)')}</th>
                <th>{t('Target / step')}</th>
                <th>{t('Feedback')}</th>
                <th>{t('Event source / element')}</th>
                <th>{t('Default prevented: before / after')}</th>
              </tr>
            </thead>
            <tbody>
              {d.events
                .slice()
                .reverse()
                .map((e) => (
                  <tr key={e.sequence}>
                    <td>
                      {e.sequence} · {t(names[e.kind])}
                    </td>
                    <td>{Math.round(e.elapsedMs)}</td>
                    <td>
                      {e.targetId?.slice(0, 8) ?? '—'} /{' '}
                      {e.stepId?.slice(0, 8) ?? '—'}
                    </td>
                    <td>
                      {e.point
                        ? `${Math.round(e.point.x)}, ${Math.round(e.point.y)}`
                        : e.detail
                          ? t(e.detail)
                          : '—'}
                    </td>
                    <td>
                      {e.source
                        ? t(
                            e.source === 'document'
                              ? 'Document capture'
                              : 'Surface handler',
                          )
                        : '—'}
                      <br />
                      {e.targetElement ?? ''}
                    </td>
                    <td>
                      {e.defaultPrevented === undefined
                        ? '—'
                        : t(e.defaultPrevented ? 'Yes' : 'No')}{' '}
                      /{' '}
                      {e.defaultPreventedAfterDispatch === undefined
                        ? '—'
                        : t(e.defaultPreventedAfterDispatch ? 'Yes' : 'No')}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
