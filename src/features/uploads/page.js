// @ts-check
import { loadOptions, saveOptions } from "../experience/options.js";
import { emptyArt } from "../../empty-state.js";
import { createShellMarkup } from "../../shell-markup.js";
import { validatePublisherDestination } from "../source-library/contracts.js";
import { SourceLibraryGatewayClient } from "../source-library/gateway.js";
import { URL_CAPTURE_TYPE } from "../knowledge-workflows/url-capture.js";
/** @typedef {"text"|"documents"|"pdf"|"images"|"link"} UploadInput */
/** @typedef {{readonly title:string,readonly url?:string,readonly manual?:true,readonly reason?:string}} UploadPrefill */
/** @typedef {{readonly source:import('../source-library/contracts.js').LibrarySource,readonly runId:string,readonly reason:string}} UploadContext */
/** @typedef {{readonly storage?:import("../experience/options.js").OptionStorage,readonly onError?:(message:string)=>void,readonly fetch:typeof fetch,readonly baseUrl:string,readonly onChange:()=>void,readonly createId:()=>string,readonly onExtracted?:(sourceId:string)=>void,readonly onRenamed:(sourceId:string,title:string)=>void,readonly upload:(sourceId:string,form:FormData,context:UploadContext|null)=>Promise<{readonly ok:boolean,readonly message:string}>}} UploadDependencies */
/** @param {unknown} value @returns {value is {input:UploadInput,imageProcessing:boolean}} */
function validOptions(value) {
  return typeof value === "object" && value !== null && "input" in value && ["text","documents","pdf","images","link"].includes(/** @type {string} */(value.input)) && "imageProcessing" in value && typeof value.imageProcessing === "boolean";
}
/** @param {UploadDependencies} dependencies */
export function createUploadPage(dependencies) {
  if (
    typeof dependencies?.fetch !== "function" ||
    !URL.canParse(dependencies.baseUrl) ||
    typeof dependencies.onChange !== "function" ||
    typeof dependencies.createId !== "function" ||
    typeof dependencies.upload !== "function" ||
    typeof dependencies.onRenamed !== "function"
  ) throw new TypeError("UploadPageDependenciesInvalid");
  let state = "ready", message = "", generation = 0;
  const optionsKey = "resonance-upload-options";
  const optionError = /** @param {string} error */ error => { if (dependencies.onError) dependencies.onError(error); else message = error; };
  const savedOptions = loadOptions(dependencies.storage, optionsKey, validOptions, optionError);
  /** @type {UploadInput} */ let input = savedOptions?.input ?? "text";
  let preferredInput = input;
  let imageProcessing = savedOptions?.imageProcessing ?? false;
  let title = "";
  let prefillReason = "", prefillUrl = "";
  let draft = new FormData();
  let busy = false;
  const gateway = new SourceLibraryGatewayClient({
    fetch: dependencies.fetch,
    baseUrl: dependencies.baseUrl,
    timeoutMs: 4_000,
  });
  /** @type {UploadContext|null} */ let context = null;
  /** @type {{fingerprint:string,key:string}|null} */ let renameAttempt = null;
  /** Keep in memory only; uploaded content never enters storage or the URL. @param {FormData} form */
  function remember(form) {
    if (!(form instanceof FormData)) throw new TypeError("UploadDraftInvalid");
    if (
      input !== "text" && input !== "link" &&
      !form.getAll("file").some((value) =>
        value instanceof File && value.size > 0
      )
    ) {
      const retained = draft.getAll("file").filter((value) =>
        value instanceof File && value.size > 0
      );
      if (retained.length) {
        form.delete("file");
        for (const file of retained) form.append("file", file);
      }
    }
    if (
      (input === "images" || input === "pdf") && !form.has("imageProcessing")
    ) form.set("imageProcessing", "off");
    if (input === "pdf") {
      imageProcessing = form.get("imageProcessing") === "on";
      persistOptions();
    }
    draft = form;
    const value = form.get("title");
    if (typeof value === "string") title = value;
  }
  /** @param {FormData} form */
  async function submit(form) {
    if (busy || state !== "ready") return false;
    if (!(form instanceof FormData)) throw new TypeError("UploadDraftInvalid");
    if (input === "link") return submitLink(form);
    const selected = new FormData();
    for (
      const key of [
        "title",
        ...(input === "text" ? ["content"] : ["file"]),
        ...(input === "pdf"
          ? ["pageRange", "imageProcessing"]
          : input === "images"
          ? ["imageProcessing"]
          : []),
      ]
    ) {
      for (const value of form.getAll(key)) selected.append(key, value);
    }
    if (input === "images") selected.set("imageProcessing", "on");
    if (context === null && prefillUrl) selected.set("url", prefillUrl);
    form = selected;
    remember(form);
    if (
      (!title.trim() && (context !== null || input === "text")) ||
      title.trim().length > 300
    ) {
      message = shellMarkup(11);
      dependencies.onChange();
      return false;
    }
    const files = form.getAll("file").filter((value) =>
      value instanceof File && value.size > 0
    );
    const supported = input === "documents"
      ? /\.(txt|md|pptx)$/iu
      : input === "pdf"
      ? /\.pdf$/iu
      : /\.(png|jpe?g|webp|gif)$/iu;
    if (
      input !== "text" &&
      (files.length === 0 ||
        files.some((file) =>
          !supported.test(/** @type {File} */ (file).name)
        ) || input !== "images" && files.length !== 1)
    ) {
      message = shellMarkup(12);
      dependencies.onChange();
      return false;
    }
    if (input === "text" && !String(form.get("content") ?? "").trim()) {
      message = shellMarkup(13);
      dependencies.onChange();
      return false;
    }
    const current = generation;
    if (context !== null && !await saveTitle(form)) return false;
    if (generation !== current) return false;
    busy = true;
    dependencies.onChange();
    try {
      const result = await dependencies.upload(
        context?.source.id ?? "",
        form,
        context,
      );
      if (generation !== current) return false;
      message = result.ok
        ? result.message
        : `${
          context === null ? "" : "Title saved. "
        }Upload failed: ${result.message} Your draft is ready to retry.`;
      return result.ok;
    } finally {
      busy = false;
      dependencies.onChange();
    }
  }
  /** @param {FormData} form */
  async function submitLink(form) {
    remember(form);
    const url = String(form.get("url") ?? "").trim();
    if (!title.trim() || title.trim().length > 300 || !validatePublisherDestination(url).ok) {
      message = shellMarkup(31,"title or URL");dependencies.onChange();return false;
    }
    const current=generation;busy=true;message=shellMarkup(35);dependencies.onChange();
    try {
      const response=await (0,dependencies.fetch)(new URL("api/source-library/url-capture",dependencies.baseUrl),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url}),signal:AbortSignal.timeout(65_000)});
      if(current!==generation)return false;
      if(!response.ok){
        const failure=await response.json();
        message=shellMarkup(32,linkFailureMessage(response.status===401?{kind:"SourceGatewayUnauthenticated"}:response.status===403?{kind:"SourceGatewayUnauthorized"}:{kind:"SourceGatewayRejected",failureKind:typeof failure?.error==="string"?failure.error:"unknown"}));return false;
      }
      const contentType=response.headers.get("content-type")?.split(';')[0];
      if(contentType!=="application/pdf"&&contentType!==URL_CAPTURE_TYPE){message=shellMarkup(50);return false;}
      const material=new FormData();material.set("title",title);material.set("url",url);
      material.set("file",new File([await response.blob()],`${url} — captured page.${contentType===URL_CAPTURE_TYPE?'pkpc':'pdf'}`,{type:contentType}));material.set("imageProcessing","off");
      if(context!==null && !await saveTitle(form))return false;
      const result=await dependencies.upload(context?.source.id??"",material,context);
      if(current!==generation)return false;
      message=result.message;
      if(result.ok)dependencies.onExtracted?.(context?.source.id??"");
      return result.ok;
    } catch(error) {
      message=shellMarkup(32,linkFailureMessage({kind:error instanceof Error&&error.name==="TimeoutError"?"SourceGatewayTimedOut":"SourceGatewayUnavailable"}));return false;
    } finally {busy=false;dependencies.onChange();}
  }

  /** @param {FormData} form */
  async function saveTitle(form) {
    if (!(form instanceof FormData) || state !== "ready" || context === null) {
      return false;
    }
    const value = form.get("title");
    if (
      typeof value !== "string" || !value.trim() || value.trim().length > 300
    ) {
      message = shellMarkup(15);
      dependencies.onChange();
      return false;
    }
    title = value.trim();
    if (title === context.source.title) return true;
    const fingerprint = JSON.stringify([
      context.source.id,
      context.runId,
      context.source.revision,
      context.source.title,
      title,
    ]);
    if (renameAttempt?.fingerprint !== fingerprint) {
      renameAttempt = { fingerprint, key: `rename:${dependencies.createId()}` };
    }
    const current = generation;
    const bound = context;
    const result = await gateway.rename({
      sourceId: context.source.id,
      runId: context.runId,
      expectedRevision: context.source.revision,
      expectedTitle: context.source.title,
      title,
      idempotencyKey: renameAttempt.key,
    });
    if (generation !== current) {
      if (result.ok) {
        dependencies.onRenamed(bound.source.id, result.value.title);
      }
      return false;
    }
    if (!result.ok) {
      if (
        result.error.kind === "SourceGatewayRejected" &&
          ["SourceRenameConflict", "SourceUploadContextUnavailable"].includes(
            result.error.failureKind,
          ) ||
        result.error.kind === "SourceGatewayUnauthorized" ||
        result.error.kind === "SourceGatewayUnauthenticated"
      ) state = "unavailable";
      message =
        shellMarkup(16);
      dependencies.onChange();
      return false;
    }
    context = {
      ...context,
      source: { ...context.source, title: result.value.title },
    };
    dependencies.onRenamed(context.source.id, context.source.title);
    renameAttempt = null;
    dependencies.onChange();
    return true;
  }
  /** @param {string} hash @param {UploadPrefill|null} [prefill] */
  async function load(hash, prefill = null) {
    if (typeof hash !== "string" || prefill !== null &&
      (hash !== "#upload" || typeof prefill.title !== "string" || !prefill.title.trim() ||
        prefill.url !== undefined && !validatePublisherDestination(prefill.url).ok || prefill.manual !== undefined && prefill.manual !== true || prefill.reason !== undefined && (typeof prefill.reason !== "string" || !prefill.reason.trim()))) {
      throw new TypeError("UploadPrefillInvalid");
    }
    const current = ++generation;
    context = null;
    draft = new FormData();
    input = prefill ? "text" : preferredInput;
    renameAttempt = null;
    title = prefill?.title ?? "";
    prefillUrl = prefill?.url ?? "";
    if(prefill?.url){input=prefill.manual?"text":"link";draft.set("url",prefill.url);}
    prefillReason = prefill?.reason ?? "";
    message = "";
    const [route, query] = hash.split("?");
    if (route !== "#upload") {
      state = "unavailable";
      dependencies.onChange();
      return false;
    }
    if (query === undefined) {
      state = "ready";
      dependencies.onChange();
      return true;
    }
    const params = new URLSearchParams(query);
    const sourceId = params.get("sourceId"), runId = params.get("runId");
    if (
      !sourceId?.trim() || !runId?.trim() ||
      params.getAll("sourceId").length !== 1 ||
      params.getAll("runId").length !== 1
    ) {
      state = "unavailable";
      dependencies.onChange();
      return false;
    }
    state = "loading";
    dependencies.onChange();
    const result = await gateway.uploadContext({ sourceId, runId });
    if (generation !== current) return false;
    if (!result.ok) {
      state = "unavailable";
      message =
        shellMarkup(18);
    } else {
      context = result.value;
      title = context.source.title;
      if(context.source.origin==="web"&&!/audio|video|episode/u.test(context.source.adapter.granularity)){input="link";draft.set("url",context.source.canonicalUrl);}
      state = "ready";
    }
    dependencies.onChange();
    return result.ok;
  }
  /** @param {string} value */
  async function select(value) {
    if (
      !["text", "documents", "pdf", "images", "link"].includes(value)
    ) throw new TypeError("UploadInputInvalid");
    if (input !== value) {
      for (const key of ["content", "file", "pageRange", "imageProcessing", "url", "interest-area"]) {
        draft.delete(key);
      }
    }
    input = /** @type {UploadInput} */ (value);
    preferredInput = input;
    persistOptions();
    dependencies.onChange();
  }

  function persistOptions() {
    saveOptions(dependencies.storage, optionsKey, {input:preferredInput,imageProcessing}, optionError);
  }

  function render() {
    if (state === "loading") {
      return shellMarkup(0);
    }
    if (state === "unavailable") {
      return shellMarkup(1, escape(
          message ||
            shellMarkup(19),
        ));
    }
    const files = draft.getAll("file").filter((value) =>
      value instanceof File && value.size > 0
    );
    const control = input === "link"
      ? shellMarkup(29,escape(String(draft.get("url")??context?.source.canonicalUrl??prefillUrl)))
      : input === "text"
      ? shellMarkup(2, escape(String(draft.get("content") ?? "")))
      : shellMarkup(3, shellMarkup(input === "documents" ? 21 : input === "pdf" ? 22 : 23), input === "images" ? "multiple" : "", input === "documents"
          ? ".txt,.md,.pptx"
          : input === "pdf"
          ? ".pdf"
          : ".png,.jpg,.jpeg,.webp,.gif", files.length ? "" : " required");
    const reason = context?.reason ?? prefillReason;
    return shellMarkup(5, (!files.length && !String(draft.get("content") ?? draft.get("url") ?? "").trim() ? emptyArt("upload") : "") + (reason ? shellMarkup(6, escape(reason)) : "") + (prefillUrl && input === "text" ? shellMarkup(59, escape(prefillUrl)) : ""), escape(context?.source.id ?? ""), busy, escape(title), context !== null || input === "text" || input === "link" ? " required" : "", ["text", "documents", "pdf", "images", "link"].map((value, index) =>
        shellMarkup(24 + index, input === value ? " selected" : "")
      ).join(""), control, input === "pdf"
        ? shellMarkup(8, draft.has("imageProcessing")
            ? draft.get("imageProcessing") === "on" ? " checked" : ""
            : imageProcessing ? " checked" : "")
        : "", input === "pdf"
        ? shellMarkup(9, escape(String(draft.get("pageRange") ?? "")))
        : "", shellMarkup(input === "link" ? 37 : 38), busy ? " disabled" : "", busy ? input === "link" ? shellMarkup(35) : "Uploading…" : input === "link" ? shellMarkup(36) : shellMarkup(20), escape(message));
  }
  /** @param {HTMLElement} root */
  function bind(root) {
    const form = /** @type {HTMLFormElement|null} */ (root.querySelector(
      "[data-upload-form]",
    ));
    if (form === null) return;
    const choice = /** @type {HTMLSelectElement|null} */ (root.querySelector(
      "[data-upload-input]",
    ));
    form.addEventListener("input", () => remember(new FormData(form)));
    form.addEventListener("change", (event) => {
      if (event.target !== choice) remember(new FormData(form));
      if (event.target === form.querySelector('[name="file"]')) dependencies.onChange();
    });
    choice?.addEventListener("change", () => {
      void select(choice.value);
      /** @type {HTMLSelectElement|null} */ (root.querySelector(
        "[data-upload-input]",
      ))?.focus();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submit(new FormData(form));
    });
  }
  return Object.freeze({
    select,
    render,
    load,
    submit,
    remember,
    bind,
  });
}
/** @param {string} value */
function escape(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  ).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const shellMarkup = createShellMarkup("upload-markup");

/** Project known typed failures to copy; retain gateway/server diagnostics internally.
 * @param {import("../source-library/gateway.js").SourceGatewayFailure} error */
function linkFailureMessage(error) {
  /** @type {Record<string,number>} */
  const messages = JSON.parse(shellMarkup(54));
  const kind = error.kind === "SourceGatewayRejected" ? `rejected.${error.failureKind}` : error.kind;
  return shellMarkup(Object.hasOwn(messages,kind) ? messages[kind] : 49);
}
