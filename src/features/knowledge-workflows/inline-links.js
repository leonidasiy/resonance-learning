// @ts-check
/** @typedef {{readonly text:string,readonly url:string}} InlineLink */

/** @param {unknown} value @param {string} [source] @returns {value is readonly InlineLink[]} */
export function isInlineLinks(value, source) {
  return Array.isArray(value) && value.every(link => {
    if (!link || typeof link !== 'object' || Object.keys(link).sort().join(',') !== 'text,url' || typeof link.text !== 'string' || !link.text.trim() || source !== undefined && !source.includes(link.text) || typeof link.url !== 'string' || !URL.canParse(link.url)) return false;
    const url = new URL(link.url);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  });
}

/** Match literal reused text; longer labels take precedence over nested labels.
 * @param {string} summary @param {readonly InlineLink[]} links
 * @returns {{start:number,end:number,url:string}[]} */
export function inlineLinkSpans(summary, links) {
  /** @type {Map<string,Set<string>>} */ const destinations = new Map();
  for (const link of links) {
    const urls = destinations.get(link.text) ?? new Set();
    urls.add(link.url); destinations.set(link.text, urls);
  }
  /** @type {{start:number,end:number,url:string}[]} */ const spans = [];
  for (const [label, urls] of [...destinations].sort((a,b) => b[0].length-a[0].length)) {
    // shortcut: conflicting destinations for the same label stay unlinked; use source spans if disambiguation is needed.
    if (urls.size !== 1) continue;
    for (let start = summary.indexOf(label); start !== -1; start = summary.indexOf(label, start + label.length)) {
      const end = start + label.length;
      if ((/[A-Za-z0-9_]/u.test(label[0]) && /[A-Za-z0-9_]/u.test(summary[start-1] ?? '')) || (/[A-Za-z0-9_]/u.test(label.at(-1) ?? '') && /[A-Za-z0-9_]/u.test(summary[end] ?? ''))) continue;
      if (!spans.some(span => start < span.end && end > span.start)) spans.push({start,end,url:[...urls][0]});
    }
  }
  return spans.sort((a,b) => a.start-b.start);
}
