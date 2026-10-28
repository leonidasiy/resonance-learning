import {retryAfterMilliseconds} from '../src/features/knowledge-workflows/retry.js';
// @ts-check
import {AgentExecutionBoundaryFailure} from '../src/features/knowledge-workflows/harness.js';
import {projectProviderMessage,isProviderErrorTermination} from './provider-error.js';

/** @template T, E @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: E }} Result */

/** @typedef {"rights-assessor" | "knowledge-scraper" | "question-generator" | "question-evaluator"} KnowledgeAgentRole */
/** @typedef {KnowledgeAgentRole | "semantic-ranker" | "review-grader" | "source-assessor"} KnowledgeModelRole */
/** @typedef {{ readonly id: string, readonly mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif", readonly bytes?: Uint8Array, readonly url?: string }} KnowledgeModelAttachment */
/** @typedef {{ readonly name: string, readonly schema: Record<string, unknown> }} KnowledgeResponseSchema */
/** @typedef {{ readonly phase?: import("./webpage-facts.js").WebpagePhase, readonly role: KnowledgeAgentRole, readonly systemPrompt: string, readonly input: unknown, readonly maxOutputTokens: number, readonly timeoutMs?: number, readonly signal?: AbortSignal, readonly attachments?: readonly KnowledgeModelAttachment[], readonly responseSchema?: KnowledgeResponseSchema, readonly reasoningEffort?: "none" | "low" | "high", readonly providerSort?: "throughput" }} KnowledgeModelCommand */
/** @typedef {{ readonly phase?: import("./webpage-facts.js").WebpagePhase, readonly role: KnowledgeModelRole, readonly systemPrompt: string, readonly input: unknown, readonly maxOutputTokens: number, readonly timeoutMs?: number, readonly signal?: AbortSignal, readonly attachments?: readonly KnowledgeModelAttachment[], readonly responseSchema?: KnowledgeResponseSchema, readonly reasoningEffort?: "none" | "low" | "high", readonly providerSort?: "throughput" }} KnowledgeModelTransportCommand */
/** @typedef {{ readonly output: Record<string, unknown>, readonly requestId: string | null, readonly inputTokens: number | null, readonly outputTokens: number | null, readonly reasoningTrace: { readonly provider: string, readonly fields: readonly unknown[] } | null }} KnowledgeModelResult */
/** @typedef {{ readonly kind: "KnowledgeModelCommandInvalid", readonly field: string } | { readonly kind: "KnowledgeModelCredentialMissing" } | { readonly kind: "KnowledgeModelCancelled" } | { readonly kind: "KnowledgeModelResponseReadFailed" } | { readonly kind: "KnowledgeModelUsageInvalid", readonly field: string } | { readonly kind: "KnowledgeModelTimeout" } | { readonly kind: "KnowledgeModelUnavailable" } | { readonly kind: "KnowledgeModelRejected", readonly status: number, readonly retryAfterMs?:number, readonly finishReason?: "error", readonly providerDiagnostic?: import("./provider-error.js").ProviderMessage, readonly diagnosticIssue?: "ProviderDiagnosticBodyInvalid" | "ProviderDiagnosticBodyTooLarge" | "ProviderDiagnosticReadFailed" } | { readonly kind: "KnowledgeModelResponseDuplicateKey" } | { readonly kind: "KnowledgeModelResponseInvalid", readonly field: string }} KnowledgeModelFailure */
/** @typedef {{sort?:"throughput",require_parameters:true,allow_fallbacks:boolean,only?:string[],max_price?:{prompt:number,completion:number,request:0,image:0}}} KnowledgeModelProvider */
/** @typedef {{source:string,responseFormat:"json_object"|"json_schema",reasoningEffort?:"none"|"low"|"high",receiptProviders?:string[],maximumOutputTokens?:number,provider:KnowledgeModelProvider,receiptOptional:true}} KnowledgeModelProtocol */
/** @typedef {{ readonly apiStyle?: "openrouter" | "openai-compatible", readonly protocol?: KnowledgeModelProtocol, readonly apiKey: string | null, readonly endpoint: string, readonly model: string, readonly timeoutMs: number, readonly maximumInputCharacters: number, readonly fetch: typeof fetch, readonly now: () => number, readonly logger: (entry: { readonly event: string, readonly role?: KnowledgeModelRole, readonly phase?: import("./webpage-facts.js").WebpagePhase, readonly failureKind?: string, readonly field?: string, readonly diagnosticToken?: string, readonly durationMs?: number, readonly requestId?: string, readonly inputTokens?: number | null, readonly outputTokens?: number | null, readonly costNanodollars?:number|null }) => void }} KnowledgeModelDependencies */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is number} */
function positiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
/** @param {unknown} value @returns {value is number} */
function nonNegativeInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }

