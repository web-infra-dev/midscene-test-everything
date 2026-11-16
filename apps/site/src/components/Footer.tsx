import { useI18n } from '../i18n/translations';

export function Footer() {
  const { t } = useI18n();

  return (
    <footer className="site-foot">
      <strong>{t.footer.title}</strong>
      <span className="mono">{t.footer.right}</span>
    </footer>
  );
}
