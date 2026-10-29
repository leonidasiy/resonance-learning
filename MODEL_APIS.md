# Switching model APIs

Both computer and Cloudflare installations can use different models through
OpenRouter, or a different **OpenAI-compatible Chat Completions API**. Your existing
installation keeps its current defaults until you configure a replacement.

This is protocol compatibility, not a promise that every model produces good
learning material. The synthetic integration test substitutes a different API
address, key and model throughout upload, extraction, paired quiz publication,
study, semantic answer grading and restart. It makes no paid provider calls.

## Before choosing a model

Check your provider's documentation for HTTPS Chat Completions, bearer API keys,
`messages`, `max_tokens`, non-streaming responses, and `response_format` with
`json_object` and strict `json_schema`. Responses must include a request `id`,
`choices[0].finish_reason: "stop"`, and JSON text in `message.content`.
If usage is reported, token counts must be nonnegative integers. The older
learning-generation endpoint additionally requires matching prompt, completion
and total token counts. Image workflows also need image inputs using `image_url`
with data URLs. Choose models with sufficient context and output limits; the
checked-in limits were selected for the default models.

Native Anthropic Messages, Gemini generateContent and OpenAI Responses protocols
need a compatible gateway or a separate adapter. A chat subscription is not an
API service. Non-OpenRouter endpoints receive no OpenRouter `provider` or
`reasoning` extensions. Provider-specific reasoning controls need an adapter.

## 1. Choose the endpoint, key and general models

For **computer mode**, add these lines to your private `.env.local`, replacing
every example with your provider's actual values:

```dotenv
LLM_CHAT_ENDPOINT="https://YOUR_PROVIDER/v1/chat/completions"
LLM_API_KEY="YOUR_PRIVATE_API_KEY"
LLM_MODEL="YOUR_GENERAL_MODEL_ID"
LLM_GRADING_MODEL="YOUR_GRADING_MODEL_ID"
```

`LLM_MODEL` handles source classification and the older learning generator.
`LLM_GRADING_MODEL` handles semantic answer grading and image-association decisions
through the same chat endpoint. It can use the same model ID. Its probabilities
are model judgments, not calibrated Jev probabilities; the existing acceptance
thresholds remain product choices. Exact answers and choice checks stay deterministic.

For **Cloudflare mode**, put the three non-secret values in the `vars` object
of your private `wrangler.self-host.jsonc`. Store the key separately:

```sh
npx wrangler@4.151.1 secret put LLM_API_KEY --config wrangler.self-host.jsonc
```

A different provider requires its own `LLM_API_KEY`; the app will never send your
OpenRouter key to a replacement provider. Use an exact HTTPS endpoint without
embedded credentials, query parameters or fragments. Redirects fail rather than
forwarding source content to a different URL. Keys remain on the server.

To change only models while staying on OpenRouter, keep your existing key and
endpoint. Set `LLM_MODEL` for classification/older generation; optionally set
`LLM_GRADING_MODEL` to replace Jev. Complete the workflow-role step below too.

## 2. Choose the four workflow-role models

The checked-in production reviewer (`question-evaluator`, version v8) uses
`xiaomi/mimo-v2.6-flash` with `reasoningEffort: none`. The other three roles use
`z-ai/glm-5.3-flash`. These are defaults in the repository, not a guarantee of
provider availability. The reviewer evaluates both knowledge and quizzes;
external benchmark judges cannot publish learning content.

Open each file in `agent-config/`:

- `rights-assessor.yaml`
- `knowledge-scraper.yaml`
- `question-generator.yaml`
- `question-evaluator.yaml`

In its `model` section, set `name` to the model ID your chosen API accepts.
Set `provider` to `openai-compatible` for a replacement API, or keep `openrouter`
for OpenRouter. These role models handle the main extraction/publication workflow;
setting `LLM_MODEL` alone does not replace them. You may use one model for all
four roles, or choose different models at the same endpoint. There is no fixed
vendor/model allowlist. Keep the rest of each file unless you understand its limits.

**Computer:** restart with `deno task start:local`. Canonical configuration
digests are recalculated automatically.

**Cloudflare:** print your exact canonical digests:

```sh
node scripts/agent-config-digests.mjs
```

Copy the printed JSON into `KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS` in your private
config as its escaped JSON string, following the existing value's format. For
example, each inner `"` becomes `\"`. Keep every role and complete SHA256 value.
Then run the build, dry run and deployment commands from [Cloudflare setup](SELF_HOSTING.md).
The command prints configuration hashes, never API keys.

Let active source-processing runs finish before changing provider/models. A run
with an old configuration digest fails validation after YAML changes; do not
delete learner data to fix it. Start a new processing run using the new configuration.

### Processing, recovery and private usage records

Model stages save validated results before continuing. Completed reviews and
accepted knowledge can be reused after interruption, and quizzes can begin
while extraction continues. Recoverable workflow/provider failures have bounded
automatic recovery; billing, permission and exhausted-retry failures retain a
named reason and can require owner action. Explicit retry reuses durable work;
it does not replenish provider credits or benchmark allowances.

Extraction preserves the supporting source's language and useful subject
relationships. Course outlines and document-navigation trivia are excluded as
learning targets. Quiz answer targets receive a separate importance check and
bounded repair. A quiz needs at least 7/10 from the production reviewer plus
validated grounding; rejected quiz generation no longer deletes otherwise
accepted knowledge. These thresholds are product policy, not measured learning
efficacy or calibrated correctness probabilities.

Private usage receipts retain model request timing alongside usage accounting.
Keep receipts, prompts, source material and learner records out of GitHub and
browser bundles. The runtime reduces repeated image reads and agent-context
serialization; it does not bypass request, storage or accounting checks.

## 3. Optional semantic-search reranking

Reranking uses a separate protocol. Configure a compatible rerank API with:

```dotenv
RERANK_ENDPOINT="https://YOUR_PROVIDER/v2/rerank"
RERANK_API_KEY="YOUR_PRIVATE_RERANK_KEY"
RERANK_MODEL="YOUR_RERANK_MODEL_ID"
```

It must accept `model`, `query`, `documents` and `top_n`, and return `results`
with unique input `index` values and `relevance_score` numbers from 0 to 1.
Use `.env.local` in computer mode; use Cloudflare `vars` for endpoint/model and
`wrangler secret put RERANK_API_KEY --config wrangler.self-host.jsonc` for the key.
Changing only the OpenRouter rerank model requires just `RERANK_MODEL`.

With a replacement chat API and no separate reranker, optional semantic search
is unavailable; keyword search and the learning pipeline still work. No request
falls back to the maintainer's services. Firecrawl, acquisition, discovery and
notifications retain their own documented protocols; a chat API does not replace them.

## Check your installation

Process a short document you own, confirm Feed has its knowledge cards, study a
batch, and answer a quiz. Try a correct paraphrase in a blank answer to exercise
semantic grading. Confirm your provider dashboard shows the intended models and
charges. If a provider rejects a request, check its required format, model access,
limits and API key; validation failures are reported rather than accepted as success.
