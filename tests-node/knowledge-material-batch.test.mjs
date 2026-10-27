import {syntheticAssessment,syntheticReviewAudit} from './fixtures/knowledge-review-audit.mjs';
import { WEBPAGE_IMAGE_POLICY } from '../worker/webpage-image-budget.js';
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createKnowledgeWorkflowRuntime } from "../worker/knowledge-workflow-runtime.js";
import { createKnowledgeWorkflowService } from "../src/features/knowledge-workflows/workflow.js";
import { createAgentConfigurationLoader } from "../src/features/knowledge-workflows/config.js";
import { D1QuizRepository, D1KnowledgeContentRepository } from "../worker/knowledge-workflow-content-d1.js";
import { D1KnowledgeWorkflowRepository } from "../worker/knowledge-workflow-d1.js";
import { D1KnowledgeWorkflowMaterialRepository } from "../worker/knowledge-workflow-material-d1.js";
import { parseAuthorizedMaterial } from "../src/features/knowledge-workflows/material.js";
import { packUrlCapture, URL_CAPTURE_TYPE } from "../src/features/knowledge-workflows/url-capture.js";
import { packImageBundle, BUNDLE_TYPE } from "../src/features/knowledge-workflows/image-upload.js";
import { createRenderer } from "../acquisition/renderer.ts";
import { ACQUISITION_POLICY } from "../worker/acquisition-policy.js";

