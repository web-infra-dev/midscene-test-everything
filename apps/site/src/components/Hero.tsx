import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/translations';
import { ProtocolDiagram } from './ProtocolSection';

export function Hero() {
  const { t } = useI18n();
  const words = t.hero.typeWords;
  const [text, setText] = useState(words[0]);

  useEffect(() => {
    let wi = 0;
    let ci = words[0].length;
    let deleting = false;
    let timer = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const word = words[wi];
      if (!deleting) {
        ci += 1;
        setText(word.slice(0, ci));
        if (ci >= word.length) {
          deleting = true;
          timer = window.setTimeout(tick, 1800);
          return;
        }
        timer = window.setTimeout(tick, 75);
      } else {
        ci -= 1;
        setText(word.slice(0, ci));
        if (ci <= 0) {
          deleting = false;
          wi = (wi + 1) % words.length;
          timer = window.setTimeout(tick, 280);
          return;
        }
        timer = window.setTimeout(tick, 42);
      }
    };

    timer = window.setTimeout(() => {
      deleting = true;
      tick();
    }, 1800);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [words]);

  return (
    <section className="hero hero-centered" id="top">
      <div className="backed-pill">
        <span>{t.hero.backedBy}</span>
        <img src="./assets/midscene-logo.png" alt="Midscene" />
        <strong>Midscene.js</strong>
      </div>
      <h1>
        {t.hero.headlineLine1}
        <br />
        <span className="hero-accent">
          {t.hero.headlineLine2Prefix}
          <span>{text}</span>
          <span className="type-caret" aria-hidden="true" />
        </span>
      </h1>
      <p className="lede">{t.hero.lede}</p>
      <div className="hero-cta">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            document
              .getElementById('quickstart')
              ?.scrollIntoView({ behavior: 'smooth' })
          }
        >
          {t.hero.ctaPrimary}
        </button>
        <a
          className="btn btn-ghost"
          href="https://github.com/web-infra-dev/midscene"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t.hero.ctaGithub}
        </a>
      </div>
      <div className="hero-tags mono">
        {t.hero.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <ProtocolDiagram />
    </section>
  );
}
