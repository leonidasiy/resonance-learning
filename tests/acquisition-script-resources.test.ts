import { sourceScriptUrls } from '../acquisition/renderer.ts';
import { ACQUISITION_POLICY } from '../worker/acquisition-policy.js';

Deno.test('Mac capture permits only source-declared public script URLs', () => {
  const scripts = sourceScriptUrls(`
    <script src="//ajax.googleapis.com/ajax/libs/jquery/1.11.3/jquery.min.js"></script>
    <script src="/js/fallacy.js?37"></script>
    <script src="http://private.example/script.js"></script>
    <img src="https://other.example/not-a-script.js">
  `, 'https://yourbias.is/confirmation-bias', ACQUISITION_POLICY);
  if (!scripts.has('https://ajax.googleapis.com/ajax/libs/jquery/1.11.3/jquery.min.js')) throw new Error('Declared public library was blocked.');
  if (!scripts.has('https://yourbias.is/js/fallacy.js?37')) throw new Error('Same-origin script was blocked.');
  if (scripts.has('http://private.example/script.js') || scripts.has('https://other.example/not-a-script.js')) throw new Error('Undeclared or insecure resource was allowed.');
});
