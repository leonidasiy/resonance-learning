// @ts-check
import { createShellMarkup } from "../../shell-markup.js";
const progressMarkup = createShellMarkup("progress-markup");
import { SUBJECTS } from "../knowledge-subjects/public.js";
import { isProgressSummary } from "./public.js";

/** @param {{readonly fetch:typeof fetch,readonly baseUrl:string,readonly escapeHtml:(value:string)=>string,readonly onChange:()=>void,readonly getSettings?:()=>{dailyStudyTarget:number,dailyRecallLimit:number}|null}} dependencies */
export function createProgressPage({ fetch: request, baseUrl, escapeHtml, onChange, getSettings }) {
  if ([request, escapeHtml, onChange].some(value => typeof value !== "function") || !URL.canParse(baseUrl)) throw new TypeError("Progress page dependencies are invalid.");
  let state = /** @type {{kind:"idle"|"loading"|"ready"|"error",summary:import("./public.js").ProgressSummary|null,message:string,failure:"network"|"timeout"|"malformed"|null}} */({ kind: "idle", summary: null, message: "", failure: null });
  let days = 30, subject = "";
  let generation = 0;
  async function load() {
    const requestGeneration = ++generation;
    state = { ...state, kind: "loading", message: "", failure: null }; onChange();
    const url = new URL("api/learning-generation/progress", baseUrl); url.searchParams.set("days", String(days)); if (subject) url.searchParams.set("subject", subject);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10_000);
    try { const response = await request(url, { headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store", signal: controller.signal }); if (!response.ok) throw new Error("network"); const body = await response.json(); if (!body || !isProgressSummary(body.result)) throw new Error("malformed"); if (requestGeneration === generation) state = { kind: "ready", summary: body.result, message: "", failure: null }; }
    catch (error) { if (!(error instanceof Error)) throw error; if (requestGeneration === generation) { const failure = error instanceof SyntaxError || error.message === "malformed" ? "malformed" : controller.signal.aborted ? "timeout" : "network"; state = { ...state, kind: "error", message: failure === "timeout" ? "Progress took too long to load. Try again." : failure === "malformed" ? "Progress data could not be read. Try again." : "Progress is unavailable right now. Try again.", failure }; } }
    finally { clearTimeout(timer); }
    if (requestGeneration === generation) onChange();
  }
  function render() {
    const e = escapeHtml;
    if (state.kind === "loading" && state.summary === null) return progressMarkup(3);
    if (state.kind === "error" && state.summary === null) return progressMarkup(4, e(state.message));
    const controls = `<form class="progress-controls" data-progress-controls><label>Period<select name="days">${[7,30,90].map(n => `<option value="${n}"${n === days ? " selected" : ""}>${n} days</option>`).join("")}</select></label><label>Primary subject<select name="subject"><option value="">All subjects</option>${SUBJECTS.map(s => `<option value="${e(s.id)}"${s.id === subject ? " selected" : ""}>${e(s.label)}</option>`).join("")}</select></label><button class="button primary">Update</button></form>`;
    if (state.summary === null) return progressMarkup(2, progressMarkup(1), controls);
    const s = state.summary, accuracy = s.attempts.accuracy === null ? "Unavailable" : `${Math.round(s.attempts.accuracy * 100)}%`, score = s.attempts.averageScore === null ? "Unavailable" : `${Math.round(s.attempts.averageScore * 100)}%`;
    const empty = s.attempts.count === 0 ? progressMarkup(0) : "";
    const heading = progressMarkup(1);
    const status = state.kind === "loading" ? '<p role="status">Updating progress…</p>' : state.kind === "error" ? `<p role="alert">${e(state.message)} <button class="button quiet" data-action="retry-progress" type="button">Try again</button></p>` : "";
    const metrics = `<div class="progress-summary"><div><span>Answer accuracy</span><strong>${accuracy}</strong></div><div><span>Average score</span><strong>${score}</strong></div><div><span>Review attempts</span><strong>${s.attempts.count}</strong></div></div>`;
    return `<section class="wide-view progress-page" aria-labelledby="progress-title">${heading}${status}<div class="progress-toolbar"><p class="progress-note">${e(s.period.startedOn)} — ${e(s.period.endedOn)} · UTC</p>${controls}</div>${metrics}${empty}<div class="progress-charts"><div class="progress-timeline">${chart(e,"Daily accuracy",s.daily,"line")}</div><div>${chart(e,"Activity calendar",s.activity,"activity",getSettings?.())}</div><div>${chart(e,"Review accuracy by subject",s.subjects,"subjects")}</div></div></section>`;
  }
  /** @param {HTMLElement} root */
  function bind(root) {
    const form = /** @type {HTMLFormElement|null} */(root.querySelector("[data-progress-controls]"));
    form?.addEventListener("submit", event => { event.preventDefault(); const values = new FormData(form); days = Number(values.get("days")); subject = String(values.get("subject") ?? ""); void load(); }, { once: true });
    root.querySelector("[data-action=retry-progress]")?.addEventListener("click", () => void load(), { once: true });
    for (const plot of root.querySelectorAll("[data-progress-chart]")) {
      const tooltip = /** @type {HTMLElement} */(plot.querySelector("[role=tooltip]"));
      /** @param {Event} event */
      const show = event => {
        const point = event.target instanceof Element ? event.target.closest("[data-chart-value]") : null;
        if (!point) return;
        for (const other of root.querySelectorAll("[role=tooltip]")) /** @type {HTMLElement} */(other).hidden = true;
        tooltip.textContent = point.getAttribute("data-chart-value"); tooltip.hidden = false;
        const anchor = point.getBoundingClientRect(), bounds = plot.getBoundingClientRect();
        tooltip.style.left = `${Math.max(0, Math.min(anchor.left + anchor.width / 2 - bounds.left - tooltip.offsetWidth / 2, bounds.width - tooltip.offsetWidth))}px`;
        tooltip.style.top = `${Math.max(0, (anchor.top >= tooltip.offsetHeight + 8 ? anchor.top - tooltip.offsetHeight - 8 : anchor.bottom + 8) - bounds.top)}px`;
      };
      plot.addEventListener("pointerover", show);
      plot.addEventListener("focusin", show);
      plot.addEventListener("click", show);
      plot.addEventListener("pointerout", event => { if (/** @type {PointerEvent} */(event).pointerType !== "touch") tooltip.hidden = true; });
      plot.addEventListener("focusout", () => { tooltip.hidden = true; });
      plot.addEventListener("scroll", () => { tooltip.hidden = true; }, true);
    }
    root.addEventListener("pointerdown", event => {
      if (event.target instanceof Element && event.target.closest("[data-chart-value]")) return;
      for (const tooltip of root.querySelectorAll("[role=tooltip]")) /** @type {HTMLElement} */(tooltip).hidden = true;
    });
    root.addEventListener("keydown", event => {
      if (event.key === "Escape") for (const tooltip of root.querySelectorAll("[role=tooltip]")) /** @type {HTMLElement} */(tooltip).hidden = true;
    });
  }
  return Object.freeze({ load, render, bind });
}
/** @param {(value:string)=>string} e @param {string} title @param {readonly any[]} rows @param {"line"|"subjects"|"activity"} kind @param {{dailyStudyTarget?:number,dailyRecallLimit?:number}|null} [targets] */
function chart(e, title, rows, kind, targets) {
  /** @param {string} value @param {string} label */
  const point = (value, label) => `tabindex="0" role="img" aria-label="${e(label)}" data-chart-value="${e(value)}"`;
  let marks = "", caption = "", plot = "";
  if (kind === "subjects") {
    plot = rows.length ? `<div class="progress-subject-bars">${rows.map(r => `<div ${point(percent(r.accuracy), `${r.label}: ${percent(r.accuracy)}`)}><span>${e(r.label)}</span>${r.accuracy === null ? '<small>No review attempts</small>' : `<span class="progress-subject-bar" style="--bar-width:${r.accuracy*100}%" aria-hidden="true"></span>`}</div>`).join("")}</div>` : '<p>No classified knowledge points for this selection.</p>';
    caption = "Top 5 by knowledge points.";
  } else if (kind === "activity") {
    const { dailyStudyTarget: learning = 5, dailyRecallLimit: review = 5 } = targets ?? {};
    const offset = (new Date(rows[0].date).getUTCDay() + 6) % 7, columns = Math.ceil((rows.length + offset) / 7);
    marks = rows.map((r,i) => {
      const value = `${r.studyItems} cards · ${r.reviewAttempts} quizzes`;
      return `<g ${point(value, `${r.date}: ${value}`)}><rect x="${8+Math.floor((i+offset)/7)*90/columns}%" y="${8+(i+offset)%7*26}" width="${90/columns-.6}%" height="22" fill="currentColor" opacity="${Math.max(.1, (r.studyItems + r.reviewAttempts) / (learning + review))}"/></g>`;
    }).join("");
    marks += `<g font-size="11" fill="currentColor">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day,i) => `<text x="0" y="${23+i*26}">${day}</text>`).join("")}${Array.from({length:columns},(_,i) => `<text x="${8+(i+.5)*90/columns}%" y="210" text-anchor="middle">${new Date(Date.parse(rows[0].date)+(i*7-offset)*86400000).toISOString().slice(5,10)}</text>`).join("")}</g>`;
    plot = `<div class="progress-plot"><svg height="214" style="min-width:${columns*58+40}px" aria-label="${e(title)} chart">${marks}</svg></div>`;
  } else {
    if (!rows.some(r => r.count > 0)) return progressMarkup(5, e(title), progressMarkup(6));
    const x = (/** @type {number} */ i) => `${(i+2)/(rows.length+3)*100}%`, y = (/** @type {number} */ n) => 135-n*120;
    marks = rows.map((r,i) => `<text x="${x(i)}" y="155" style="transform-origin:${x(i)} 155px;rotate:-60deg">${e(r.date)}</text>`).join("");
    let previous;
    for (let i=0;i<rows.length;i++) {
      const r=rows[i];
      if (r.accuracy === null) continue;
      if (previous != null) marks += `<line x1="${x(previous)}" y1="${y(rows[previous].accuracy)}" x2="${x(i)}" y2="${y(r.accuracy)}" stroke="currentColor" stroke-width="2" pointer-events="none"/>`;
      const value = percent(r.accuracy);
      marks += `<g ${point(value, `${r.date}: ${value}`)}><circle cx="${x(i)}" cy="${y(r.accuracy)}" r="12" opacity="0"/><circle cx="${x(i)}" cy="${y(r.accuracy)}" r="4"/></g>`;
      previous = i;
    }
    marks += '<text x="36" y="20">100%</text><text x="36" y="137">0%</text>';
    plot = `<div class="progress-plot"><svg height="220" font-size="11" fill="currentColor" text-anchor="end" style="min-width:${(rows.length+3)*32}px" aria-label="${e(title)} chart">${marks}</svg></div>`;
  }
  return `<section class="progress-chart" data-progress-chart><h2>${e(title)}</h2>${plot}${caption ? `<p>${e(caption)}</p>` : ""}<div class="progress-tooltip" role="tooltip" hidden></div></section>`;
}
/** @param {number|null} value */
function percent(value) { return value === null ? "Unavailable" : `${Math.round(value * 10000) / 100}%`; }
