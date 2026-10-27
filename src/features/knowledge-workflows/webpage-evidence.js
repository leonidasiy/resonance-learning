// @ts-check
/** @typedef {import('../../../acquisition/contracts.ts').WebpageEvidence} WebpageEvidence */
/**
 * Runs inside the isolated rendered DOM. Image metadata never enters source blocks.
 * IDs are DOM paths within this captured revision, not publisher-supplied claims.
 * @param {{url:string,textCharacters:number,candidateCount:number,occurrenceWindow:number}} command
 * @returns {import('../../../acquisition/contracts.ts').Result<WebpageEvidence> | {ok:false,error:{kind:'WebpageProjectionCommandInvalid'|'WebpageTextLimitExceeded'}}}
 */
export function collectWebpageEvidence(command) {
  if (!command || !URL.canParse(command.url) || new URL(command.url).protocol !== 'https:' || [command.textCharacters, command.candidateCount, command.occurrenceWindow].some(n => !Number.isSafeInteger(n) || n <= 0)) return {ok:false,error:{kind:'WebpageProjectionCommandInvalid'}};
  /** @param {Element} element */
  const locator = element => {
    const parts = [];
    for (let node = element; node; ) {
      const tag = node.tagName.toLowerCase();
      const siblings = node.parentElement ? [...node.parentElement.children].filter(s => s.tagName === node.tagName) : [node];
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`);
      if (!node.parentElement) break;
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  /** @param {Element} element */
  const visible = element => element.getClientRects().length > 0 && !element.closest('[hidden], [aria-hidden="true"], script, style, template, noscript') && getComputedStyle(element).visibility !== 'hidden';
  /** @param {Element} element */
  const sourceText = element => {
    const copy = element.cloneNode(true);
    if (!(copy instanceof Element)) return '';
    copy.querySelectorAll('img,svg,canvas,script,style,template,noscript,[hidden],[aria-hidden="true"]').forEach(e => e.remove());
    return (copy.textContent ?? '').replace(/\s+/gu, ' ').trim();
  };
  /** @param {Element} element */
  const sourceLinks = element => [...(element.closest('a[href]') ? [element.closest('a[href]')] : []), ...element.querySelectorAll('a[href]')].flatMap(anchor => {
    if (!anchor) return [];
    if (!visible(anchor)) return [];
    const text = sourceText(anchor.contains(element) ? element : anchor), href = anchor.getAttribute('href');
    const base = URL.canParse(document.baseURI) && /^https?:$/u.test(new URL(document.baseURI).protocol) ? document.baseURI : command.url;
    if (!text || !href || !URL.canParse(href, base)) return [];
    const url = new URL(href, base);
    return /^https?:$/u.test(url.protocol) && !url.username && !url.password ? [{text,url:url.href}] : [];
  });
  const container = document.querySelector('main,article') ?? document.body;
  /** @type {WebpageEvidence['blocks'][number][]} */ const blocks = [];
  /** @type {WebpageEvidence['headings'][number][]} */ const headings = [];
  /** @type {Map<string,{id:string,url:string,occurrences:WebpageEvidence['images'][number]['occurrences'][number][]}>} */ const images = new Map();
  const warnings = new Set();
  let sectionId = 'section:root', characters = 0;
  for (const element of container.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,pre,td,th,dt,dd,figcaption,img')) {
    if (!visible(element)) continue;
    const path = locator(element), id = `dom:${path}`;
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/u.test(tag)) {
      sectionId = `section:${id}`;
      headings.push({id,sectionId,locator:path,text:sourceText(element),level:Number(tag[1])});
      continue;
    }
    if (tag !== 'img') {
      // Nested block elements get their own evidence; avoid duplicated parent text.
      if (element.querySelector('p,li,pre,td,th,dt,dd,figcaption')) continue;
      const text = sourceText(element);
      if (!text) continue;
      characters += text.length;
      if (characters > command.textCharacters) return {ok:false,error:{kind:'WebpageTextLimitExceeded'}};
      const figure = element.closest('figure');
      const inlineLinks = sourceLinks(element);
      blocks.push({id,locator:path,sectionId,kind:tag === 'figcaption' ? 'caption' : 'text',text,...(inlineLinks.length ? {inlineLinks} : {}),figureId:figure ? `figure:${locator(figure)}` : null});
      continue;
    }
    const image = /** @type {HTMLImageElement} */ (element);
    const figure = image.closest('figure');
    const caption = figure?.querySelector('figcaption');
    const occurrence = {id:`occurrence:${path}`,locator:path,sectionId,figureId:figure ? `figure:${locator(figure)}` : null,captionId:caption && visible(caption) ? `dom:${locator(caption)}` : null,alt:image.alt.slice(0,300)};
    const rawUrls = [image.currentSrc, image.getAttribute('data-src'), image.getAttribute('data-lazy-src'), image.getAttribute('src'), ...[image.getAttribute('srcset'), ...[...(image.closest('picture')?.querySelectorAll('source[srcset]') ?? [])].map(e => e.getAttribute('srcset'))].flatMap(s => (s ?? '').split(',').map(v => v.trim().split(/\s+/u)[0]))];
    const urls = new Set(rawUrls.filter(u => u && URL.canParse(u, command.url)).map(u => new URL(/** @type {string} */(u), command.url)).filter(u => u.protocol === 'https:' && !u.username && !u.password).map(u => u.href));
    for (const url of urls) {
      let candidate = images.get(url);
      if (!candidate) {
        if (images.size >= command.candidateCount) warnings.add('WebpageImageCandidateWindowRequired');
        candidate = {id:`image:${images.size + 1}`,url,occurrences:[]}; images.set(url,candidate);
      }
      candidate.occurrences.push(occurrence);
    }
  }
  // Windows retain every occurrence; request composition chooses bounded windows.
  const imageList = [...images.values()].map(image => ({...image,occurrenceWindows:Array.from({length:Math.ceil(image.occurrences.length / command.occurrenceWindow)},(_,i) => image.occurrences.slice(i*command.occurrenceWindow,(i+1)*command.occurrenceWindow).map(o=>o.id))}));
  return {ok:true,value:{url:command.url,headings,blocks,images:imageList,warnings:[...warnings]}};
}
