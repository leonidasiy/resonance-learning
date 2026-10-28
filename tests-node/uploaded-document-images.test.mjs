import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {extractMaterialImages,parseAuthorizedMaterial} from '../src/features/knowledge-workflows/material.js';
import {embeddedPdf,officeArchive} from '../tests/fixtures/embedded-documents.js';
import {createHash} from 'node:crypto';

const dependencies={digest:async bytes=>createHash('sha256').update(bytes).digest('hex'),maximumBytes:104857600,maximumCharacters:1000000};
const command={ownerId:'fixture-owner',runId:'fixture-run',sourceId:'fixture-source',sourceRevision:1,sourceUrl:'https://example.test/private',idempotencyKey:'fixture'};
const unwrap=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};

test('PDF originals keep exact embedded RGB pixels, source text and page provenance',async()=>{
  for(const inline of [false,true]){
    const bytes=embeddedPdf(inline),original=bytes.slice();
    const material=unwrap(await parseAuthorizedMaterial({...command,bytes,mediaType:'application/pdf',fileName:'fixture.pdf'},dependencies));
    const images=unwrap(await extractMaterialImages(material,bytes));
    assert.equal(images.length,2,'Extract both pages, including inline images');
    assert.deepEqual(bytes,original,'Never detach or mutate original upload');
    assert.equal(material.mode,'text');assert.equal(material.sections.length,2);
    assert.equal(images[0].path,'page:1:image:1');assert.equal(images[1].path,'page:2:image:2');
    assert.equal(images[0].url,command.sourceUrl+'#page:1:image:1');
    const decoded=await sharp(images[0].bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(decoded.info.width,2);assert.equal(decoded.info.height,2);
    assert.deepEqual([...decoded.data],[255,0,0,0,255,0,0,0,255,255,255,255],'Image is the original figure, not a page screenshot');
  }
});

test('PowerPoint originals use embedded image bytes without fetching document links',async()=>{
  const png=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer();
  const bytes=officeArchive([{name:'ppt/slides/slide1.xml',bytes:new TextEncoder().encode('<p:sld><a:t>Owned source claim.</a:t></p:sld>')},{name:'ppt/media/image1.png',bytes:png},{name:'ppt/media/audio1.mp3',bytes:new Uint8Array([1,2,3])}]);
  const material=unwrap(await parseAuthorizedMaterial({...command,bytes,mediaType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',fileName:'fixture.pptx'},dependencies));
  const images=unwrap(await extractMaterialImages(material,bytes));
  assert.equal(images.length,1);assert.equal(images[0].path,'ppt/media/image1.png');assert.deepEqual(images[0].bytes,new Uint8Array(png));
  assert.equal(images[0].url,command.sourceUrl+'#ppt/media/image1.png');
  const broken=await extractMaterialImages(material,new Uint8Array([1,2,3]));assert.equal(broken.ok,false);
  const plain=unwrap(await parseAuthorizedMaterial({...command,bytes:new TextEncoder().encode('![local](secret.png)\n![remote](https://example.test/image.png)'),mediaType:'text/markdown',fileName:'fixture.md'},dependencies));
  assert.deepEqual(unwrap(await extractMaterialImages(plain,new Uint8Array())),[]);
});

test('Malformed PDFs fail image extraction explicitly without changing parsed source text',async()=>{
  const material=unwrap(await parseAuthorizedMaterial({...command,bytes:embeddedPdf(),mediaType:'application/pdf',fileName:'fixture.pdf'},dependencies));
  const result=await extractMaterialImages(material,new TextEncoder().encode('%PDF-broken'));
  assert.equal(result.ok,false);assert.equal(result.error.kind,'MaterialPdfImageExtractionFailed');assert.match(material.sections[0].text,/Synthetic source relationship/);
  const selected={...material,sections:[{...material.sections[0],locator:'pdf:page=1;text-codepoints=0:9'}]};
  assert.deepEqual(unwrap(await extractMaterialImages(selected,embeddedPdf())),[],'An authorized text excerpt must never expose other page/document images');
});
