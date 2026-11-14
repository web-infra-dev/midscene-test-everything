import { useI18n } from '../i18n/translations';

export function ProtocolSection() {
  const { t } = useI18n();

  return (
    <section className="section-block" id="architecture">
      <p className="eyebrow">
        <i />
        {t.protocol.eyebrow}
      </p>
      <h2>{t.protocol.heading}</h2>
      <p className="lede">{t.protocol.lede}</p>

      <div className="proto-grid">
        <div className="proto-endpoints">
          {t.protocol.endpoints.map((ep) => (
            <div className="proto-row" key={ep.path}>
              <div className="proto-row-head">
                <span className="proto-idx mono">{ep.idx}</span>
                <code className="proto-path">{ep.path}</code>
              </div>
              <p>{ep.desc}</p>
            </div>
          ))}
        </div>

        <aside className="proto-aside">
          <div className="proto-flow mono">
            {t.protocol.flowNodes.map((node, i) => (
              <span
                key={node}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <span>{node}</span>
                {i < t.protocol.flowNodes.length - 1 && (
                  <span className="proto-arrow">→</span>
                )}
              </span>
            ))}
          </div>

          <div className="proto-adapters">
            {t.protocol.adapters.map((ad) => (
              <article className="proto-adapter" key={ad.badge}>
                <span className="proto-badge mono">{ad.badge}</span>
                <h3>{ad.title}</h3>
                <p>{ad.desc}</p>
              </article>
            ))}
          </div>

          <p className="proto-note mono">{t.protocol.note}</p>
        </aside>
      </div>
    </section>
  );
}