/** Factor only redundant conjunctions at the wire boundary; durable call identities retain the original schema.
 * @param {KnowledgeResponseSchema} definition @returns {KnowledgeResponseSchema} */
function compactReviewSchema(definition) {
  if (definition.name !== "knowledge_quality_review_v12") return definition;
  const schema = structuredClone(definition.schema);
  /** @param {unknown} node */
  function visit(node) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!record(node)) return;
    if (node.type === "object" && record(node.properties) && Array.isArray(node.anyOf)) {
      const properties = node.properties;
      for (const branch of node.anyOf) {
        if (!record(branch) || branch.type !== "object" || !record(branch.properties)) continue;
        delete branch.type;
        if (JSON.stringify(branch.required) === JSON.stringify(node.required)) delete branch.required;
        if (branch.additionalProperties === false && node.additionalProperties === false && JSON.stringify(Object.keys(branch.properties).sort()) === JSON.stringify(Object.keys(properties).sort())) delete branch.additionalProperties;
        for (const [key, constraints] of Object.entries(branch.properties)) {
          const inherited = properties[key];
          if (!record(constraints) || !record(inherited)) continue;
          for (const [name, value] of Object.entries(constraints)) {
            if (JSON.stringify(value) === JSON.stringify(inherited[name])) delete constraints[name];
          }
        }
      }
    }
    for (const [key, child] of Object.entries(node)) if (key !== "enum" && key !== "const") visit(child);
  }
  visit(schema);
  return { ...definition, schema };
}

/** Shared wire contract for the model adapter, evaluation roles and billed transport.
 * @param {unknown} value @returns {value is KnowledgeModelProvider} */
export function isKnowledgeModelProvider(value) {
  if (!record(value) || Object.keys(value).some(key=>!["sort","require_parameters","allow_fallbacks","only","max_price"].includes(key)) || value.sort!==undefined&&value.sort!=="throughput" || value.require_parameters!==true || typeof value.allow_fallbacks!=="boolean") return false;
  if (value.only!==undefined && (value.allow_fallbacks || !Array.isArray(value.only) || !value.only.length || !value.only.every(text) || new Set(value.only).size!==value.only.length)) return false;
  if (value.max_price!==undefined) {
    const price=value.max_price;
    if (!record(price) || Object.keys(price).sort().join(",")!=="completion,image,prompt,request" || price.request!==0 || price.image!==0 || ![price.prompt,price.completion].every(rate=>typeof rate==="number" && rate>=0 && Number.isSafeInteger(rate*1000))) return false;
  }
  return true;
}

/**
 * JSON.parse accepts duplicate object names and keeps only the last value. Scan already-valid JSON
 * text before parsing to reject that ambiguity without applying a JSON-like regular expression.
 * Property names are decoded as JSON strings before comparison, so escaped-equivalent names match.
 * @param {string} source
 * @returns {boolean}
 */
