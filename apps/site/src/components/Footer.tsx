import { useI18n } from '../i18n/translations';

export function Footer() {
  const { t } = useI18n();

  return (
    <footer className="site-foot">
      <div>
        <strong>{t.footer.title}</strong>
        <p>{t.footer.subtitle}</p>
      </div>
      <span className="mono">{t.footer.right}</span>
    </footer>
  );
}
