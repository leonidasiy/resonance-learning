import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updateAcquisitionOrigin} from '../scripts/acquisition-tunnel.mjs';

test('tunnel refresh changes only the destination, preserving the client origin and private configuration',()=>{
  const config='// local config\n{"vars":{"ACQUISITION_ORIGIN":"https://old.example","ACQUISITION_CLIENT_ORIGIN":"https://stable.example","OTHER":"retained"}}';
  const updated=updateAcquisitionOrigin(config,'https://renewed.trycloudflare.com/');
  assert.equal(updated,config.replace('https://old.example','https://renewed.trycloudflare.com'));
  for(const origin of ['http://unsafe.example','https://user:secret@unsafe.example','https://unsafe.example/path','https://unsafe.example/?q=1'])assert.throws(()=>updateAcquisitionOrigin(config,origin));
  for(const source of ['{}',config.replace('"OTHER":"retained"','"ACQUISITION_ORIGIN":"https://duplicate.example"')])assert.throws(()=>updateAcquisitionOrigin(source,'https://new.example'));
});
