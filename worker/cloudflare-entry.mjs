import { createCloudflareDiscoveryWorker } from "./main.js";
import { D1QuizRepository } from "./knowledge-workflow-content-d1.js";
import { createKnowledgeWorkflowRestrictionReaper } from "./knowledge-workflow-reaper.js";
import { createKnowledgeWorkflowLogger } from "./knowledge-workflow-logging.js";
import { createReminderRuntime } from "./reminders/runtime.js";
import { createUnifiedWorkerRouter } from "./static-router.js";
import { routeWithWorkerVersion } from "./versioned-router.js";
import { resumeInterruptedKnowledgeWorkflows } from "./knowledge-workflow-auto-resume.js";
import { createAcquisitionClient } from "./acquisition-client.js";
import { ACQUISITION_POLICY } from "./acquisition-policy.js";

export {
  PublisherTranscriptAuthorizationDurableObject,
  YouTubeQuotaDurableObject,
} from "./main.js";
export { KnowledgeExtractionWorkflow } from "./knowledge-workflow-entry.mjs";

export default {
  async fetch(request, environment, context) {
    const routed = createUnifiedWorkerRouter({
      assets: environment.ASSETS,
      createApiWorker: () =>
        createCloudflareDiscoveryWorker(environment, {
          fetch: globalThis.fetch,
          now: () => new Date(),
          subtle: globalThis.crypto.subtle,
          waitUntil: (promise) => context.waitUntil(promise),
          randomBytes: (length) =>
            globalThis.crypto.getRandomValues(new Uint8Array(length)),
        }),
    });
    return routeWithWorkerVersion(
      routed,
      request,
      environment.CF_VERSION_METADATA,
    );
  },
  async scheduled(event, environment) {
    if (!environment?.SOURCE_LIBRARY_DB || typeof environment.SOURCE_LIBRARY_DB.prepare !== "function") throw new Error("Knowledge workflow restriction reaper requires SOURCE_LIBRARY_DB.");
    if (event.cron === "* * * * *") {
      const logger = (record) => console.info(JSON.stringify(record));
      const recovery = environment.KNOWLEDGE_WORKFLOW_ENABLED === "true"
        ? resumeInterruptedKnowledgeWorkflows({database:environment.SOURCE_LIBRARY_DB,binding:environment.KNOWLEDGE_WORKFLOW,ownerId:environment.ACCESS_OWNER_ID,now:()=>new Date().toISOString(),logger,
          acquisitionAvailable:createAcquisitionClient({binding:environment.PUBLIC_ACQUISITION,endpoint:environment.PUBLIC_ACQUISITION_ENDPOINT,token:environment.PUBLIC_ACQUISITION_TOKEN,policy:ACQUISITION_POLICY,createId:()=>crypto.randomUUID()}).available,
        }).then(result=>{if(!result.ok)throw new Error(result.error.kind);})
        : Promise.resolve();
      const reminderDispatch = (async () => {
        if ([environment.VAPID_PUBLIC_KEY,environment.VAPID_PRIVATE_KEY,environment.VAPID_SUBJECT].every(value=>value===undefined)) {
          logger({event:"reminder-schedule-unconfigured"});
          return;
        }
        const reminders = createReminderRuntime({environment,database:environment.SOURCE_LIBRARY_DB,now:()=>new Date(),fetch:globalThis.fetch,logger});
        const result = await reminders.run();
        if (!result.ok && result.error.kind === "ReminderConfigurationMissing") {
          logger({event:"reminder-schedule-disabled",failure:result.error.kind});
          return;
        }
        if (!result.ok) throw new Error(result.error.kind);
      })();
      await Promise.all([recovery,reminderDispatch]);
      return;
    }
    if (event.cron !== "*/15 * * * *") throw new Error("ScheduledTriggerUnsupported");
    const now = () => new Date().toISOString();
    const logger = createKnowledgeWorkflowLogger({ sink: (record) => console.info(JSON.stringify(record)), now });
    const quizRepository = new D1QuizRepository({ database: environment.SOURCE_LIBRARY_DB, bucket: environment.SOURCE_CONTENT_BUCKET, now, logger });
    const reaper = createKnowledgeWorkflowRestrictionReaper({ database: environment.SOURCE_LIBRARY_DB, quizRepository, now, logger });
    const result = await reaper.run();
    if (!result.ok) throw new Error(result.error.kind);
  },
};