test("production upload runtime resumes text batches and processes selected PDF page images with observation, extraction and source review", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const migrations = new URL("../worker/migrations/", import.meta.url);
    for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) db.exec(await readFile(new URL(file, migrations), "utf8"));
    let interruptCheckpoint = true;
    const evidenceReads=new Map();
    const database = {
      prepare(query) {
        let values = [];
        const execute = () => {
          if (interruptCheckpoint && query.startsWith("INSERT INTO extraction_scratchpads") && JSON.parse(values[5]).processedUrls.length === 1) {
            interruptCheckpoint = false;
            return { success: false, meta: { changes: 0 } };
          }
          const result = db.prepare(query).run(...values);
          return { success: true, meta: { changes: Number(result.changes) } };
        };
        return { bind(...bindings) { values = bindings; return this; }, async first() { if(query.startsWith("SELECT evidence_json,evidence_digest")){const key=values[1]+":"+values[2];evidenceReads.set(key,(evidenceReads.get(key)??0)+1);}return db.prepare(query).get(...values) ?? null; }, async all() { return { success: true, results: db.prepare(query).all(...values) }; }, async run() { return execute(); }, execute };
      },
      async batch(statements) {
        db.exec("BEGIN IMMEDIATE");
        try { const results = statements.map((statement) => statement.execute()); db.exec("COMMIT"); return results; }
        catch (error) { db.exec("ROLLBACK"); throw error; }
      },
    };
    const unwrap = (result) => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value; };
    const metricLogs=[];
    const logger = entry => metricLogs.push(entry);
    const clock = () => new Date().toISOString();
    const ownerId = "batch-owner", runId = "batch-run", sourceId = "batch-source", sourceUrl = "https://example.test/lesson.pdf";
    const repository = new D1KnowledgeWorkflowRepository({ database, logger });
    const materials = new D1KnowledgeWorkflowMaterialRepository({ database, logger });
    const service = createKnowledgeWorkflowService(repository, { now: clock, createId: () => runId, logger });
    const loader = createAgentConfigurationLoader({ sha256: async (value) => `sha256:${createHash("sha256").update(value).digest("hex")}` });
    const configs = {};
    for (const role of ["rights-assessor", "knowledge-scraper", "question-generator", "question-evaluator"]) configs[role] = unwrap(await loader.load({ source: (await readFile(new URL(`../agent-config/${role}.yaml`, import.meta.url), "utf8")).replace(/name: [^\n]+/, `name: synthetic/${role}`), expectedRole: role }));
    const sections = Array.from({ length: 7 }, (_, index) => ({ id: `page-${index + 1}`, title: `Page ${index + 1}`, locator: `page:${index + 1}`, text: index === 1 ? "" : `Synthetic source relationship ${index + 1}.` }));
    const material = { ownerId, runId, sourceId, sourceRevision: 1, sourceUrl, mediaType: "application/pdf", fileName: "synthetic.pdf", contentDigest: "sha256:synthetic", sections, media: [], provenance: { kind: "authorized-user-material", attestationReference: "synthetic-test", basis: "test-owned", processingAllowed: true } };
    let run = unwrap(await service.createRun({ ownerId, sourceId, sourceRevision: 1, canonicalSourceIdentity: sourceUrl, contentSignature: material.contentDigest, idempotencyKey: runId, sourceOrigin: "private-document", configDigests: Object.fromEntries(Object.entries(configs).map(([role, config]) => [role, config.digest])) })).run;
    unwrap(await materials.persist({ ownerId, runId, materialId: "batch-material", idempotencyKey: runId, fingerprint: material.contentDigest, objectKey: "synthetic-only", material, createdAt: clock() }));
    run = unwrap(await service.attachMaterial({ ownerId, runId, materialId: "batch-material" }));
    db.prepare("INSERT INTO library_sources (owner_id,source_id,submitted_url,canonical_url,title,description,adapter_json,identity_evidence_json,state,approved_at,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(ownerId, sourceId, sourceUrl, sourceUrl, "Synthetic source", "Offline batching fixture", JSON.stringify({ kind: "private-document" }), "[]", "active", clock(), clock(), 1);
    const batchSizes = [];
    const imageBatchSizes = [];
    const imageObservationSizes = [];
    const materialReviews = [];
    const qualityReviews = [];
    let activeParallelReviews=0,maximumParallelReviews=0,parallelSelections=0;
    let captionCalls=0, decisionCalls=0, decisionRefused=false;
    let activeDrafts=0,maximumDrafts=0,draftOrdinal=0,reviewOverlappedDraft=false;
    let allowQuizRecovery=false,failedQuizReviews=0,recoveredDrafts=0;
    let modelCalls = 0; let invalidPairedDraftInjected = false, pairedFeedbackSeen = false;
    const transport = async (_url, init) => {
      assert(++modelCalls < 180, "Bound the synthetic model fixture, including coverage and answer-importance audits.");
      const body = JSON.parse(init.body);
      if(String(_url).endsWith('/alpha/decisions')){
        decisionCalls++;assert.equal(db.prepare("SELECT COUNT(*) n FROM extraction_knowledge_points WHERE run_id='capture-run'").get().n,2,'Association waits for all text points');
        assert.deepEqual(Object.keys(body.state.knowledge),['point_0','point_1']);assert.equal(body.model,'~typesafe/jev-latest');
        if(!decisionRefused){decisionRefused=true;return new Response('',{status:429});}
        const scores=body.state.image.description.includes('image:2')?[0.95,0.79]:[0.85,0.1];
        return Response.json({model:'typesafe/jev-1.13',answers:{point_0:{type:'noul',noul:scores[0]},point_1:{type:'noul',noul:scores[1]}}});
      }
      const message = body.messages[1].content;
      const envelope = Array.isArray(message) ? message[0].text : message;
      const modelInput = JSON.parse(envelope.slice(envelope.indexOf("\n") + 1, envelope.lastIndexOf("\n")));
      const task = modelInput.task ?? modelInput;
      const config = configs[task.source && task.points || task.operation==='caption-captured-image' ? "rights-assessor" : modelInput.contract.role];
      assert.equal(body.model,config.model.name);
      assert.deepEqual(body.reasoning, { effort: task.source && task.points || body.response_format?.json_schema?.name==='captured_image_caption_v1' ? "low" : config.model.reasoningEffort });
      if(body.response_format?.json_schema?.name==='quiz_evaluation_v3'){
        if(task.knowledge.sourceId==='capture-source'&&task.knowledge.mediaCandidates.length){assert.equal(task.imagePurpose,'illustration');assert.match(body.messages[0].content,/Missing depiction alone is not an unpictured knowledge fault/);}
        assert.equal(body.max_tokens,2048);assert.equal(modelInput.contract.role,'question-evaluator');
        assert.match(body.messages[0].content,/paired-question-evaluator-v13/);
        assert.match(body.messages[0].content,/A faithful narrower relationship need not restore an unrelated or nonessential removed qualifier/);
        assert.match(body.messages[0].content,/Conditions, negations, units and causal qualifications necessary to preserve that relationship remain required/);
        assert.match(body.messages[0].content,/entire retained knowledge.summary/);
        assert.match(body.messages[0].content,/Quiz regeneration changes only the quiz/);
        assert(body.response_format.json_schema.schema.required.includes('knowledgeGroundingProblems'));
      }
      if(body.response_format?.json_schema?.name==='paired_quiz_v4'){
        assert.match(body.messages[0].content,/Unicode NFKC normalization, trimming, case folding, and collapsing whitespace/);
        assert.match(body.messages[0].content,/exact canonical answer alone is sufficient/);
        assert.match(body.messages[0].content,/Synonyms are optional/);
        assert.match(body.response_format.json_schema.schema.properties.fillBlank.properties.blanks.items.properties.acceptedAnswers.description,/exact canonical answer alone is sufficient/);
        assert.match(body.response_format.json_schema.schema.properties.fillBlank.properties.blanks.items.properties.acceptedAnswers.description,/unique after Unicode NFKC/);
      }
      let output;
      if(body.response_format?.json_schema?.name==='captured_image_caption_v1'){
        captionCalls++;assert.equal(db.prepare("SELECT COUNT(*) n FROM extraction_knowledge_points WHERE run_id='capture-run'").get().n,2);assert(!task.knowledge,'Caption has no knowledge to force-fit');assert.equal(message[2].type,'image_url');output={description:`Fixture original ${task.imageId}`,visibleText:'Q K V'};if(captionCalls===1)output.extra='invalid';
      } else if(body.response_format?.json_schema?.name==='webpage_image_purpose_v1')output={purpose:'illustration',imageId:task.imageId,imageDigest:task.imageDigest,visibleEvidence:'Synthetic original figure context.'};
      else if (body.response_format?.json_schema?.name==='knowledge_batch_selection_v1') {
        assert.equal(modelInput.contract.role,'question-evaluator');
        assert(Array.isArray(task.previousKnowledge)&&Array.isArray(task.previousQuizzes));
        if(task.points.some(point=>point.summary.startsWith('Parallel fixture'))){parallelSelections++;assert.equal(activeParallelReviews,0);assert.equal(task.points.length,3);}
        output={keptKnowledgeIds:task.points.map(point=>point.id)};
      }
      else if (body.response_format?.json_schema?.name==='knowledge_quality_review_v11') {
        if(task.knowledge.summary.startsWith('Parallel fixture')){activeParallelReviews++;maximumParallelReviews=Math.max(maximumParallelReviews,activeParallelReviews);await new Promise(resolve=>setTimeout(resolve,10));activeParallelReviews--;}
        qualityReviews.push(task.sourceMode);
        assert.equal(modelInput.contract.role,'question-evaluator');
        assert(task.sourceEvidence.sections.some(section=>section.locator===task.knowledge.evidenceAnchors[0].selector));
        output={decision:'pass',reasons:['Synthetic source/pixel review fixture.'],feedback:'Accepted fixture.',matchedLessOftenIds:[],supportingImageEvidence:task.sourceMode==='image'?'Synthetic pixel cue for the fixture.':'',allowTextOnly:task.sourceMode==='text'};output=syntheticAssessment(task,output);
      } else if (task.source && task.points) output = { mainSubject: "music", topic: "Synthetic source relationships" };
      else if (task.operation === "plan-authorized-material" || task.operation === "replan-authorized-material") {
        // The application restores the complete inventory instead of asking the model to copy it.
        assert(body.messages[0].content.includes('return frontier:[]'));
        assert.equal(body.max_tokens,2048);
        output = { revision: 1, frontier: [], coverageGoals: [], unresolvedGaps: [], stopDecision: { decision: "continue", rationale: "Observe supplied inventory.", evidenceUrls: [], unresolvedGapIds: [] } };
        assert.equal(task.scratchpad.pendingBatch, undefined);
      } else if (task.operation === 'extract-webpage-facts') {
        batchSizes.push(1);
        assert.equal(typeof message,'string','Uploaded text never travels as pixels');
        output={notes:'Synthetic text coverage.',candidates:task.sourceBlocks.flatMap(block=>Array.from({length:block.sectionId==='parallel-page'?3:1},(_,index)=>({summary:block.sectionId==='parallel-page'?`Parallel fixture relationship ${index}`:block.text,normalizedHash:block.sectionId==='parallel-page'?`parallel-${index}`:block.id,coverageGoalIds:[],mediaCandidates:[],evidenceAnchors:[{reference:block.citationReference,clause:block.text}]})))};
      } else if (task.operation === 'normalize-webpage-claim-boundaries') {
        output={notes:'Synthetic complete text audit.',reviews:task.candidates.map(c=>({sourceNormalizedHash:c.normalizedHash,relationshipUnits:[{condition:null,relationship:c.summary,childNormalizedHash:c.normalizedHash}],candidates:null})),additionalCandidates:[],blockCoverage:task.sourceBlocks.map(b=>({blockId:b.id,disposition:'candidates',candidateHashes:task.candidates.filter(c=>c.evidenceAnchors.some(a=>a.reference.id===b.citationReference.id)).map(c=>c.normalizedHash),reason:'Synthetic supported text relationship.'}))};
      } else if (task.operation === 'audit-material-image-coverage') {
        output={observationCoverage:task.visualObservations.observations.map(o=>({observationId:o.id,disposition:'candidates',candidateHashes:task.candidates.map(c=>c.normalizedHash),reason:'Synthetic observed pixel relationship.'})),additionalCandidates:[]};
      } else if (task.pairedQuiz) {
        output={targets:task.pairedQuiz.canonicalAnswers.map(answer=>({answer,important:true,reason:'Synthetic central answer.'})),feedback:'Accepted fixture targets.'};
      } else if (task.operation === "review-material-source") {
        materialReviews.push(task.mode);
        assert.equal(body.response_format.type, "json_object");
        output = { notes: "Synthetic source review.", reviews: task.candidates.map(candidate => ({ candidateIndex: candidate.candidateIndex, points: [{ summary: candidate.summary, visibleEvidence: candidate.evidenceAnchors[0].visibleEvidence ?? "Synthetic source relationship." }] })) };
      } else if (task.sections) {
        if (task.mode === "image") {
          (task.operation === "observe-material-image" ? imageObservationSizes : imageBatchSizes).push(task.sections.length);
          assert.equal(message.length, 3);
          assert.equal(message[1].type, "text");
          assert.equal(message[1].text, `Attachment ID: visual:${imageMaterial.contentDigest}:${task.sections[0].id}; mediaType: image/png. The following image belongs only to this ID.`);
          assert.equal(message[2].type, "image_url");
          assert.equal(message[2].image_url.url, `data:image/png;base64,${Buffer.from(png).toString("base64")}`);
        } else {batchSizes.push(task.sections.length);assert.equal(typeof message,'string','PDF text never travels as an image');}
        assert.equal(body.max_tokens, 16384);
        if (task.operation !== "observe-material-image") assert(body.messages[0].content.includes("selection-v3"));
        if (task.mode === "image") {
          if (task.operation !== "observe-material-image") {
            assert.match(body.messages[0].content, /first identify the named curve pair/);
            assert.deepEqual(task.visualObservations, { notes: "Synthetic observation.", observations: [{ id: "observed-1", description: "Two cases are labeled." }] });
          }
          assert.equal(body.response_format.type, "json_schema");
          assert.equal(body.response_format.json_schema.strict, true);
          if (task.operation !== "observe-material-image") assert.match(body.response_format.json_schema.schema.properties.candidates.items.properties.visibleEvidence.description, /actual curve pair/);
          else assert.equal(body.response_format.json_schema.name, "material_image_observation_v1");
          assert.equal(body.provider.require_parameters, true);
          assert.equal(body.provider.sort, "throughput");
        } else {
          assert.equal(body.response_format.type, "json_schema");
          assert.equal(body.response_format.json_schema.name, "material_text_v1");
          assert.equal(body.response_format.json_schema.strict, true);
          assert.match(body.messages[0].content, /# PDF text scope/);
          assert(task.sections.every(section => section.textIntegrity.replacementCharacterCount === 0));
          assert.doesNotMatch(body.messages[0].content, /Aim for 30–80 words/);
        }
        output = task.operation === "observe-material-image"
          ? { notes: "Synthetic observation.", observations: [{ id: "observed-1", description: "Two cases are labeled." }] }
          : task.mode === "image"
          ? { notes: "Synthetic concise progress.", candidates: [{ summary: "The figure distinguishes two cases.", visibleEvidence: "Two cases are labeled in the figure.", normalizedHash: `fixture-image-${imageBatchSizes.length}`, coverageGoalIds: [] }] }
          : { pages: task.sections.map((section) => ({ url: section.url, notes: "Synthetic concise progress.", candidates: section.text === "" ? [] : [{ summary: section.text, normalizedHash: section.id, evidenceAnchors: [{ url: section.url, selector: section.locator }], coverageGoalIds: [], mediaCandidates: [] }] })) };
        if(task.sections[0]?.id==='parallel-page')output.pages[0].candidates=Array.from({length:3},(_,i)=>({...output.pages[0].candidates[0],summary:`Parallel fixture relationship ${i}`,normalizedHash:`parallel-${i}`}));
      } else if (task.source && task.points) output = { mainSubject: "music", topic: "Synthetic material" };
      else if (task.draft) {
        reviewOverlappedDraft ||= activeDrafts>0;
        const committed=db.prepare("SELECT COUNT(*) n FROM knowledge_workflow_quizzes WHERE source_id=(SELECT source_id FROM extraction_knowledge_points WHERE knowledge_id=? LIMIT 1)").get(task.knowledge.id).n;
        assert.equal(task.previousQuizzes.length,committed,"Review must see earlier committed quizzes, not the prefetched draft's stale context");
        output = { score: 9, reasons: ["Synthetic fixture"], feedback: "Accepted fixture", groundingProblems: [], knowledgeGroundingProblems: [] };
        if(task.knowledge.summary==='Parallel fixture relationship 0') {
          failedQuizReviews++;
          if(!allowQuizRecovery)output.score=11;
        }
      }
      else if (task.knowledge) output = { knowledgeId: task.knowledge.id, knowledgeRevision: task.knowledge.sourceRevision, canonicalAnswers: ["fixture"], citedEvidenceUrls: task.knowledge.evidenceAnchors.map((anchor) => anchor.url), multipleChoice: { prompt: `Which fixture belongs to ${task.knowledge.normalizedHash}?`, options: [{ key: "choice-a", text: "Fixture" }, { key: "choice-b", text: "Other" }], correctOptionKeys: ["choice-a"], correctOptionAnswers: [{ key: "choice-a", canonicalAnswer: "fixture" }], explanation: "Fixture is supported by the source." }, fillBlank: { prompt: "The supported answer is ____.", blanks: [{ id: "blank-1", canonicalAnswer: "fixture", acceptedAnswers: ["fixture"] }], explanation: "Fixture is supported by the source." } };
      else assert.fail("Unexpected synthetic model task");
      if(body.response_format?.json_schema?.name === "paired_quiz_v4") {
        if(task.knowledge.summary==='Parallel fixture relationship 0')recoveredDrafts++;
        activeDrafts++;maximumDrafts=Math.max(maximumDrafts,activeDrafts);
        try { await new Promise(resolve=>setTimeout(resolve,20*(++draftOrdinal%3+1))); }
        finally {activeDrafts--;}
        if (!invalidPairedDraftInjected) { invalidPairedDraftInjected=true; output.fillBlank.blanks[0].canonicalAnswer="other";output.fillBlank.blanks[0].acceptedAnswers=["other","ＯＴＨＥＲ"]; }
        else if(task.feedback?.includes("Paired-quiz validation issues")) { pairedFeedbackSeen=true;assert.match(task.feedback,/canonicalAnswer:/);assert.match(task.feedback,/acceptedAnswers\[0\]:/);assert.match(task.feedback,/NFKC-equivalent/);assert.equal(task.attempt,1,"Schema correction retains its quality attempt");assert(task.sourceEvidence.sections.length>0); }
      }
      return Response.json({ id: `fixture-${modelCalls}`, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } });
    };
    const forbidden = async () => { assert.fail("Uploads must not use browser acquisition."); };
    let sawInterruption = false;
    const quizChunkSizes=[];
    const extractionClock=run.extractionDeadlineAt;
    for (let step = 0; step < 16 && run.state !== "completed"; step++) {
      if (run.state === "awaiting-time-limit-decision") run = unwrap(await service.advance({ ownerId, runId, expectedRevision: run.revision, nextState: "extraction-loop" }));
      const runtime = createKnowledgeWorkflowRuntime({imagePolicy:WEBPAGE_IMAGE_POLICY, database, fetch: transport, browser: { readPage: forbidden, readRobots: forbidden, screenshot: forbidden, close: async () => ({ ok: true, value: null }) }, apiKey: "offline-fixture", endpoint: "https://example.test/model", now: clock, nowMs: Date.now, logger, configSnapshots: configs, imageSearch: { search: async () => assert.fail("Do not search for decorative images.") }, fallbackManifest: { entries: [], resolve: () => assert.fail("Do not attach a fallback to a text point.") }, material: materials, transition: ({ run: current, nextState, ...rest }) => service.advance({ ownerId, runId, expectedRevision: current.revision, nextState, ...rest }) });
      const beforeQuiz=db.prepare("SELECT COUNT(*) count FROM knowledge_workflow_stages WHERE run_id=? AND stage_key LIKE 'quiz-point-completed:%' AND status='completed'").get(runId).count;
      if (step === 0) {
        const callsBefore = modelCalls;
        for (const state of ["paused", "awaiting-time-limit-decision", "retryable-failure"]) {
          const held = { ...run, state };
          assert.deepEqual(await runtime.execute(held), { ok: true, value: { state, run: held } });
        }
        assert.equal(modelCalls, callsBefore, "A recreated held workflow waits for control without paid work.");
        assert.deepEqual(unwrap(await repository.findById(ownerId, runId)), run);
      }
      const executed = await runtime.execute(run);
      if (!executed.ok) {
        assert.equal(sawInterruption, false, JSON.stringify(executed.error));
        assert(JSON.stringify(executed.error).includes("ScratchpadPersistenceFailed"), JSON.stringify(executed.error));
        sawInterruption = true;
      }
      run = unwrap(await repository.findById(ownerId, runId));
      const afterQuiz=db.prepare("SELECT COUNT(*) count FROM knowledge_workflow_stages WHERE run_id=? AND stage_key LIKE 'quiz-point-completed:%' AND status='completed'").get(runId).count;
      assert(maximumDrafts<=3,"Durable chunks preserve the three-draft concurrency ceiling");
      if(afterQuiz>beforeQuiz)quizChunkSizes.push(afterQuiz-beforeQuiz);
      assert.equal(run.extractionDeadlineAt,extractionClock);
    }
    assert.equal(sawInterruption, true);assert.equal(pairedFeedbackSeen,true);
    assert.equal(run.state, "completed");
    assert.deepEqual(batchSizes, sections.filter(section=>section.text.trim()).map(()=>1));
    assert.equal(run.counts.pages, 7);
    assert.equal(run.counts.knowledgePoints, 6);
    assert.equal(run.counts.acceptedQuizzes, 6);
    assert.deepEqual(quizChunkSizes,[3,3],"Checkpoint each three-draft chunk before starting more work");
    assert.equal([...evidenceReads.entries()].filter(([key])=>key.startsWith(runId+':')).length,6);
    assert([...evidenceReads.entries()].filter(([key])=>key.startsWith(runId+':')).every(([,count])=>count===1),'Generation, schema repair and review reuse immutable evidence');
    assert(metricLogs.some(e=>e.event==='workflow-first-usable-quiz'&&e.runId===runId));
    assert(metricLogs.some(e=>e.event==='workflow-completion'&&e.runId===runId&&e.count===6));
    assert(metricLogs.some(e=>e.event==='quiz-stage-wait'));
    assert(metricLogs.some(e=>e.event==='knowledge-model-usage'&&e.runId===runId&&e.costNanodollars===null));
    assert.equal(maximumDrafts,3);assert.equal(activeDrafts,0);assert.equal(reviewOverlappedDraft,true);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM knowledge_workflow_stages WHERE run_id=? AND stage_key LIKE 'quiz-batch-classification:%' AND status='completed'").get(runId).count,1);
    const scratchpad = JSON.parse(db.prepare("SELECT scratchpad_json FROM extraction_scratchpads").get().scratchpad_json);
    assert.equal(scratchpad.pendingBatch, undefined);
    assert.equal(scratchpad.processedUrls.length, 7);

    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"));
    const decoder = createRenderer({ policy: ACQUISITION_POLICY, chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", nodePath: process.execPath, platform: process.platform, request: forbidden });
    let decodeCalls = 0;
    const decodeImage = async (bytes, mediaType) => {
      decodeCalls++;
      assert.deepEqual(bytes, png);
      assert.equal(mediaType, "image/png");
      return decoder.decodeImage(bytes, mediaType, new AbortController().signal);
    };
    const packed = unwrap(packImageBundle([2, 4, 6].map((number) => ({ name: `Page ${number}`, locator: `page:${number}`, mediaType: "image/png", bytes: png }))));
    const imageRunId = "image-run", imageSourceId = "image-source", imageSourceUrl = "https://example.test/private-figures";
    const imageMaterial = unwrap(await parseAuthorizedMaterial({ ownerId, runId: imageRunId, sourceId: imageSourceId, sourceRevision: 1, sourceUrl: imageSourceUrl, mode: "image", mediaType: BUNDLE_TYPE, fileName: "figures.pdf.pkpi", bytes: packed, idempotencyKey: imageRunId, rightsAttestation: { ownsOrPermitted: true, storageAllowed: true, transformationAllowed: true, processingAllowed: true, basis: "test-owned", reference: "synthetic-test" } }, { digest: async (bytes) => createHash("sha256").update(bytes).digest("hex"), maximumBytes: 104_857_600, maximumCharacters: 1_000_000 }));
    const imageService = createKnowledgeWorkflowService(repository, { now: clock, createId: () => imageRunId, logger });
    let imageRun = unwrap(await imageService.createRun({ ownerId, sourceId: imageSourceId, sourceRevision: 1, canonicalSourceIdentity: imageSourceUrl, contentSignature: imageMaterial.contentDigest, idempotencyKey: imageRunId, sourceOrigin: "private-document", configDigests: Object.fromEntries(Object.entries(configs).map(([role, config]) => [role, config.digest])) })).run;
    unwrap(await materials.persist({ ownerId, runId: imageRunId, materialId: "image-material", idempotencyKey: imageRunId, fingerprint: imageMaterial.contentDigest, objectKey: "synthetic-images", material: imageMaterial, createdAt: clock() }));
    imageRun = unwrap(await imageService.attachMaterial({ ownerId, runId: imageRunId, materialId: "image-material" }));
    db.prepare("INSERT INTO library_sources (owner_id,source_id,submitted_url,canonical_url,title,description,adapter_json,identity_evidence_json,state,approved_at,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(ownerId, imageSourceId, imageSourceUrl, imageSourceUrl, "Synthetic figures", "Offline visual fixture", JSON.stringify({ kind: "private-document" }), "[]", "active", clock(), clock(), 1);
    let imageReads = 0;
    const originals=new Map();
    const media={ingest:async()=>assert.fail('Uploaded originals must use bytes.'),ingestBytes:async command=>{
      assert.equal(command.ownerId,ownerId);assert.equal(command.runId,imageRunId);assert.deepEqual(command.bytes,png);
      assert.equal(command.binding.originalDigest,`sha256:${createHash('sha256').update(png).digest('hex')}`);
      originals.set(command.knowledgeId,{id:command.binding.imageId,bytes:command.bytes,mediaType:'image/png'});return {ok:true,value:null};
    }};
    let originalReviewReads=0;
    const reviewMedia={readOriginal:async scope=>{assert.equal(scope.ownerId,ownerId);assert.equal(scope.runId,imageRunId);assert.equal(scope.sourceRevision,1);originalReviewReads++;return {ok:true,value:originals.get(scope.knowledgeId)??null};}};
    let reviewRuntime;
    for (let step = 0; step < 8 && imageRun.state !== "completed"; step++) {
      if (imageRun.state === "awaiting-time-limit-decision") imageRun = unwrap(await imageService.advance({ ownerId, runId:imageRunId, expectedRevision:imageRun.revision, nextState:"extraction-loop" }));
      const runtime = createKnowledgeWorkflowRuntime({imagePolicy:WEBPAGE_IMAGE_POLICY, database, fetch: transport, browser: { readPage: forbidden, readRobots: forbidden, screenshot: forbidden, close: async () => ({ ok: true, value: null }) }, apiKey: "offline-fixture", endpoint: "https://example.test/model", now: clock, nowMs: Date.now, logger, configSnapshots: configs, material: materials, media, reviewMedia, decodeImage, materialContent: { read: async () => { imageReads++; return { ok: true, value: packed }; } }, transition: ({ run: current, nextState, ...rest }) => imageService.advance({ ownerId, runId: imageRunId, expectedRevision: current.revision, nextState, ...rest }) });
      reviewRuntime=runtime;
      const executed = await runtime.execute(imageRun);
      assert.equal(executed.ok, true, JSON.stringify(executed.error));
      imageRun = unwrap(await repository.findById(ownerId, imageRunId));
    }
    assert.equal(imageRun.state, "completed");
    assert.deepEqual(imageBatchSizes, [1, 1, 1]);
    assert.deepEqual(imageObservationSizes, [1, 1, 1]);
    assert.deepEqual(materialReviews, []); // The new verdict-only critic replaces the legacy rewriting normalizer.
    assert.deepEqual(qualityReviews,[...Array(6).fill('text'),...Array(3).fill('image')]); // Interrupted text checkpoint replays completed review decisions.
    assert.equal(originals.size,3);
    assert.equal(originalReviewReads,3,"Generation and review share one original image read per point");
    assert.equal(imageReads, 3); // One acquisition unit per durable execution.
    assert.equal(decodeCalls, 12); // Acquisition, attachment, independent review and media handoff each validate original pixels.
    assert.equal(imageRun.counts.pages, 3);
    assert.equal(imageRun.counts.knowledgePoints, 3);
    const stage=JSON.parse(db.prepare("SELECT result_json FROM knowledge_workflow_stages WHERE owner_id=? AND run_id=? AND stage_key LIKE 'knowledge-quality:%' ORDER BY stage_key LIMIT 1").get(ownerId,imageRunId).result_json).value;
    const originalEvidence=JSON.parse(db.prepare("SELECT evidence_json FROM knowledge_workflow_review_evidence WHERE owner_id=? AND run_id=? AND knowledge_id=?").get(ownerId,imageRunId,stage.point.id).evidence_json);
    const beforeReplay=modelCalls;
    const replayed=unwrap(await reviewRuntime.reviewCapturedCandidate({run:imageRun,point:stage.point,sourceEvidence:originalEvidence,sourceMode:'image',supportingImage:originals.get(stage.point.id)}));
    assert.equal(replayed.point.id,stage.point.id);
    assert.equal(replayed.binding,undefined); // Original raster uses its scoped uploaded-source binding.
    const actor=unwrap(reviewRuntime.createQuizActorForRun(imageRun));
    const replayedQuiz=unwrap(await actor.run({ownerId,runId:imageRunId,points:[stage.point]}));
    assert.equal(replayedQuiz.dispositions[0].status,'accepted');
    assert.equal((await actor.run({ownerId:'another-owner',runId:imageRunId,points:[stage.point]})).error.kind,'QuizCommandInvalid');
    assert.equal((await reviewRuntime.reviewCapturedCandidate({run:imageRun,point:{...stage.point,sourceId:'another-source'},sourceEvidence:originalEvidence,sourceMode:'image',supportingImage:originals.get(stage.point.id)})).error.kind,'KnowledgeReviewCommandInvalid');
    assert.equal(modelCalls,beforeReplay); // Both shared public seams replay actual completed application stages.

    // Cached non-model checkpoints are untrusted JSON: malformed results must
    // not skip a point or complete the run without its actual paired quiz.
    const cached=db.prepare("SELECT stage_key,result_json FROM knowledge_workflow_stages WHERE run_id=? AND stage_key LIKE 'quiz-point-completed:%' ORDER BY stage_key LIMIT 1").get(imageRunId);
    const cachedValue=JSON.parse(cached.result_json).value;
    db.prepare("UPDATE knowledge_workflow_runs SET state='per-point-quiz-loop',run_json=json_set(run_json,'$.state','per-point-quiz-loop') WHERE owner_id=? AND run_id=?").run(ownerId,imageRunId);
    const replayRun={...imageRun,state:'per-point-quiz-loop'};
    for(const change of [{knowledgeId:'other-point'},{status:'unknown'},{publicationStatus:null},{attempts:-1},{attempts:1.5},{attempts:5},{failureKind:42},{restrictedUntil:'not-a-date'},{publicationStatus:'pending-review'}]) {
      const corrupted={ok:true,value:{...cachedValue,dispositions:[{...cachedValue.dispositions[0],...change}]}};
      db.prepare("UPDATE knowledge_workflow_stages SET result_json=? WHERE owner_id=? AND run_id=? AND stage_key=?").run(JSON.stringify(corrupted),ownerId,imageRunId,cached.stage_key);
      const checked=await reviewRuntime.execute(replayRun);
      assert.equal(checked.ok,false,JSON.stringify(change));assert.equal(checked.error.detailKind,'WorkflowStagePersistenceFailed');
      assert.equal(modelCalls,beforeReplay);
    }
    for(const value of [{dispositions:[]},{dispositions:[cachedValue.dispositions[0],cachedValue.dispositions[0]]},{...cachedValue,statistics:{...cachedValue.statistics,inputPoints:2}},{...cachedValue,statistics:{...cachedValue.statistics,retryRate:2}}]) {
      db.prepare("UPDATE knowledge_workflow_stages SET result_json=? WHERE owner_id=? AND run_id=? AND stage_key=?").run(JSON.stringify({ok:true,value}),ownerId,imageRunId,cached.stage_key);
      const checked=await reviewRuntime.execute(replayRun);assert.equal(checked.ok,false);assert.equal(checked.error.detailKind,'WorkflowStagePersistenceFailed');assert.equal(modelCalls,beforeReplay);
    }
    db.prepare("UPDATE knowledge_workflow_stages SET result_json=? WHERE owner_id=? AND run_id=? AND stage_key=?").run(cached.result_json,ownerId,imageRunId,cached.stage_key);
    const recovered=unwrap(await reviewRuntime.execute(replayRun));assert.equal(recovered.state,'completed');assert.equal(modelCalls,beforeReplay);
    const knowledgeId=cachedValue.dispositions[0].knowledgeId;
    const pendingValue={ok:true,value:{...cachedValue,dispositions:[{...cachedValue.dispositions[0],publicationStatus:'pending-review'}]}};
    db.prepare("UPDATE knowledge_workflow_stages SET result_json=? WHERE owner_id=? AND run_id=? AND stage_key=?").run(JSON.stringify(pendingValue),ownerId,imageRunId,cached.stage_key);
    db.prepare("UPDATE knowledge_workflow_quizzes SET status='pending-review' WHERE owner_id=? AND run_id=? AND knowledge_id=?").run(ownerId,imageRunId,knowledgeId);
    db.prepare("UPDATE knowledge_workflow_runs SET state='per-point-quiz-loop',run_json=json_set(run_json,'$.state','per-point-quiz-loop') WHERE owner_id=? AND run_id=?").run(ownerId,imageRunId);
    const pendingResult=unwrap(await reviewRuntime.execute(unwrap(await imageService.status({ownerId,runId:imageRunId}))));
    assert.equal(pendingResult.state,'completed');assert.equal(pendingResult.run.counts.pendingQuizzes,1);assert.equal(modelCalls,beforeReplay);
    unwrap(await new D1QuizRepository({database,logger,now:clock}).discard({ownerId,runId:imageRunId,knowledgeId,reason:'no-meaningful-quiz'}));
    const restrictedUntil=new Date(Date.now()+7*86400000).toISOString();
    const discardedValue={ok:true,value:{dispositions:[{knowledgeId,status:'abandoned',publicationStatus:null,attempts:0,failureKind:'QuizSeeLessOften',restrictedUntil}]}};
    db.prepare("UPDATE knowledge_workflow_stages SET result_json=? WHERE owner_id=? AND run_id=? AND stage_key=?").run(JSON.stringify(discardedValue),ownerId,imageRunId,cached.stage_key);
    db.prepare("UPDATE knowledge_workflow_runs SET state='per-point-quiz-loop',run_json=json_set(run_json,'$.state','per-point-quiz-loop') WHERE owner_id=? AND run_id=?").run(ownerId,imageRunId);
    const discardedResult=unwrap(await reviewRuntime.execute(unwrap(await imageService.status({ownerId,runId:imageRunId}))));
    assert.equal(discardedResult.state,'completed');assert.equal(discardedResult.restrictedUntil,restrictedUntil);assert(discardedResult.restrictedKnowledgeIds.includes(knowledgeId));assert.equal(modelCalls,beforeReplay);

    // Synthetic runtime material; actual Chromium PDF parsing is covered separately.
    const captureRunId='capture-run',captureSourceId='capture-source',captureUrl='https://publisher.example/article';
    const captureBytes=unwrap(packUrlCapture({sourceUrl:captureUrl,responseUrl:captureUrl,pdf:new TextEncoder().encode('%PDF-fixture'),images:[1,2].map(n=>({path:`image:${n}`,url:`https://cdn.example.org/figure-${n}.png`,caption:`Source caption ${n}`,alt:'Source diagram',context:'Original article context',mediaType:'image/png',bytes:png}))}));
    const captureMaterial={...material,runId:captureRunId,sourceId:captureSourceId,sourceUrl:captureUrl,mode:'text',mediaType:URL_CAPTURE_TYPE,fileName:'article.pkpc',contentDigest:createHash('sha256').update(captureBytes).digest('hex'),sections:sections.filter(s=>s.text).slice(0,2),media:[]};
    const captureService=createKnowledgeWorkflowService(repository,{now:clock,createId:()=>captureRunId,logger});
    let captureRun=unwrap(await captureService.createRun({ownerId,sourceId:captureSourceId,sourceRevision:1,canonicalSourceIdentity:captureUrl,contentSignature:captureMaterial.contentDigest,idempotencyKey:captureRunId,sourceOrigin:'url-material',configDigests:Object.fromEntries(Object.entries(configs).map(([role,config])=>[role,config.digest]))})).run;
    unwrap(await materials.persist({ownerId,runId:captureRunId,materialId:'capture-material',idempotencyKey:captureRunId,fingerprint:captureMaterial.contentDigest,objectKey:'synthetic-capture',material:captureMaterial,createdAt:clock()}));
    captureRun=unwrap(await captureService.attachMaterial({ownerId,runId:captureRunId,materialId:'capture-material'}));
    db.prepare("INSERT INTO library_sources (owner_id,source_id,submitted_url,canonical_url,title,description,adapter_json,identity_evidence_json,state,approved_at,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(ownerId,captureSourceId,captureUrl,captureUrl,'Captured URL','Offline captured assets fixture',JSON.stringify({kind:'web'}),'[]','active',clock(),clock(),1);
    const captureOriginals=new Map();let captureIngests=0;
    for(let step=0;step<8&&captureRun.state!=='completed';step++){
      if(captureRun.state==='awaiting-time-limit-decision')captureRun=unwrap(await captureService.advance({ownerId,runId:captureRunId,expectedRevision:captureRun.revision,nextState:'extraction-loop'}));
      const runtime=createKnowledgeWorkflowRuntime({imagePolicy:WEBPAGE_IMAGE_POLICY,database,fetch:transport,browser:{readPage:forbidden,readRobots:forbidden,screenshot:forbidden,close:async()=>({ok:true,value:null})},apiKey:'offline-fixture',endpoint:'https://example.test/model',now:clock,nowMs:Date.now,logger,configSnapshots:configs,material:materials,materialContent:{read:async()=>({ok:true,value:captureBytes})},media:{ingest:forbidden,ingestBytes:async command=>{captureIngests++;if(captureIngests<=3)return {ok:false,error:{kind:'MediaDerivativeProcessingFailed'}};assert.equal(command.candidate.kind,'image');assert.equal(command.sourceUrl,'https://cdn.example.org/figure-2.png','Highest qualifying image wins');assert.equal(command.binding.kind,'webpage-support');assert.equal(command.binding.purpose,'illustration');assert.equal(command.binding.imageId,'image:2');assert.deepEqual(command.bytes,png);captureOriginals.set(command.knowledgeId,{id:'image:2',mediaType:'image/png',bytes:png,purpose:'illustration'});return {ok:true,value:null};}},reviewMedia:{readOriginal:async scope=>({ok:true,value:captureOriginals.get(scope.knowledgeId)??null})},decodeImage,transition:({run:current,nextState,...rest})=>captureService.advance({ownerId,runId:captureRunId,expectedRevision:current.revision,nextState,...rest})});
      unwrap(await runtime.execute(captureRun));captureRun=unwrap(await repository.findById(ownerId,captureRunId));
    }
    assert.equal(captureRun.state,'completed');assert.equal(captureRun.counts.acceptedQuizzes,2);assert.equal(captureIngests,4,JSON.stringify({captionCalls,decisionCalls,warnings:db.prepare('SELECT warnings_json FROM knowledge_workflow_page_image_warnings WHERE run_id=?').all(captureRunId)}));assert.equal(captionCalls,3,'One invalid caption gets a technical retry; successful captions replay');assert.equal(decisionCalls,3,'One 429 gets a technical retry; scores replay');
    const capturePoints=db.prepare('SELECT point_json FROM extraction_knowledge_points WHERE run_id=? ORDER BY created_at,knowledge_id').all(captureRunId).map(row=>JSON.parse(row.point_json));
    assert.equal(capturePoints.filter(p=>p.mediaCandidates.length).length,1);assert.equal(capturePoints.find(p=>p.mediaCandidates.length).imageAssociation.score,0.95);assert.equal(capturePoints.find(p=>p.mediaCandidates.length).imageAssociation.model,'typesafe/jev-1.13');assert.deepEqual(capturePoints.find(p=>!p.mediaCandidates.length).mediaCandidates,[]);assert.deepEqual(capturePoints.map(p=>p.summary).sort(),captureMaterial.sections.map(s=>s.text).sort(),'Images cannot rewrite text-derived knowledge');

    // Exercise the actual production extraction wiring with three independent model requests.
    const parallelRunId='parallel-run',parallelSourceId='parallel-source',parallelUrl='https://example.test/parallel';
    const parallelMaterial={...material,runId:parallelRunId,sourceId:parallelSourceId,sourceUrl:parallelUrl,sections:[{id:'parallel-page',title:'Parallel',locator:'page:1',text:'Parallel fixture source relationships.'}]};
    const parallelService=createKnowledgeWorkflowService(repository,{now:clock,createId:()=>parallelRunId,logger});
    let parallelRun=unwrap(await parallelService.createRun({ownerId,sourceId:parallelSourceId,sourceRevision:1,canonicalSourceIdentity:parallelUrl,contentSignature:parallelMaterial.contentDigest,idempotencyKey:parallelRunId,sourceOrigin:'private-document',configDigests:Object.fromEntries(Object.entries(configs).map(([role,config])=>[role,config.digest]))})).run;
    unwrap(await materials.persist({ownerId,runId:parallelRunId,materialId:'parallel-material',idempotencyKey:parallelRunId,fingerprint:parallelMaterial.contentDigest,objectKey:'synthetic-parallel',material:parallelMaterial,createdAt:clock()}));
    parallelRun=unwrap(await parallelService.attachMaterial({ownerId,runId:parallelRunId,materialId:'parallel-material'}));
    db.prepare("INSERT INTO library_sources (owner_id,source_id,submitted_url,canonical_url,title,description,adapter_json,identity_evidence_json,state,approved_at,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(ownerId,parallelSourceId,parallelUrl,parallelUrl,'Parallel source','Offline concurrency fixture',JSON.stringify({kind:'private-document'}),'[]','active',clock(),clock(),1);
    for(let step=0;step<4&&parallelRun.state!=='completed';step++){
      const runtime=createKnowledgeWorkflowRuntime({imagePolicy:WEBPAGE_IMAGE_POLICY,database,fetch:transport,browser:{readPage:forbidden,readRobots:forbidden,screenshot:forbidden,close:async()=>({ok:true,value:null})},apiKey:'offline-fixture',endpoint:'https://example.test/model',now:clock,nowMs:Date.now,logger,configSnapshots:configs,material:materials,transition:({run:current,nextState,...rest})=>parallelService.advance({ownerId,runId:parallelRunId,expectedRevision:current.revision,nextState,...rest})});
      unwrap(await runtime.execute(parallelRun));parallelRun=unwrap(await repository.findById(ownerId,parallelRunId));
    }
    assert.equal(parallelRun.counts.knowledgePoints,3);
    assert.equal(maximumParallelReviews,3);assert.equal(activeParallelReviews,0);assert.equal(parallelSelections,1);

    assert.equal(parallelRun.state,'completed');assert.equal(parallelRun.failureKind,'WorkflowQuizItemsFailed');
    assert.equal(parallelRun.counts.acceptedQuizzes,2,'A failed critic must not prevent its peers from publishing');
    assert.equal(failedQuizReviews,4);assert.equal(recoveredDrafts,1);
    const beforeRecovery=modelCalls;
    allowQuizRecovery=true;
    parallelRun=unwrap(await parallelService.control({ownerId,runId:parallelRunId,expectedRevision:parallelRun.revision,action:'retry-quizzes',idempotencyKey:'recover-quiz-fixture'}));
    const recoveryRuntime=createKnowledgeWorkflowRuntime({imagePolicy:WEBPAGE_IMAGE_POLICY,database,fetch:transport,browser:{readPage:forbidden,readRobots:forbidden,screenshot:forbidden,close:async()=>({ok:true,value:null})},apiKey:'offline-fixture',endpoint:'https://example.test/model',now:clock,nowMs:Date.now,logger,configSnapshots:configs,material:materials,transition:({run:current,nextState,...rest})=>parallelService.advance({ownerId,runId:parallelRunId,expectedRevision:current.revision,nextState,...rest})});
    unwrap(await recoveryRuntime.execute(parallelRun));parallelRun=unwrap(await repository.findById(ownerId,parallelRunId));
    assert.equal(parallelRun.state,'completed');assert.equal(parallelRun.failureKind,null);
    assert.equal(parallelRun.counts.acceptedQuizzes,3);assert.equal(recoveredDrafts,1,'Recovery reuses the saved draft');
    assert.equal(failedQuizReviews,5);assert.equal(modelCalls-beforeRecovery,2,'Recovery rechecks answer importance and the critic while reusing successful peers and the saved draft');

    const content=new D1KnowledgeContentRepository({database,logger});
    const feedbackPoint=db.prepare('SELECT knowledge_id FROM extraction_knowledge_points WHERE run_id=? ORDER BY knowledge_id LIMIT 1').get(runId).knowledge_id;
    db.prepare('INSERT INTO learner_preference_feedback VALUES (?,?,?,?,?)').run(ownerId,feedbackPoint,-1,'less',clock());
    for(const selected of [{runId,sourceId,knowledgeId:feedbackPoint},{runId:imageRunId,sourceId:imageSourceId,knowledgeId:stage.point.id},{runId,sourceId:'unclassified-source',knowledgeId:'absent'}]) {
      const scope={ownerId,...selected};
      const full=unwrap(await content.reviewContext(scope));
      const narrow=unwrap(await content.preferenceContext(scope));
      assert.deepEqual(narrow.lessOften,full.lessOften,'Preference-only reads retain full review preference semantics');
    }
    db.prepare("UPDATE learner_preference_feedback SET choice='more',preference=1 WHERE owner_id=? AND knowledge_id=?").run(ownerId,feedbackPoint);
    assert.deepEqual(unwrap(await content.preferenceContext({ownerId,runId,sourceId,knowledgeId:feedbackPoint})).lessOften,[],'Preference decisions stay fresh');

  } finally { db.close(); }
});
