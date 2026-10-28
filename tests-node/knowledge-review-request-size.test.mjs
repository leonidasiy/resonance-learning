import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenRouterKnowledgeModel} from '../worker/knowledge-workflow-model.js';
import {knowledgeReviewAuditInput,knowledgeReviewSchemaFor,knowledgeReviewHistoryInput,knowledgeReviewQuotedSchemaFor} from '../src/features/knowledge-workflows/quality-review.js';

const point={summary:'A closed valve prevents flow.',evidenceAnchors:[{quote:'A closed valve prevents flow.',url:'https://example.test',selector:'main'}]};
function fixture(count=47) {
 const context={lessOften:[],previousKnowledge:Array.from({length:count},(_,i)=>({id:'knowledge:source:example:3:retained-supported-relationship-'+i,summary:'Synthetic prior relationship '+i+'.'})),previousQuizzes:Array.from({length:count?36:0},(_,i)=>({prompt:'Synthetic question '+i,answer:'Synthetic answer',explanation:'Synthetic explanation'}))};
 const input={knowledge:point,...context,auditEvidence:knowledgeReviewAuditInput(point,context,{})};
 return {input,responseSchema:knowledgeReviewSchemaFor(context,input.auditEvidence,['image:one'])};
}
async function request(command,protocol) {
 let body;const logs=[];
 const model=createOpenRouterKnowledgeModel({apiKey:'synthetic',endpoint:'https://example.test/model',model:'xiaomi/mimo-v2.6-pro',timeoutMs:1000,maximumInputCharacters:3000000,now:Date.now,logger:entry=>logs.push(entry),protocol,fetch:async(_url,init)=>{
  body=JSON.parse(init.body);return Response.json({id:'synthetic-receipt',choices:[{finish_reason:'stop',message:{content:'{"unchanged":true}'}}],usage:{prompt_tokens:12,completion_tokens:3,cost:0.00001}});
 }});
 const result=await model.generate({role:'question-evaluator',systemPrompt:'Synthetic review contract.',maxOutputTokens:4096,...command});
 assert.equal(result.ok,true);assert.deepEqual(result.value.output,{unchanged:true});
 return {body,logs};
}

// Only the existing review schema's keywords are supported; new keywords fail this check.
function matches(schema,value) {
 const known=new Set(['type','anyOf','properties','required','additionalProperties','items','minItems','maxItems','minLength','maxLength','minimum','maximum','enum']);
 for(const key of Object.keys(schema))assert(known.has(key),`Unsupported schema keyword: ${key}`);
 if(schema.anyOf&&!schema.anyOf.some(branch=>matches(branch,value)))return false;
 if(schema.type&&!(schema.type==='null'?value===null:schema.type==='array'?Array.isArray(value):schema.type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):schema.type==='integer'?Number.isInteger(value):typeof value===schema.type))return false;
 if(schema.enum&&!schema.enum.includes(value))return false;
 if(typeof value==='number'&&(value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))return false;
 if(typeof value==='string'&&(value.length<(schema.minLength??0)||value.length>(schema.maxLength??Infinity)))return false;
 if(Array.isArray(value)&&(value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity)||schema.items&&!value.every(item=>matches(schema.items,item))))return false;
 if(value!==null&&typeof value==='object'&&!Array.isArray(value)){
  if(schema.required?.some(key=>!Object.hasOwn(value,key)))return false;
  if(schema.additionalProperties===false&&Object.keys(value).some(key=>!Object.hasOwn(schema.properties,key)))return false;
  if(schema.properties&&Object.entries(value).some(([key,item])=>schema.properties[key]&&!matches(schema.properties[key],item)))return false;
 }
 return true;
}

test('actual reviewer transport removes repeated prior schemas without changing input or limits',async()=>{
 const command=fixture(),before=structuredClone(command),{body}=await request(command);
 const legacy=structuredClone(command.responseSchema),prior=legacy.schema.properties.audit.properties.clauses.items.properties.previousEvidence.items;
 delete prior.properties.start.maximum;delete prior.properties.end.maximum;
 prior.anyOf=command.input.auditEvidence.previousContent.map(entry=>({type:'object',additionalProperties:false,required:['priorId','start','end'],properties:{priorId:{type:'string',enum:[entry.id]},start:{type:'integer',minimum:0,maximum:entry.tokens.length-1},end:{type:'integer',minimum:1,maximum:entry.tokens.length}}}));
 const oldRequest=await request({...command,responseSchema:legacy});
 const original=JSON.stringify(oldRequest.body.response_format.json_schema.schema),compact=JSON.stringify(body.response_format.json_schema.schema);
 assert(compact.length<original.length*.65,`Expected at least 35% schema reduction; ${compact.length}/${original.length}`);
 assert.deepEqual(command,before);
 assert.deepEqual(JSON.parse(body.messages[1].content.slice('<task_input>\n'.length,-'\n</task_input>'.length)),command.input);
 assert.equal(body.max_tokens,4096);assert.equal(body.model,'xiaomi/mimo-v2.6-pro');assert.equal(body.response_format.json_schema.strict,true);
 assert.deepEqual(body.provider,{require_parameters:true,allow_fallbacks:true});
});

