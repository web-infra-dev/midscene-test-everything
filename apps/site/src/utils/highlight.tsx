import type { ReactNode } from 'react';

export type HighlightLang = 'shell' | 'ts' | 'json' | 'toml';

const TS_KEYWORDS = new Set([
  'import',
  'from',
  'export',
  'const',
  'let',
  'async',
  'await',
  'new',
  'type',
  'class',
  'implements',
  'readonly',
  'return',
  'as',
  'true',
  'false',
]);

const SHELL_CMDS = new Set([
  'git',
  'clone',
  'cd',
  'pnpm',
  'npx',
  'claude',
  'curl',
  'install',
  'build',
  'start',
]);

function tokenizeLine(line: string, lang: HighlightLang): ReactNode[] {
  if (lang === 'shell') {
    const tokenRe =
      /(\s+|&&|\\|"[^"]*"|'[^']*'|https?:\/\/\S+|@[a-z0-9-]+\/[a-z0-9-]+(?:\/[a-z0-9-]+)?|--?[a-zA-Z0-9-]+|\b[a-zA-Z0-9_.-]+\b)/g;
    const out: ReactNode[] = [];
    let last = 0;
    let idx = 0;
    for (const m of line.matchAll(tokenRe)) {
      const matchIndex = m.index ?? 0;
      if (matchIndex > last) out.push(line.slice(last, matchIndex));
      const tok = m[0];
      if (
        tok.startsWith('"') ||
        tok.startsWith("'") ||
        tok.startsWith('http')
      ) {
        out.push(
          <span key={idx++} className="hl-str">
            {tok}
          </span>,
        );
      } else if (tok.startsWith('@')) {
        out.push(
          <span key={idx++} className="hl-pkg">
            {tok}
          </span>,
        );
      } else if (tok.startsWith('-')) {
        out.push(
          <span key={idx++} className="hl-flag">
            {tok}
          </span>,
        );
      } else if (tok === '&&' || tok === '\\') {
        out.push(
          <span key={idx++} className="hl-op">
            {tok}
          </span>,
        );
      } else if (SHELL_CMDS.has(tok)) {
        out.push(
          <span key={idx++} className="hl-kw">
            {tok}
          </span>,
        );
      } else {
        out.push(tok);
      }
      last = matchIndex + tok.length;
    }
    if (last < line.length) out.push(line.slice(last));
    return out;
  }

  if (lang === 'toml') {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      return [
        <span key="sec" className="hl-kw">
          {line}
        </span>,
      ];
    }
    const tokenRe = /("[^"]*"|\b(?:command|args|env)\b|[A-Z0-9_]+(?=\s*=))/g;
    const out: ReactNode[] = [];
    let last = 0;
    let idx = 0;
    for (const m of line.matchAll(tokenRe)) {
      const matchIndex = m.index ?? 0;
      if (matchIndex > last) out.push(line.slice(last, matchIndex));
      const tok = m[0];
      const cls = tok.startsWith('"') ? 'hl-str' : 'hl-fn';
      out.push(
        <span key={idx++} className={cls}>
          {tok}
        </span>,
      );
      last = matchIndex + tok.length;
    }
    if (last < line.length) out.push(line.slice(last));
    return out;
  }

  const tokenRe =
    /(\/\/.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*(?=\s*\()|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let idx = 0;
  for (const m of line.matchAll(tokenRe)) {
    const matchIndex = m.index ?? 0;
    if (matchIndex > last) out.push(line.slice(last, matchIndex));
    const tok = m[0];
    const nextPos = matchIndex + tok.length;
    if (tok.startsWith('//') || tok.startsWith('/*')) {
      out.push(
        <span key={idx++} className="hl-cmt">
          {tok}
        </span>,
      );
    } else if (tok.startsWith('"') || tok.startsWith("'")) {
      const isJsonKey =
        lang === 'json' && line.slice(nextPos).trimStart().startsWith(':');
      out.push(
        <span key={idx++} className={isJsonKey ? 'hl-fn' : 'hl-str'}>
          {tok}
        </span>,
      );
    } else if (/^\d/.test(tok)) {
      out.push(
        <span key={idx++} className="hl-num">
          {tok}
        </span>,
      );
    } else if (TS_KEYWORDS.has(tok)) {
      out.push(
        <span key={idx++} className="hl-kw">
          {tok}
        </span>,
      );
    } else if (line[nextPos] === '(') {
      out.push(
        <span key={idx++} className="hl-fn">
          {tok}
        </span>,
      );
    } else {
      out.push(tok);
    }
    last = nextPos;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export function HighlightCode({
  code,
  lang,
}: {
  code: string;
  lang: HighlightLang;
}) {
  const lines = code.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <span key={`${i}-${line.slice(0, 12)}`}>
          {tokenizeLine(line, lang)}
          {i < lines.length - 1 ? '\n' : null}
        </span>
      ))}
    </>
  );
}

export function HighlightShellLines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line) => (
        <span key={line} className="term-line">
          <span className="term-prompt">$</span>
          <span>{tokenizeLine(line, 'shell')}</span>
        </span>
      ))}
    </>
  );
}
