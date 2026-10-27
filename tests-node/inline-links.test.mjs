import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isInlineLinks,inlineLinkSpans} from '../src/features/knowledge-workflows/inline-links.js';
const link=(text,url='https://example.test/term')=>({text,url});
test('source link boundary rejects unsafe, credentialed, invented labels and malformed metadata',()=>{
 for(const invalid of [null,{},[link('')],[link('term','javascript:alert(1)')],[link('term','data:text/html,hi')],[link('term','https://user:secret@example.test/')],[link('absent')],[{...link('term'),extra:1}]])assert.equal(isInlineLinks(invalid,'A term.'),false);
 assert(isInlineLinks([link('term')],'A term.'));
 assert(isInlineLinks([link('term','http://example.test/')],'A term.'));
});
test('literal reused labels keep punctuation, repetitions and overlapping link text without linking substrings or paraphrases',()=>{
 const summary='A chord and chord progression use notes; chordal is a different word.';
 assert.deepEqual(inlineLinkSpans(summary,[link('chord'),link('chord progression','https://example.test/progression'),link('chord')]),[{start:2,end:7,url:'https://example.test/term'},{start:12,end:29,url:'https://example.test/progression'}]);
 assert.deepEqual(inlineLinkSpans('A harmony uses notes.',[link('chord')]),[]);
 assert.equal(inlineLinkSpans('和弦由音符组成。',[link('和弦')]).length,1);
 assert.deepEqual(inlineLinkSpans('term',[link('term'),link('term','https://example.test/other')]),[]);
});

test('webpage fact extraction derives immutable links from captured blocks, without model-authored destinations',async()=>{
 const {requestWebpageFacts,quoteHash}=await import('../worker/webpage-facts.js');
 const {isKnowledgeCandidate}=await import('../src/features/knowledge-workflows/extraction.js');
 const text='A chord combines notes.',links=[link('chord')];
 const evidence={url:'https://example.test/',blocks:[{id:'p',locator:'p',sectionId:'s',kind:'text',text,inlineLinks:links,figureId:null}],headings:[],images:[],warnings:[]};
 const result=await requestWebpageFacts({taskId:'offline-links',input:{url:evidence.url,evidence,coverageGoals:[]},maxOutputTokens:4096,logger:()=>{},generate:async command=>{
  if(command.phase==='extraction'){
   links[0].url='https://invented.example.test/';
   return {ok:true,value:{notes:'',candidates:[{summary:text,normalizedHash:'chord',coverageGoalIds:[],mediaCandidates:[],evidenceAnchors:[{reference:command.input.citationSources[0].reference,clause:text}]}]}};
  }
  return {ok:true,value:{verdicts:[{normalizedHash:'chord',grounded:true}]}};
 }});
 assert(result.ok); const candidate=result.value.candidates[0];assert(isKnowledgeCandidate(candidate));
 assert.equal(candidate.evidenceAnchors[0].quote,text);
 assert.equal(candidate.evidenceAnchors[0].quoteDigest,await quoteHash(text));
 assert.deepEqual(candidate.evidenceAnchors[0].inlineLinks,[link('chord')]);
 assert(Object.isFrozen(candidate.evidenceAnchors[0].inlineLinks[0]));
 assert(!isKnowledgeCandidate({...candidate,evidenceAnchors:[{...candidate.evidenceAnchors[0],inlineLinks:[link('chord','javascript:alert(1)')]}]}));
});
