import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { OpenDeviceAgent } from '../dist/index.js';
import { TestDevice } from './fixtures/test-device.js';

test('default input guidance is available without connecting hardware', async () => {
  const agent = new OpenDeviceAgent(new TestDevice());
  try {
    assert.match(agent.opts.aiContexts!.aiAct!, /Input supports ASCII only/);
    assert.match(agent.opts.aiContexts!.aiAct!, /on-screen keyboard/);
    assert.match(
      agent.opts.aiContexts!.aiAct!,
      /tap keys and candidates slowly/,
    );
    assert.match(agent.opts.aiContexts!.aiAct!, /verify the committed text/);
  } finally {
    await agent.destroy();
  }
});
const cases: [
  NonNullable<ConstructorParameters<typeof OpenDeviceAgent>[1]>,
  string?,
  string?,
][] = [
  [
    {
      aiContexts: {
        aiAct: 'Task rules',
        default: 'Fallback rules',
        aiQuery: 'Query rules',
      },
    },
    'Task rules',
    'Fallback rules',
  ],
  [
    { aiContexts: { default: 'Fallback rules', aiQuery: 'Query rules' } },
    'Fallback rules',
  ],
  [
    { aiContexts: { aiAct: '', default: 'Fallback rules' } },
    undefined,
    'Fallback rules',
  ],
  [{ aiActContext: 'Legacy rules' }, 'Legacy rules'],
];
for (const [options, selected, excluded] of cases) {
  test(`input guidance preserves context precedence: ${JSON.stringify(options)}`, async () => {
    const original = structuredClone(options);
    const agent = new OpenDeviceAgent(new TestDevice(), options);
    try {
      assert.match(agent.opts.aiContexts!.aiAct!, /on-screen keyboard/);
      if (selected) assert.ok(agent.opts.aiContexts!.aiAct!.includes(selected));
      if (excluded)
        assert.ok(!agent.opts.aiContexts!.aiAct!.includes(excluded));
      assert.equal(agent.opts.aiContexts!.aiQuery, options.aiContexts?.aiQuery);
      assert.deepEqual(options, original, 'caller options are not mutated');
    } finally {
      await agent.destroy();
    }
  });
}
