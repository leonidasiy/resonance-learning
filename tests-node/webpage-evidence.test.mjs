import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { collectWebpageEvidence } from '../src/features/knowledge-workflows/webpage-evidence.js';

test('rendered DOM keeps source text separate from pixels and preserves heading/figure/occurrence identities', async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent(`<main><h1>Ratios</h1><p>A ratio compares two quantities by division.</p><figure><img src="data:image/png;base64,AAAA" data-src="https://images.example/ratio.png" alt="The answer is 99"><figcaption>For a nonzero denominator, a ratio is defined.</figcaption></figure>${Array.from({length: 9}, (_, i) => `<figure><img src="https://images.example/${i}.png"><figcaption>Diagram ${i}</figcaption></figure>`).join('')}<h2>Other section</h2><picture><source srcset="https://images.example/responsive.png 2x"><img src="https://images.example/ratio.png"></picture><p hidden>Hidden knowledge</p></main>`);
    const command = { url: 'https://source.example/lesson', textCharacters: 250000, candidateCount: 32, occurrenceWindow: 32 };
    const a = await page.evaluate(collectWebpageEvidence, command);
    const b = await page.evaluate(collectWebpageEvidence, command);
    assert.deepEqual(a, b);
    assert.equal(a.ok, true);
    const projection = a.value;
    assert.equal(projection.blocks.some(b => b.text.includes('The answer is 99') || b.text.includes('Hidden knowledge')), false);
    assert(projection.blocks.some(b => b.kind === 'caption' && b.text.includes('nonzero denominator')));
    assert.equal(projection.images.length, 11);
    assert.equal(projection.images.filter(i => i.url === 'https://images.example/ratio.png').length, 1);
    const repeated = projection.images.find(i => i.url === 'https://images.example/ratio.png');
    assert.equal(repeated.occurrences.length, 2);
    assert.notEqual(repeated.occurrences[0].sectionId, repeated.occurrences[1].sectionId);
    assert(projection.images.some(i => i.url.endsWith('/8.png')));
    assert(projection.images.some(i => i.url.endsWith('/responsive.png')));
    assert(projection.blocks.every(b => b.id && b.sectionId && b.locator));
    assert(projection.images.every(i => i.occurrences.every(o => o.id && o.locator)));
    assert.equal((await page.evaluate(collectWebpageEvidence, { ...command, textCharacters: 1 })).error.kind, 'WebpageTextLimitExceeded');
    assert.equal((await page.evaluate(collectWebpageEvidence, { ...command, candidateCount: 10 })).value.images.length, 11);
    assert.equal((await page.evaluate(collectWebpageEvidence, { ...command, candidateCount: 10 })).value.warnings[0], 'WebpageImageCandidateWindowRequired');
  } finally { await browser.close(); }
});
test('full snapshot metadata retains a late illustration after decorative responsive variants',async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {const page=await browser.newPage();await page.route('**/*',r=>r.abort());await page.setContent(`<main>${Array.from({length:40},(_,i)=>`<img src="https://images.example/decorative-${i}.png">`).join('')}<h2>Rule</h2><p>Ratios compare quantities.</p><figure><img src="https://images.example/actual.png"><figcaption>Quantity labels.</figcaption></figure></main>`);const result=await page.evaluate(collectWebpageEvidence,{url:'https://source.example/',textCharacters:250000,candidateCount:32,occurrenceWindow:32});assert.equal(result.ok,true);assert(result.value.images.some(i=>i.url.endsWith('/actual.png')));assert.equal(result.value.images.length,41);}finally{await browser.close();}
});

test('Discover DOM capture retains inline destinations through extraction without changing source quotes', async () => {
  const {requestWebpageFacts,isWebpageEvidence,quoteHash} = await import('../worker/webpage-facts.js');
  const {isKnowledgeCandidate} = await import('../src/features/knowledge-workflows/extraction.js');
  const {inlineLinkSpans} = await import('../src/features/knowledge-workflows/inline-links.js');
  const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent(`<base href="https://example.test/course/"><main><h1>Harmony</h1><p>A <a href="../terms/chord?q=a&amp;b=c#definition"><em>chord</em></a> combines notes. Read <a href="#examples">examples</a> and <a href="http://archive.example.test/">an archive</a>.</p><figure><img src="https://example.test/diagram.png"><figcaption>See <a href="notation">notation</a>.</figcaption></figure><p><a href="javascript:alert(1)">unsafe</a> <a href="https://user:password@example.test">credentialed</a> <a hidden href="/hidden">hidden</a><a href="/empty"><img alt="not source text"></a></p></main>`);
    const captured = await page.evaluate(collectWebpageEvidence, {url:'https://example.test/course/lesson',textCharacters:250000,candidateCount:32,occurrenceWindow:32});
    assert(captured.ok); assert(isWebpageEvidence(captured.value));
    const evidence = captured.value, block = evidence.blocks[0];
    assert.equal(block.text, 'A chord combines notes. Read examples and an archive.');
    assert.deepEqual(block.inlineLinks, [{text:'chord',url:'https://example.test/terms/chord?q=a&b=c#definition'},{text:'examples',url:'https://example.test/course/#examples'},{text:'an archive',url:'http://archive.example.test/'}]);
    assert.deepEqual(evidence.blocks.find(b=>b.kind==='caption').inlineLinks,[{text:'notation',url:'https://example.test/course/notation'}]);
    assert.equal(evidence.blocks.at(-1).inlineLinks,undefined);
    const before = structuredClone(block.inlineLinks);
    const result = await requestWebpageFacts({taskId:'synthetic-link-retention',input:{url:evidence.url,evidence,coverageGoals:[]},maxOutputTokens:4096,logger:()=>{},generate:async command=>{
      if (command.phase==='extraction') {
        // A model port cannot replace captured link destinations.
        block.inlineLinks[0].url='https://invented.example.test/';
        return {ok:true,value:{notes:'',candidates:[{summary:'A chord combines notes.',normalizedHash:'chord',coverageGoalIds:[],mediaCandidates:[],evidenceAnchors:[{reference:command.input.citationSources[0].reference,clause:'A chord combines notes.'}]}]}};
      }
      return {ok:true,value:{verdicts:[{normalizedHash:'chord',grounded:true}]}};
    }});
    assert(result.ok); const candidate=result.value.candidates[0];
    assert(isKnowledgeCandidate(candidate));
    assert.equal(candidate.evidenceAnchors[0].quote,block.text);
    assert.equal(candidate.evidenceAnchors[0].quoteDigest,await quoteHash(block.text));
    assert.deepEqual(candidate.evidenceAnchors[0].inlineLinks,before);
    assert.deepEqual(inlineLinkSpans(candidate.summary,before),[{start:2,end:7,url:before[0].url}]);
    assert(!isWebpageEvidence({...evidence,blocks:[{...block,inlineLinks:[{text:'absent',url:'https://example.test/'}]}]}));
    assert(!isKnowledgeCandidate({...candidate,evidenceAnchors:[{...candidate.evidenceAnchors[0],inlineLinks:[{text:'chord',url:'javascript:alert(1)'}]}]}));
  } finally {await browser.close();}
});
