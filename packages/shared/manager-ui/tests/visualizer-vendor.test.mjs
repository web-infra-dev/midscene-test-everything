import assert from 'node:assert/strict';
import { afterAll, rstest, test } from '@rstest/core';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

afterAll(() => rstest.unstubAllGlobals());
const storage = new Map([
  ['midscene-env-config', 'MIDSCENE_MODEL_NAME=shared-model'],
]);
rstest.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
});
rstest.stubGlobal('window', {
  location: { search: '', href: 'http://localhost/' },
});
const history = await import('../src/vendor/visualizer/store/history');
const env = await import('../src/vendor/visualizer/store/store');
const translation = await import(
  '../src/vendor/visualizer/component/universal-playground/translation'
);

test('namespaces isolate history and last selected API, including persistence', () => {
  const a = history.getHistoryStore('a');
  const b = history.getHistoryStore('b');
  a.getState().addHistory({ type: 'aiAct', prompt: 'A', timestamp: 1 });
  b.getState().addHistory({ type: 'aiAct', prompt: 'B', timestamp: 2 });
  a.getState().setLastSelectedType('aiQuery');
  assert.equal(b.getState().lastSelectedType, 'aiAct');
  assert.equal(
    history.createHistoryStore('a').getState().getHistoryForType('aiAct')[0]
      .prompt,
    'A',
  );
  a.getState().clearHistory('aiAct');
  assert.equal(b.getState().getHistoryForType('aiAct')[0].prompt, 'B');
  assert.equal(history.getHistoryStore('b'), b);
});
test('omitting historyNamespace preserves shared legacy storage and history limits', () => {
  const shared = history.getHistoryStore();
  for (let i = 0; i < 12; i++)
    shared
      .getState()
      .addHistory({ type: 'aiAct', prompt: String(i), timestamp: i });
  shared.getState().addHistory({ type: 'aiAct', prompt: '11', timestamp: 20 });
  assert.equal(shared.getState().getHistoryForType('aiAct').length, 10);
  assert.equal(
    JSON.parse(storage.get('midscene-prompt-history-v2')).aiAct[0].timestamp,
    20,
  );
  assert.equal(history.getHistoryStore(), shared);
});
test('providers select the requested namespace and model settings remain globally shared', () => {
  const ReadHistory = () =>
    React.createElement(
      'span',
      null,
      history.useHistoryStore((s) => s.history.aiAct?.[0]?.prompt),
    );
  const render = (namespace) =>
    renderToStaticMarkup(
      React.createElement(
        history.PromptHistoryProvider,
        { namespace },
        React.createElement(ReadHistory),
      ),
    );
  history
    .createHistoryStore('render-b')
    .getState()
    .addHistory({ type: 'aiAct', prompt: 'B', timestamp: 1 });
  assert.equal(render('render-b'), '<span>B</span>');
  assert.equal(render('render-a'), '<span></span>');
  env.useEnvConfig.getState().loadConfig('MIDSCENE_MODEL_NAME=shared-model');
  const ReadModel = () =>
    React.createElement(
      'span',
      null,
      env.useEnvConfig((s) => s.config.MIDSCENE_MODEL_NAME),
    );
  for (const namespace of ['a', 'b'])
    assert.equal(
      renderToStaticMarkup(
        React.createElement(
          history.PromptHistoryProvider,
          { namespace },
          React.createElement(ReadModel),
        ),
      ),
      '<span>shared-model</span>',
    );
});
test('translation remains host supplied, with an English formatted fallback', () => {
  const Label = () =>
    React.createElement(
      'span',
      null,
      translation.usePlaygroundTranslation()('Run'),
    );
  assert.equal(
    renderToStaticMarkup(
      React.createElement(
        translation.PlaygroundTranslationContext.Provider,
        { value: () => '执行' },
        React.createElement(Label),
      ),
    ),
    '<span>执行</span>',
  );
  assert.equal(
    translation.defaultPlaygroundTranslate('Exporting {0}%', [50]),
    'Exporting 50%',
  );
});