function hasDuplicateJsonObjectKey(source) {
  let index = 0;
  /** @returns {string} */
  function readString() {
    const start = index++;
    while (index < source.length) {
      if (source[index] === "\\") { index += 2; continue; }
      if (source[index++] === '"') return /** @type {string} */ (JSON.parse(source.slice(start, index)));
    }
    throw new SyntaxError("Validated JSON string ended unexpectedly.");
  }
  function whitespace() { while (index < source.length && /[\t\n\r ]/u.test(source[index])) index++; }
  /** @returns {boolean} */
  function readValue() {
    whitespace();
    if (source[index] === '"') { readString(); return false; }
    if (source[index] === "{") {
      index++;
      whitespace();
      const names = new Set();
      if (source[index] === "}") { index++; return false; }
      while (index < source.length) {
        whitespace();
        const name = readString();
        if (names.has(name)) return true;
        names.add(name);
        whitespace(); index++; // validated colon
        if (readValue()) return true;
        whitespace();
        if (source[index] === "}") { index++; return false; }
        index++; // validated comma
      }
      throw new SyntaxError("Validated JSON object ended unexpectedly.");
    }
    if (source[index] === "[") {
      index++;
      whitespace();
      if (source[index] === "]") { index++; return false; }
      while (index < source.length) {
        if (readValue()) return true;
        whitespace();
        if (source[index] === "]") { index++; return false; }
        index++; // validated comma
      }
      throw new SyntaxError("Validated JSON array ended unexpectedly.");
    }
    while (index < source.length && !/[\s,}\]]/u.test(source[index])) index++;
    return false;
  }
  return readValue();
}
const MAXIMUM_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAXIMUM_ATTACHMENT_TOTAL_BYTES = 32 * 1024 * 1024;
/** @param {unknown} value @returns {value is KnowledgeModelAttachment} */
function validAttachment(value) {
  if (!record(value) || !text(value.id) || typeof value.mediaType !== "string" || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(value.mediaType)) return false;
  const bytes = value.bytes;
  const url = value.url;
  const hasBytes = bytes instanceof Uint8Array;
  const hasUrl = typeof url === "string";
  if (hasBytes === hasUrl || hasBytes && (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_ATTACHMENT_BYTES) || hasUrl && (!URL.canParse(url) || new URL(url).protocol !== "https:" || new URL(url).username !== "" || new URL(url).password !== "")) return false;
  return true;
}
/** @param {Uint8Array} bytes @returns {string} */
function base64(bytes) {
  const native = /** @type {Uint8Array & {toBase64?:()=>string}} */ (bytes);
  if (typeof native.toBase64 === 'function') return native.toBase64();
  // Older local runtimes such as Deno 2.0 lack the native Workers operation.
  const chunks = []; for (let index = 0; index < bytes.byteLength; index += 32_768) chunks.push(String.fromCharCode(...bytes.subarray(index, Math.min(index + 32_768, bytes.byteLength)))); return btoa(chunks.join(""));
}
/** @param {readonly KnowledgeModelAttachment[]} attachments @returns {({ readonly type: "image_url", readonly image_url: { readonly url: string } } | {readonly type:"text",readonly text:string})[]} */
function imageBlocks(attachments) {
  return attachments.flatMap((attachment) => [{type:"text",text:`Attachment ID: ${attachment.id}; mediaType: ${attachment.mediaType}. The following image belongs only to this ID.`}, { type: "image_url", image_url: { url: attachment.bytes instanceof Uint8Array ? `data:${attachment.mediaType};base64,${base64(attachment.bytes)}` : /** @type {string} */ (attachment.url) } }]);
}
/** @param {KnowledgeModelFailure} failure @param {KnowledgeModelDependencies} dependencies @param {KnowledgeModelRole | undefined} role @param {number} startedAt @param {string | undefined} [diagnosticToken] @param {import("./webpage-facts.js").WebpagePhase | undefined} [phase] @returns {Result<never, KnowledgeModelFailure>} */
function fail(failure, dependencies, role, startedAt, diagnosticToken = undefined, phase = undefined) {
  const durationMs = dependencies.now() - startedAt;
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new TypeError("Knowledge model clock returned an invalid duration.");
  dependencies.logger({ event: "knowledge-model-failure", role, ...(phase===undefined?{}:{phase}), failureKind: failure.kind, ...("field" in failure ? { field: failure.field } : {}), ...(diagnosticToken === undefined ? {} : { diagnosticToken }), durationMs });
  return { ok: false, error: failure };
}

