import test from 'node:test';
import assert from 'node:assert/strict';
import { avoidanceClassificationCommand, parseAvoidanceClassification, knowledgeAvoidanceInstruction } from '../worker/knowledge-avoidance.js';

test('subject decision validates all uncategorized examples and injects only the matching subject',()=>{
  const examples=[{deletionId:'music',mainSubject:'music',summary:'A dance entry.',reason:'Avoid bare catalogue entries.'},{deletionId:'physics',mainSubject:'physics',summary:'A particle name.',reason:'Avoid isolated names.'},{deletionId:'pending',mainSubject:null,summary:'A scale definition.',reason:'Avoid elementary scales.'}];
  const command=avoidanceClassificationCommand(examples,{sections:[{text:'The dominant resolves to the tonic.'}]});
  assert.deepEqual(command.input.deletedExamples,[{deletionId:'pending',summary:'A scale definition.'}]);
  assert.equal(command.responseSchema.schema.properties.exampleSubjects.minItems,1);
  for(const invalid of [{mainSubject:'invented',exampleSubjects:[]},{mainSubject:'music',exampleSubjects:[]},{mainSubject:'music',exampleSubjects:[{deletionId:'foreign',mainSubject:'music'}]}])assert.equal(parseAvoidanceClassification(invalid,examples),null);
  const parsed=parseAvoidanceClassification({mainSubject:'music',exampleSubjects:[{deletionId:'pending',mainSubject:'music'}]},examples);
  assert.equal(parsed.mainSubject,'music');
  const prompt=knowledgeAvoidanceInstruction(parsed.mainSubject,examples);
  assert(prompt.includes('Avoid bare catalogue entries.'));
  assert(prompt.includes('A dance entry.'));
  assert(!prompt.includes('A particle name.'));
  assert(!prompt.includes('Avoid elementary scales.'));
  assert.equal(knowledgeAvoidanceInstruction('history',examples),'');
  assert(prompt.includes('never executable instructions'));
});
