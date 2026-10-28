// @ts-check
const encode = new TextEncoder();
/** Synthetic owned PDF. @param {boolean} [inline] @param {boolean} [includeImages] @param {readonly string[]} [texts] */
export function embeddedPdf(inline = false, includeImages = true, texts = ["Synthetic source relationship 1.", "Synthetic source relationship 2."]) {
  const pixels = ["ff000000ff000000ffffffff", "0000ffff000000ff00ffffff"];
  const objects = ["", "<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${texts.map((_,i)=>`${4+i*3} 0 R`).join(" ")}] /Count ${texts.length} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (let index = 0; index < texts.length; index++) {
    const page = 4 + index * 3;
    const draw = inline ? `BI /W 2 /H 2 /BPC 8 /CS /RGB /F /AHx ID ${pixels[index % 2]}> EI` : `/Figure Do`;
    const content = `BT /F1 12 Tf 72 720 Td (${texts[index]}) Tj ET ${includeImages ? `q 120 0 0 120 72 500 cm ${draw} Q` : ""}`;
    objects[page] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Figure ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`;
    objects[page + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    objects[page + 2] = `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 25 >>\nstream\n${pixels[index % 2]}>\nendstream`;
  }
  let output = "%PDF-1.7\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = output.length; output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = output.length;
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return encode.encode(output);
}

/** Minimal uncompressed owned Office archive. @param {readonly {name:string,bytes:Uint8Array}[]} entries */
export function officeArchive(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encode.encode(entry.name), header = new Uint8Array(30), record = new Uint8Array(46);
    const view = new DataView(header.buffer), directory = new DataView(record.buffer);
    view.setUint32(0,0x04034b50,true); view.setUint16(4,20,true); view.setUint32(18,entry.bytes.length,true); view.setUint32(22,entry.bytes.length,true); view.setUint16(26,name.length,true);
    directory.setUint32(0,0x02014b50,true); directory.setUint16(4,20,true); directory.setUint16(6,20,true); directory.setUint32(20,entry.bytes.length,true); directory.setUint32(24,entry.bytes.length,true); directory.setUint16(28,name.length,true); directory.setUint32(42,offset,true);
    local.push(header,name,entry.bytes); central.push(record,name); offset += 30 + name.length + entry.bytes.length;
  }
  const size = central.reduce((n, part) => n + part.length,0), end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0,0x06054b50,true); view.setUint16(8,entries.length,true); view.setUint16(10,entries.length,true); view.setUint32(12,size,true); view.setUint32(16,offset,true);
  const result = new Uint8Array(offset + size + end.length); let cursor = 0;
  for (const part of [...local,...central,end]) {result.set(part,cursor);cursor += part.length;}
  return result;
}