/** @param {unknown} error @returns {string} */
function transportDiagnostic(error) {
  if (!(error instanceof Error)) return "unknown-error";
  const message = error.message.toLowerCase();
  if (message.includes("dns") || message.includes("name resolution")) return "dns";
  if (message.includes("tls") || message.includes("certificate")) return "tls";
  if (message.includes("connect") || message.includes("socket")) return "connect";
  if (message.includes("fetch")) return "fetch";
  return error.name === "TypeError" ? "type-error" : "unknown-error";
}

/** Bounded diagnostic parsing happens before failure projection. No raw text escapes this function.
 * @param {Response} response @param {readonly unknown[]} privateInputs @returns {Promise<{providerDiagnostic:import('./provider-error.js').ProviderMessage,diagnosticIssue?:'ProviderDiagnosticBodyInvalid'|'ProviderDiagnosticBodyTooLarge'|'ProviderDiagnosticReadFailed'}>} */
async function rejectedDiagnostic(response,privateInputs) {
 const omitted={providerDiagnostic:/** @type {const} */({errorMessage:null,messageDisposition:'omitted-unsafe'})};
 if(!response.body)return {...omitted,diagnosticIssue:'ProviderDiagnosticBodyInvalid'};
 const reader=response.body.getReader();const chunks=[];let size=0;
 try {
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384){await reader.cancel();return {...omitted,diagnosticIssue:'ProviderDiagnosticBodyTooLarge'};}chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let document;try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch(error){if(!(error instanceof SyntaxError)&&!(error instanceof TypeError))throw error;return {...omitted,diagnosticIssue:'ProviderDiagnosticBodyInvalid'};}
  return {providerDiagnostic:projectProviderMessage(record(document)&&record(document.error)?document.error.message:undefined,privateInputs)};
 }catch(error){if(!(error instanceof Error))throw error;return {...omitted,diagnosticIssue:'ProviderDiagnosticReadFailed'};}finally{reader.releaseLock();}
}

