import assert from 'node:assert/strict';
import {test} from 'node:test';
import {showKnowledgeDeletionDialog} from '../src/features/learning-generation/deletion-dialog.js';

test('deletion dialog confirms before deleting, then retries optional feedback without repeating deletion',async()=>{
  class Element {
    listeners={};children={};textContent='';value='';disabled=false;hidden=true;isConnected=true;focused=false;
    addEventListener(name,listener){this.listeners[name]=listener;}
    setAttribute(){}
    querySelector(selector){return this.children[selector];}
    focus(){this.focused=true;}
    showModal(){this.open=true;}
    close(){this.open=false;this.listeners.close?.();}
    remove(){this.isConnected=false;}
    async emit(name){const event={prevented:false,preventDefault(){this.prevented=true;}};await this.listeners[name]?.(event);return event;}
  }
  const savedDocument=globalThis.document,savedElement=globalThis.HTMLElement;
  const previous=new Element(),dialog=new Element(),form=new Element(),submit=new Element(),dismiss=new Element(),reason=new Element(),error=new Element(),heading=new Element(),description=new Element(),label=new Element();
  dialog.children={form,h2:heading,'#knowledge-deletion-description':description};
  form.children={'[type=submit]':submit,'[data-dismiss]':dismiss,textarea:reason,'[role=alert]':error,'.deletion-reason':label};
  globalThis.HTMLElement=Element;
  globalThis.document={activeElement:previous,createElement:name=>{assert.equal(name,'dialog');return dialog;},body:{append:()=>{}}};
  let deletes=0,saves=0,finishDelete;
  try {
    showKnowledgeDeletionDialog({remove:async()=>{deletes++;return await new Promise(resolve=>{finishDelete=resolve;});},saveReason:async(id,text)=>{saves++;assert.equal(id,'deleted-1');assert.equal(text,'Avoid trivia');return saves>1;}});
    assert.equal(deletes,0);assert.equal(dialog.open,true);assert(dismiss.focused);
    const deleting=form.emit('submit');
    assert.equal(deletes,1);assert(submit.disabled);assert(dismiss.disabled);
    assert((await dialog.emit('cancel')).prevented);
    await form.emit('submit');assert.equal(deletes,1);
    finishDelete({ok:true,deletionId:'deleted-1'});await deleting;
    assert.equal(heading.textContent,'Knowledge point deleted');assert.equal(label.hidden,false);
    assert.match(description.textContent,/similar knowledge points/);assert.equal(dismiss.textContent,'Skip');assert(reason.focused);
    reason.value='  Avoid trivia  ';await form.emit('submit');
    assert.equal(deletes,1);assert.equal(saves,1);assert.match(error.textContent,/reason could not be saved/);assert.equal(dialog.open,true);
    await form.emit('submit');assert.equal(deletes,1);assert.equal(saves,2);
    assert.equal(dialog.open,false);assert.equal(dialog.isConnected,false);assert(previous.focused);
  } finally {
    if(savedDocument===undefined)delete globalThis.document;else globalThis.document=savedDocument;
    if(savedElement===undefined)delete globalThis.HTMLElement;else globalThis.HTMLElement=savedElement;
  }
});
