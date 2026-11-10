import { routeWorkflowBrowser } from '../worker/knowledge-workflow-browser-routing.js';

Deno.test('exhausted browser credits keep page capture on the Mac without interactive navigation', async () => {
  /** @type {string[]} */
  const calls = [];
  const acquisition = {
    readPage: async () => { calls.push('mac-page'); return { ok: true }; },
    readRobots: async () => ({ ok: true }),
    screenshot: async () => ({ ok: true }),
    close: async () => { calls.push('mac-close'); return { ok: true }; },
  };
  const interactive = {
    inspect: async () => { calls.push('interactive-inspect'); return { ok: true }; },
    click: async () => ({ ok: true }),
    screenshot: async () => ({ ok: true }),
    close: async () => { calls.push('interactive-close'); return { ok: true }; },
  };
  const exhausted = routeWorkflowBrowser(/** @type {any} */(acquisition), /** @type {any} */(interactive), false);
  if ('inspect' in exhausted || 'click' in exhausted) throw new Error('Exhausted route still permits paid navigation.');
  await exhausted.readPage({ url: 'https://source.example/', rootUrl: 'https://source.example/' });
  await exhausted.close();
  if (calls.join(',') !== 'mac-page,mac-close') throw new Error(`Unexpected exhausted route: ${calls}`);

  calls.length = 0;
  const available = routeWorkflowBrowser(/** @type {any} */(acquisition), /** @type {any} */(interactive), true);
  await available.readPage({ url: 'https://source.example/', rootUrl: 'https://source.example/' });
  if (!('inspect' in available)) throw new Error('Interactive navigation was unavailable with credits.');
  await available.inspect({ url: 'https://source.example/', rootUrl: 'https://source.example/' });
  await available.close();
  if (calls.join(',') !== 'mac-page,interactive-inspect,interactive-close') throw new Error(`Unexpected available route: ${calls}`);
});