/** @param {KnowledgeModelDependencies} dependencies */
export function createOpenRouterKnowledgeModel(dependencies) {
  if ((dependencies?.apiKey !== null && typeof dependencies?.apiKey !== "string") || !text(dependencies?.endpoint) || !URL.canParse(dependencies.endpoint) || new URL(dependencies.endpoint).protocol !== "https:" || !text(dependencies.model) || !positiveInteger(dependencies.timeoutMs) || !positiveInteger(dependencies.maximumInputCharacters) || typeof dependencies.fetch !== "function" || typeof dependencies.now !== "function" || typeof dependencies.logger !== "function") throw new TypeError("Knowledge model dependencies are invalid.");
  if (dependencies.apiStyle !== undefined && !["openrouter", "openai-compatible"].includes(dependencies.apiStyle)) throw new TypeError("KnowledgeModelApiStyleInvalid");
  const compatible = dependencies.apiStyle === "openai-compatible";
  const protocol=dependencies.protocol;
  if(protocol!==undefined&&(!record(protocol)||!text(protocol.source)||(protocol.responseFormat!=="json_object"&&protocol.responseFormat!=="json_schema")||(protocol.reasoningEffort!==undefined&&protocol.reasoningEffort!=="none"&&protocol.reasoningEffort!=="low"&&protocol.reasoningEffort!=="high")||protocol.maximumOutputTokens!==undefined&&!positiveInteger(protocol.maximumOutputTokens)||protocol.receiptProviders!==undefined&&(!Array.isArray(protocol.receiptProviders)||!protocol.receiptProviders.length||!protocol.receiptProviders.every(text))||protocol.receiptOptional!==true||!isKnowledgeModelProvider(protocol.provider)||protocol.provider.allow_fallbacks&&protocol.receiptProviders!==undefined))throw new TypeError("KnowledgeModelProtocolInvalid");
  const endpoint = new URL(dependencies.endpoint).href;
  const apiKey = dependencies.apiKey;
  return Object.freeze({
    /** @param {unknown} input @returns {Promise<Result<KnowledgeModelResult, KnowledgeModelFailure>>} */
    async generate(input) {
      const startedAt = dependencies.now();
      if (!Number.isFinite(startedAt)) throw new TypeError("Knowledge model clock returned an invalid instant.");
      if (!record(input) || (input.phase!==undefined&&(typeof input.phase!=="string"||!["extraction","normalization","grounding","match","verify"].includes(input.phase))) || (input.signal !== undefined && !(input.signal instanceof AbortSignal)) || !text(input.role) || !["rights-assessor", "knowledge-scraper", "question-generator", "question-evaluator", "semantic-ranker", "review-grader", "source-assessor"].includes(input.role) || !text(input.systemPrompt) || !positiveInteger(input.maxOutputTokens) || (input.timeoutMs !== undefined && !positiveInteger(input.timeoutMs)) || (input.responseSchema !== undefined && (!record(input.responseSchema) || !text(input.responseSchema.name) || !record(input.responseSchema.schema))) || (input.reasoningEffort !== undefined && ((input.reasoningEffort !== "none" && input.reasoningEffort !== "low" && input.reasoningEffort !== "high") || protocol!==undefined&&protocol.reasoningEffort!==input.reasoningEffort)) || (input.providerSort !== undefined && input.providerSort !== "throughput") || (input.attachments !== undefined && (!Array.isArray(input.attachments) || input.attachments.length > 8 || new Set(input.attachments.map(a=>record(a)?a.id:null)).size !== input.attachments.length || !input.attachments.every(validAttachment) || input.attachments.reduce((total, attachment) => total + (attachment.bytes instanceof Uint8Array ? attachment.bytes.byteLength : 0), 0) > MAXIMUM_ATTACHMENT_TOTAL_BYTES))) return fail({ kind: "KnowledgeModelCommandInvalid", field: "command" }, dependencies, undefined, startedAt);
      let serializedInput;
      try { serializedInput = JSON.stringify(input.input); } catch (error) { return fail({ kind: "KnowledgeModelCommandInvalid", field: "input" }, dependencies, /** @type {KnowledgeModelRole} */ (input.role), startedAt); }
      if (!text(serializedInput) || serializedInput.length > dependencies.maximumInputCharacters) return fail({ kind: "KnowledgeModelCommandInvalid", field: "input" }, dependencies, /** @type {KnowledgeModelRole} */ (input.role), startedAt);
      if (apiKey === null || apiKey.trim() === "") return fail({ kind: "KnowledgeModelCredentialMissing" }, dependencies, /** @type {KnowledgeModelRole} */ (input.role), startedAt);
      const command = /** @type {KnowledgeModelTransportCommand} */ (input);
      const responseSchema = command.responseSchema === undefined ? undefined : compactReviewSchema(command.responseSchema);
      dependencies.logger({ event: "knowledge-model-entry", role: command.role, phase: command.phase });
      const controller = new AbortController();
      const timeoutMs = command.timeoutMs ?? dependencies.timeoutMs;
      /** @type {'caller-cancelled'|'caller-deadline'|'timer-expired'|null} */let abortCause=null;
      const callerAbort=()=>{abortCause??=command.signal?.reason instanceof DOMException&&command.signal.reason.name==='TimeoutError'?'caller-deadline':'caller-cancelled';};
      command.signal?.addEventListener('abort',callerAbort,{once:true});
      if(command.signal?.aborted)callerAbort();
      const timer = setTimeout(() => {abortCause??='timer-expired';controller.abort(new DOMException('KnowledgeModelRequestTimerExpired','TimeoutError'));}, timeoutMs);
      /** @param {'fetch'|'body'} stage */
      const aborted=stage=>fail({kind:abortCause==='caller-cancelled'?'KnowledgeModelCancelled':'KnowledgeModelTimeout'},dependencies,command.role,startedAt,`${abortCause}-${stage}`,command.phase);
      const requestSignal = command.signal === undefined ? controller.signal : AbortSignal.any([controller.signal, command.signal]);
      if (requestSignal.aborted) { clearTimeout(timer);command.signal?.removeEventListener("abort",callerAbort);return aborted("fetch"); }
      let response;
      let responseReceived = false;
      let document;
      try {
        // Workers support manual redirects; the status check below rejects them.
        response = await dependencies.fetch(endpoint, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: dependencies.model, messages: [{ role: "system", content: `${command.systemPrompt}${protocol?.responseFormat==="json_object"&&responseSchema?`\nRequired full local JSON schema (${responseSchema.name}); satisfy ALL fields, bounds, uniqueness and domain constraints: ${JSON.stringify(responseSchema.schema)}`:""}\nReturn only one JSON object. Do not include prose outside JSON.` }, { role: "user", content: command.attachments === undefined ? `<task_input>\n${serializedInput}\n</task_input>` : [{ type: "text", text: `<task_input>\n${serializedInput}\n</task_input>` }, ...imageBlocks(command.attachments)] }], response_format: protocol?.responseFormat === "json_object" || responseSchema === undefined ? { type: "json_object" } : { type: "json_schema", json_schema: { name: responseSchema.name, strict: true, schema: responseSchema.schema } }, ...(compatible ? {} : protocol?{provider:protocol.provider}:responseSchema === undefined ? {} : { provider: command.role === "question-evaluator" ? { require_parameters: true, allow_fallbacks: true } : { sort: command.providerSort ?? "throughput", require_parameters: true } }), ...(compatible || (protocol?.reasoningEffort ?? command.reasoningEffort) === undefined ? {} : { reasoning: { effort: protocol?.reasoningEffort ?? command.reasoningEffort } }), max_tokens: protocol?.maximumOutputTokens===undefined?command.maxOutputTokens:Math.min(command.maxOutputTokens,protocol.maximumOutputTokens), stream: false }),
          redirect: "manual",
          signal: requestSignal,
        });
        if(requestSignal.aborted)return aborted("fetch");
        responseReceived = true;
        if (!response.ok) {const retryAfterMs=retryAfterMilliseconds(response.headers.get("retry-after"),dependencies.now());const diagnostic=await rejectedDiagnostic(response,[command.input,command.systemPrompt,apiKey]);if(requestSignal.aborted)return aborted('body');return fail({ kind: "KnowledgeModelRejected", status: response.status,...(retryAfterMs===undefined?{}:{retryAfterMs}),...diagnostic }, dependencies, command.role, startedAt,undefined,command.phase);}
        document = /** @type {unknown} */ (await response.json());
      } catch (error) {
        if (error instanceof AgentExecutionBoundaryFailure) throw error;
        if (requestSignal.aborted) return aborted(responseReceived?"body":"fetch");
        if (!responseReceived && error instanceof TypeError) return fail({ kind: "KnowledgeModelUnavailable" }, dependencies, command.role, startedAt, transportDiagnostic(error),command.phase);
        if(responseReceived&&error instanceof TypeError)return fail({kind:"KnowledgeModelResponseReadFailed"},dependencies,command.role,startedAt,"response-read",command.phase);
        if (responseReceived && error instanceof SyntaxError) return fail({ kind: "KnowledgeModelResponseInvalid", field: "body" }, dependencies, command.role, startedAt,undefined,command.phase);
        throw error;
      } finally {
        clearTimeout(timer);
        command.signal?.removeEventListener("abort",callerAbort);
      }
      if (requestSignal.aborted) return aborted(responseReceived?"body":"fetch");
      if(record(document)) {
        const usage=record(document.usage)?document.usage:{};
        const cost=typeof usage.cost==='number'&&Number.isFinite(usage.cost)&&usage.cost>=0?Math.round(usage.cost*1_000_000_000):null;
        dependencies.logger({event:'knowledge-model-usage',role:command.role,phase:command.phase,...(text(document.id)?{requestId:document.id}:{}),costNanodollars:cost!==null&&Number.isSafeInteger(cost)?cost:null,inputTokens:nonNegativeInteger(usage.prompt_tokens)?usage.prompt_tokens:null,outputTokens:nonNegativeInteger(usage.completion_tokens)?usage.completion_tokens:null});
      }
      if(record(document)&&record(document.error))return fail({kind:'KnowledgeModelRejected',status:typeof document.error.code==='number'&&Number.isInteger(document.error.code)&&document.error.code>=400&&document.error.code<=599?document.error.code:response.status,providerDiagnostic:projectProviderMessage(document.error.message,[command.input,command.systemPrompt,apiKey])},dependencies,command.role,startedAt,undefined,command.phase);
      if (!record(document) || (!protocol?.receiptOptional&&!text(document.id)||document.id!==undefined&&!text(document.id)) || !Array.isArray(document.choices) || document.choices.length < 1 || !record(document.choices[0])) return fail({ kind: "KnowledgeModelResponseInvalid", field: "choices" }, dependencies, command.role, startedAt, "choices-shape",command.phase);
      const choice = document.choices[0];
      if (isProviderErrorTermination(document)) return fail({kind:"KnowledgeModelRejected",status:response.status,finishReason:"error"},dependencies,command.role,startedAt,"provider-error-termination",command.phase);
      if (choice.finish_reason !== "stop") return fail({ kind: "KnowledgeModelResponseInvalid", field: "finish_reason" }, dependencies, command.role, startedAt, choice.finish_reason === "length" ? "finish-length" : "finish-reason",command.phase);
      if (!record(choice.message) || !text(choice.message.content)) return fail({ kind: "KnowledgeModelResponseInvalid", field: "message.content" }, dependencies, command.role, startedAt, "message-content-empty",command.phase);
      let output;
      { // Every JSON model output rejects ambiguous duplicate keys, including semantic verdicts.
        try {
          JSON.parse(choice.message.content);
          if (hasDuplicateJsonObjectKey(choice.message.content)) return fail({ kind: "KnowledgeModelResponseDuplicateKey" }, dependencies, command.role, startedAt, "message-content-duplicate-key",command.phase);
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          return fail({ kind: "KnowledgeModelResponseInvalid", field: "message.content.json" }, dependencies, command.role, startedAt, "message-content-json",command.phase);
        }
      }
      try { output = JSON.parse(choice.message.content); } catch (error) {
        if (error instanceof SyntaxError) return fail({ kind: "KnowledgeModelResponseInvalid", field: "message.content.json" }, dependencies, command.role, startedAt, "message-content-json",command.phase);
        throw error;
      }
      if (!record(output)) return fail({ kind: "KnowledgeModelResponseInvalid", field: "output" }, dependencies, command.role, startedAt, "output-shape",command.phase);
      if(document.usage!==undefined&&!record(document.usage))return fail({kind:"KnowledgeModelUsageInvalid",field:"usage"},dependencies,command.role,startedAt,"usage",command.phase);
      const reported=record(document.usage)?document.usage:{};
      for(const field of ['prompt_tokens','completion_tokens'])if(reported[field]!==undefined&&!nonNegativeInteger(reported[field]))return fail({kind:"KnowledgeModelUsageInvalid",field:`usage.${field}`},dependencies,command.role,startedAt,`usage.${field}`,command.phase);
      const usage={inputTokens:nonNegativeInteger(reported.prompt_tokens)?reported.prompt_tokens:null,outputTokens:nonNegativeInteger(reported.completion_tokens)?reported.completion_tokens:null};
      const result = Object.freeze({ output, requestId: text(document.id)?document.id:null, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, reasoningTrace: null });
      const durationMs = dependencies.now() - startedAt;
      if (!Number.isFinite(durationMs) || durationMs < 0) throw new TypeError("Knowledge model duration is invalid.");
      dependencies.logger({ event: "knowledge-model-success", role: command.role, phase: command.phase, durationMs, ...(result.requestId===null?{}:{requestId:result.requestId}), inputTokens: result.inputTokens, outputTokens: result.outputTokens });
      return { ok: true, value: result };
    },
  });
}