test('factored source, prior and image citations accept and reject the same boundary cases',async()=>{
 for(const count of [0,2]){
  const command=fixture(count),{body}=await request(command),original=command.responseSchema.schema,compact=body.response_format.json_schema.schema;
  const originalEvidence=original.properties.audit.properties.finalClause.anyOf[0].properties,compactEvidence=compact.properties.audit.properties.finalClause.anyOf[0].properties;
  for(const [key,idKey,entries] of [['textEvidence','anchorIndex',command.input.auditEvidence.retainedText],['previousEvidence','priorId',command.input.auditEvidence.previousContent]]){
   const cases=[null,{},[{[idKey]:'foreign',start:0,end:1}]];
   for(const entry of entries){
    const id=entry.id??entry.anchorIndex,length=entry.tokens.length;
    for(const start of [-1,0,length-1,length,0.5])for(const end of [0,1,length,length+1])cases.push([{[idKey]:id,start,end}]);
    cases.push([{[idKey]:id,start:0,end:1,extra:true}],[{[idKey]:id,end:1}],[{[idKey]:id,start:'0',end:1}]);
    assert(matches(compactEvidence[key],[{[idKey]:id,start:0,end:1}]));
    const maximum=key==='previousEvidence'?Math.max(...entries.map(entry=>entry.tokens.length)):length;
    assert(!matches(compactEvidence[key],[{[idKey]:id,start:0,end:maximum+1}]));
   }
   for(const value of cases)assert.equal(matches(compactEvidence[key],value),matches(originalEvidence[key],value),JSON.stringify({key,value}));
  }
  const pixels=[[],[{imageId:'image:one',cue:'Visible valve.'}],[{imageId:'foreign',cue:'Visible valve.'}],[{imageId:'image:one',cue:''}],[{imageId:'image:one',cue:'Visible valve.',extra:true}]];
  for(const value of pixels)assert.equal(matches(compactEvidence.pixelEvidence,value),matches(originalEvidence.pixelEvidence,value));
  for(const priorAnswer of [null,'','Prior answer'])for(const priorEvidence of [[],[{priorId:'foreign',start:0,end:1}],[{priorId:'knowledge:'+command.input.previousKnowledge[0]?.id,start:0,end:1}]]){
   const value={question:'Question?',answer:'Answer',priorAnswer,priorEvidence,reason:'Comparison.'};
   assert.equal(matches(compact.properties.retrievalComparison,value),matches(original.properties.retrievalComparison,value));
  }
  assert.equal(matches(compactEvidence.previousEvidence,[{priorId:'foreign',start:0,end:1}]),false);
 }
});

test('strict output sends the schema once while JSON object mode retains the complete schema appendix',async()=>{
 const command=fixture(2);
 for(const responseFormat of ['json_schema','json_object']){
  const protocol={source:'synthetic',responseFormat,provider:{require_parameters:true,allow_fallbacks:true},receiptOptional:true};
  const {body}=await request(command,protocol);
  assert.equal(body.response_format.type,responseFormat);
  if(responseFormat==='json_schema')assert(!body.messages[0].content.includes('Required full local JSON schema'));
  else {
   const appendix=body.messages[0].content.split('constraints: ')[1].split('\nReturn only one JSON object.')[0];
   assert(JSON.parse(appendix).properties.audit);
   assert(appendix.length<JSON.stringify(command.responseSchema.schema).length);
  }
 }
});

test('other response schemas retain their exact transport contract',async()=>{
 const responseSchema={name:'synthetic',schema:{type:'object',properties:{valid:{type:'boolean'}},required:['valid'],additionalProperties:false}};
 const {body}=await request({input:{},responseSchema});
 assert.deepEqual(body.response_format.json_schema,{...responseSchema,strict:true});
});

test('fresh reviewer wire retains complete readable history and strict quoted citations',async()=>{
 const context={lessOften:[],previousKnowledge:[{id:'prior',summary:'The original supported relationship.'}],previousQuizzes:[{prompt:'What is supported?',answer:'The original relationship.',explanation:'Complete retained explanation.'}]};
 const audit=knowledgeReviewAuditInput(point,context,{}),input={knowledge:point,lessOften:context.lessOften,auditEvidence:knowledgeReviewHistoryInput(audit,context)};
 const {body}=await request({input,responseSchema:knowledgeReviewQuotedSchemaFor(context,audit,[])});
 const wire=JSON.parse(body.messages[1].content.slice('<task_input>\n'.length,-'\n</task_input>'.length));
 assert.deepEqual(wire,input);assert.equal(wire.auditEvidence.previousContent[1].text,JSON.stringify(context.previousQuizzes[0]));
 assert.equal(body.response_format.json_schema.name,'knowledge_quality_review_v13');
 const citation=body.response_format.json_schema.schema.properties.audit.properties.finalClause.anyOf[0].properties.previousEvidence.items;
 assert.deepEqual(citation.required,['priorId','quote']);assert.deepEqual(citation.properties.priorId.enum,['knowledge:prior','quiz:0']);
 assert.equal(body.messages[0].content.includes('Required full local JSON schema'),false);
});