export {};

/** One adapter per configured application role; evaluator calls share the same adapter as webpage review.
 * @param {Omit<KnowledgeModelDependencies,'model'|'timeoutMs'> & {modelProtocols?:Partial<Record<KnowledgeAgentRole,KnowledgeModelProtocol>>,configSnapshots:Readonly<Record<KnowledgeAgentRole,Pick<import('../src/features/knowledge-workflows/config.js').AgentConfigurationSnapshot,'model'|'limits'>>>}} dependencies */
export function createRoleConfiguredKnowledgeModel(dependencies) {
  const roles=/** @type {const} */(['rights-assessor','knowledge-scraper','question-generator','question-evaluator']);
  if(dependencies.modelProtocols!==undefined&&(!record(dependencies.modelProtocols)||Object.keys(dependencies.modelProtocols).some(role=>!roles.some(allowed=>allowed===role))))throw new TypeError('KnowledgeModelProtocolInvalid');
  const adapters=new Map(roles.map(role=>[role,createOpenRouterKnowledgeModel({...dependencies,protocol:dependencies.modelProtocols?.[role]??dependencies.protocol,model:dependencies.configSnapshots[role].model.name,timeoutMs:dependencies.configSnapshots[role].limits.timeoutMs})]));
  return Object.freeze({
    /** @param {unknown} input @returns {Promise<Result<KnowledgeModelResult,KnowledgeModelFailure>>} */
    async generate(input) {
      if(!record(input)||!roles.some(role=>role===input.role))return {ok:false,error:{kind:'KnowledgeModelCommandInvalid',field:'role'}};
      const role=/** @type {KnowledgeAgentRole} */(input.role),adapter=adapters.get(role);
      if(adapter===undefined)return {ok:false,error:{kind:'KnowledgeModelCommandInvalid',field:'role'}};
      const configuredEffort=dependencies.configSnapshots[role].model.reasoningEffort;
      // Trusted role configuration controls legacy helper LOW; conflicting explicit choices remain invalid.
      if(configuredEffort!==undefined&&input.reasoningEffort!==undefined&&input.reasoningEffort!=="low"&&input.reasoningEffort!==configuredEffort)return {ok:false,error:{kind:'KnowledgeModelCommandInvalid',field:'reasoningEffort'}};
      const limit=dependencies.configSnapshots[role].limits.timeoutMs;
      const timeoutMs=input.timeoutMs===undefined?limit:typeof input.timeoutMs==='number'?Math.min(input.timeoutMs,limit):input.timeoutMs;
      return adapter.generate({...input,timeoutMs,...(configuredEffort===undefined?{}:{reasoningEffort:configuredEffort})});
    },
  });
}

/** Classification reuses the configured decision model with a small, low-effort response.
 * @param {Omit<KnowledgeModelDependencies,'model'|'timeoutMs'|'protocol'> & {configuration:Pick<import('../src/features/knowledge-workflows/config.js').AgentConfigurationSnapshot,'model'|'limits'>,protocol?:KnowledgeModelProtocol}} dependencies */
export function createSourceDecisionModel({configuration,protocol,...dependencies}) {
  return createOpenRouterKnowledgeModel({...dependencies,model:configuration.model.name,timeoutMs:configuration.limits.timeoutMs,protocol:protocol===undefined?undefined:{...protocol,reasoningEffort:'low'}});
}
