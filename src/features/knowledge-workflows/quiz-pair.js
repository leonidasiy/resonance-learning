// @ts-check

export const QUIZ_ACCEPTANCE_SCORE=7;

// Shared semantic criteria for generation, schema guidance and every actor reviewer.
export const quizVisualContextInstruction = `Make each quiz independently answerable in its rendered Review state. Prefer a self-contained verbal question about the taught relationship. Never refer to an unseen diagram, figure, chart, screenshot, panel, color, label or spatial position, or rely on the knowledge summary being visible beside the quiz. A sourceEvidence image seen by the model is not automatically visible to the learner. Only when learningImageAvailable is true may a necessary visual question refer to the exact image bound to this knowledge point and displayed with both quiz variants; inspect that image and make every referent unambiguous. Do not assume a different source figure or full page is attached. When no bound image is available, rewrite both prompts using supported explicit context without giving away their answers. Reviewers must reject missing visual context as a draft answerability fault and request this repair before publication.`;

export const quizAnswerQualityInstruction = `${quizVisualContextInstruction}
Historical identities, named works, authorship and membership relationships can be central recall targets; a mechanism or technical quantity is not required for every subject. A composer named from their works is valid recall when that relationship is taught. Distinct members or roles are not duplicates merely because one sentence teaches them. Optional stylistic improvements do not make a supported, answerable target invalid.
Select answers for conceptual importance, never to increase the answer count. One strong recall target is sufficient. Add a second or third only when each tests a distinct central concept, mechanism, technical quantity or necessary contrast actually taught by the knowledge point. For each candidate, ask what important understanding would go untested if it were supplied as context instead; if none, do not make it an answer. Source occurrence and grammatical fit alone are insufficient.
Assess the answer in its full question context, not by word length, rarity or a vocabulary blacklist. Prefer precise concept names and compact technical phrases. Avoid vague quantities, generic artifacts, loose referents, incidental examples, adjectives, direction words and sentence-completion fragments: e.g. "a small subset of layers", "a testing harness", "every encoder hidden state", "longer", "a rule", "high", "low", "very noisy", "only slightly", "already known", "a success", "more models", "width" or "emphasizes" when they merely complete prose rather than retrieve a central taught concept. A familiar term such as query, key, value or softmax can be essential; a distinctive proper name or number can still be incidental trivia. Do not rescue a weak target by making it longer or copying more source wording. A bare verb such as "judge" or generic object such as "the prompt" is not improved merely because its sentence matters; retrieve the actual concept, such as an LLM judge or prompt conditioning, instead. A correct MCQ statement must test the same substantive concept as its mapped blank; a meaningful full statement does not excuse a generic canonical answer.
Evaluate each fill-blank independently of the MCQ: read its unanswered prompt and name the important concept the learner must actually retrieve beyond what is already supplied. Retrieving a defining technical term from its described role is valid conceptual recall: for example, cross-entropy, reward model, perverse incentives, query, key, value and Mamba-2 state-space block can be strong targets. Supplying a definition or mechanism as the question cue does not itself reveal its missing concept name. Do not reject precise concept-name recall as mere labeling or demand an explanatory sentence instead. The MCQ and fill-blank intentionally test the SAME concepts; that agreement is required, not duplication. Assess redundancy between answers within a variant or between separate quiz pairs, not between the two variants of this pair.
Each fill-blank answer must retrieve one concept or item. During generation and review, identify answers that bundle distinct concepts/items into a list, including wording joined by "and", "or", commas or similar connectors. Split those items into separate canonical answers, separate blanks and separate mapped correct MCQ options; rewrite both prompts, mappings and explanations together so their meaning and answerability remain intact. For example, "query, key and value" must become three answers, three blanks and three correct options, never one bundled answer or several aliases for one blank. Judge meaning in context: an indivisible established term such as "rhythm and blues" is one concept and must stay intact; true synonyms remain accepted aliases. Reviewers must request repair for bundled distinct items, even if the combined phrase is source-supported; score below ${QUIZ_ACCEPTANCE_SCORE} until those distinct items are separated. If splitting would exceed the existing three-target/five-option limits, narrow the question to a supported subset and supply any omitted items as context without leaking retained answers; never merge items to fit the limits. This is a semantic task for the quiz generation and review agents, not a punctuation or keyword splitting rule.
If the prompt explains the mechanism and leaves only an incidental completion such as "translation step", it fails even when the MCQ tests the full mechanism. Likewise, "every encoder hidden state" and "which hidden state" are quantifier/referent completions, not precise concept targets: explaining attention around these blanks does not make those answers acceptable. Supply those phrases as context and test a defining concept or mechanism instead. The other weak examples above are also unacceptable as written; repair the conceptual target rather than defending the importance of the sentence containing it. In review reasons, explicitly justify the retrieval required by each blank, not merely the importance of its surrounding sentence. Reducing to one answer does not by itself fix a weak target. If the central relationship cannot be tested as a precise concept phrase in this paired format, reject the pair rather than substituting generic fragments.
Do not split one idea into multiple synonymous, overlapping or logically redundant answers, and do not test an illustrative analogy as another target. Every incorrect option must express a plausible, specific misconception about the tested relationship, rather than filler, a giveaway, an arbitrary permutation or an unrelated topic. Use fewer options when no further meaningful alternative is available. Supply weak recall targets as context or rewrite the pair around the important concept. When removing a target, remove its correct option rather than marking it wrong, fill its blank with context, and rebuild canonical answers, mappings and ordered blanks together. Preserve any necessary conditions and do not reveal retained answers in that context.
Repair existing quizzes before considering withdrawal. Preserve sound targets and the original central relationship; replace a weak answer with a precise concept already taught elsewhere in the same knowledge point, or remove only that answer and its mapped option and blank. If every original answer is weak, retarget the question to the point's supported central concept instead of assuming the whole question is unusable. Rewrite both explanations to match the final options and blanks, removing references to deleted options or blanks. A stale explanation reference, minor wording issue or weak extra answer calls for a focused repair, not whole-question withdrawal. Review identifies concrete remaining defects; a review failure is a repair request, not evidence that the knowledge point cannot support a quiz. Withdraw only when no source-supported, answerable central question remains after repair. Precise concept names, necessary technical contrasts and quantities remain valid even when their definitions are supplied as cues; optional coverage of another relationship is not a reason to reject a sound single-target question.`;

/** @typedef {{ readonly key: string, readonly text: string }} ChoiceOption */
/** @typedef {{ readonly id: string, readonly canonicalAnswer: string, readonly acceptedAnswers: readonly string[] }} CanonicalBlank */
/** @typedef {{ readonly multipleChoice: { readonly id: string, readonly kind: "single-choice" | "multiple-choice", readonly prompt: string, readonly options: readonly ChoiceOption[], readonly correctOptionKeys: readonly string[], readonly canonicalAnswers: readonly string[], readonly explanation: string }, readonly fillBlank: { readonly id: string, readonly kind: "fill-blank", readonly prompt: string, readonly blanks: readonly CanonicalBlank[], readonly canonicalAnswers: readonly string[], readonly explanation: string }, readonly canonicalAnswers: readonly string[], readonly citedEvidenceUrls: readonly string[] }} QuizPair */

/** @typedef {{ readonly knowledgeId: string, readonly knowledgeRevision: number, readonly canonicalAnswers: readonly string[], readonly citedEvidenceUrls: readonly string[], readonly multipleChoice: { readonly prompt: string, readonly options: readonly ChoiceOption[], readonly correctOptionKeys: readonly string[], readonly correctOptionAnswers: readonly {readonly key:string,readonly canonicalAnswer:string}[], readonly explanation: string }, readonly fillBlank: { readonly prompt: string, readonly blanks: readonly CanonicalBlank[], readonly explanation: string } }} QuizPairDraft */

const freeze = Object.freeze;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is readonly string[]} */
function textList(value) { return Array.isArray(value) && value.length > 0 && value.every(text); }
/** @param {unknown} value @param {readonly string[]} keys @returns {value is Record<string, unknown>} */
function exactRecord(value, keys) { return record(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)); }
/** @param {string} value @returns {string} */
function normalize(value) { return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/gu, " "); }

/**
 * Strict provider output contract. The provider cannot choose stable IDs;
 * callers derive them from the persisted source/knowledge revision.
 * @param {unknown} value
 * @returns {value is QuizPairDraft}
 */
export function validateQuizPairDraft(value) {
  return validQuizPairDraftStructure(value) && value.canonicalAnswers.length <= 3 && value.multipleChoice.options.length <= 5;
}

/** @param {unknown} value @returns {value is QuizPairDraft} */
function validQuizPairDraftStructure(value) {
  if (!exactRecord(value, ["knowledgeId", "knowledgeRevision", "canonicalAnswers", "citedEvidenceUrls", "multipleChoice", "fillBlank"]) || !text(value.knowledgeId) || typeof value.knowledgeRevision !== "number" || !Number.isSafeInteger(value.knowledgeRevision) || value.knowledgeRevision < 1 || !textList(value.canonicalAnswers) || !textList(value.citedEvidenceUrls)) return false;
  const canonicalAnswers = /** @type {readonly string[]} */ (value.canonicalAnswers);
  if (new Set(canonicalAnswers.map(normalize)).size !== canonicalAnswers.length) return false;
  if (canonicalAnswers.some((answer) => !text(answer) || answer.length > 300)) return false;
  if (!exactRecord(value.multipleChoice, ["prompt", "options", "correctOptionKeys", "correctOptionAnswers", "explanation"]) || !text(value.multipleChoice.prompt) || value.multipleChoice.prompt.length > 1_000 || !text(value.multipleChoice.explanation) || value.multipleChoice.explanation.length > 4_000 || !Array.isArray(value.multipleChoice.options) || value.multipleChoice.options.length < 2 || !Array.isArray(value.multipleChoice.correctOptionKeys) || value.multipleChoice.correctOptionKeys.length < 1 || !value.multipleChoice.correctOptionKeys.every(text) || !Array.isArray(value.multipleChoice.correctOptionAnswers) || value.multipleChoice.correctOptionAnswers.length !== canonicalAnswers.length || !value.multipleChoice.correctOptionAnswers.every((entry) => exactRecord(entry, ["key", "canonicalAnswer"]) && text(entry.key) && text(entry.canonicalAnswer))) return false;
  const options = value.multipleChoice.options;
  if (!options.every((option) => exactRecord(option, ["key", "text"]) && text(option.key) && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(option.key) && text(option.text) && option.text.length <= 500)) return false;
  const optionKeys = options.map((option) => /** @type {string} */ (option.key));
  const optionTexts = options.map((option) => /** @type {string} */ (option.text));
  const correctKeys = /** @type {readonly string[]} */ (value.multipleChoice.correctOptionKeys);
  const correctOptionAnswers = /** @type {readonly {readonly key:string,readonly canonicalAnswer:string}[]} */ (value.multipleChoice.correctOptionAnswers);
  if (new Set(optionKeys).size !== optionKeys.length || new Set(optionTexts.map(normalize)).size !== optionTexts.length || new Set(correctKeys).size !== correctKeys.length || correctKeys.some((key) => !optionKeys.includes(key)) || correctKeys.length !== canonicalAnswers.length || correctKeys.some((key, index) => key !== correctOptionAnswers[index]?.key) || new Set(correctOptionAnswers.map((entry) => normalize(entry.canonicalAnswer))).size !== canonicalAnswers.length || canonicalAnswers.some((answer) => !correctOptionAnswers.some((entry) => normalize(entry.canonicalAnswer) === normalize(answer)))) return false;
  if (canonicalAnswers.some((answer) => optionKeys.includes(answer))) return false;
  if (!exactRecord(value.fillBlank, ["prompt", "blanks", "explanation"]) || !text(value.fillBlank.prompt) || value.fillBlank.prompt.length > 1_000 || !text(value.fillBlank.explanation) || value.fillBlank.explanation.length > 4_000 || !Array.isArray(value.fillBlank.blanks) || value.fillBlank.blanks.length !== canonicalAnswers.length) return false;
  const blanks = value.fillBlank.blanks;
  if (!blanks.every((blank, index) => exactRecord(blank, ["id", "canonicalAnswer", "acceptedAnswers"]) && blank.id === `blank-${index + 1}` && text(blank.canonicalAnswer) && normalize(blank.canonicalAnswer) === normalize(canonicalAnswers[index]) && textList(blank.acceptedAnswers) && blank.acceptedAnswers.length <= 12 && normalize(blank.acceptedAnswers[0]) === normalize(canonicalAnswers[index]) && new Set(blank.acceptedAnswers.map(normalize)).size === blank.acceptedAnswers.length)) return false;
  return (value.fillBlank.prompt.match(/(?<!_)____(?!_)/gu) ?? []).length === blanks.length;
}

/** @param {unknown} value @returns {value is { readonly knowledgeId:string, readonly knowledgeRevision:number, readonly canonicalAnswers:readonly string[], readonly citedEvidenceUrls:readonly string[], readonly multipleChoice:{readonly prompt:string,readonly options:readonly ChoiceOption[],readonly correctOptionKeys:readonly string[],readonly correctOptionAnswers:readonly {readonly key:string,readonly canonicalAnswer:string}[],readonly explanation:string},readonly fillBlank:{readonly prompt:string,readonly blanks:readonly CanonicalBlank[],readonly explanation:string} }} */
export function isQuizPairDraft(value) { return validateQuizPairDraft(value); }

/** Remove randomly selected distractors, preserving every correct option and remaining order.
 * @template {{readonly key:string}} T @param {readonly T[]} options @param {readonly string[]} correctKeys @param {()=>number} random @returns {readonly T[]}
 */
export function limitChoiceOptions(options, correctKeys, random = Math.random) {
  const kept = [...options];
  while (kept.length > 5) {
    const incorrect = kept.flatMap((option, index) => correctKeys.includes(option.key) ? [] : [index]);
    if (incorrect.length === 0) break;
    const draw = random();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new TypeError("Quiz option random draw is invalid.");
    kept.splice(incorrect[Math.floor(draw * incorrect.length)], 1);
  }
  return freeze(kept);
}

/** Apply the owner's count fallback only to a structurally coherent pair. Raw provider evidence remains immutable.
 * Excess recall entries become supplied context; their corresponding choice options are removed, never relabeled wrong.
 * @param {unknown} value @param {()=>number} [random] @returns {unknown}
 */
export function normalizeQuizPairDraftLimits(value, random = Math.random) {
  if (validateQuizPairDraft(value) || !validQuizPairDraftStructure(value)) return value;
  const answers = value.canonicalAnswers.slice(0, 3);
  const correctOptionAnswers = answers.map(answer => value.multipleChoice.correctOptionAnswers.find(entry => normalize(entry.canonicalAnswer) === normalize(answer)));
  const correctOptionKeys = correctOptionAnswers.map(entry => /** @type {{key:string}} */ (entry).key);
  const removedKeys = value.multipleChoice.correctOptionKeys.filter(key => !correctOptionKeys.includes(key));
  let position = 0;
  const prompt = value.fillBlank.prompt.replace(/(?<!_)____(?!_)/gu, () => {
    const index = position++;
    return index < 3 ? "____" : value.fillBlank.blanks[index].canonicalAnswer;
  });
  const candidate = { ...value, canonicalAnswers: answers,
    multipleChoice: { ...value.multipleChoice, correctOptionKeys, correctOptionAnswers, options: limitChoiceOptions(value.multipleChoice.options.filter(option => !removedKeys.includes(option.key)), correctOptionKeys, random) },
    fillBlank: { ...value.fillBlank, prompt, blanks: value.fillBlank.blanks.slice(0, 3) },
  };
  return validateQuizPairDraft(candidate) ? candidate : value;
}

/** Apply the same fallback to verified/persisted pairs before pool ingestion, preserving variant identities.
 * @param {unknown} value @param {()=>number} [random] @returns {unknown}
 */
export function normalizeAssembledQuizPairLimits(value, random = Math.random) {
  if (validateAssembledQuizPair(value) || !validAssembledQuizPairStructure(value)) return value;
  const raw = normalizeQuizPairDraftLimits({ knowledgeId: "limit-normalization", knowledgeRevision: 1, canonicalAnswers: value.canonicalAnswers, citedEvidenceUrls: value.citedEvidenceUrls,
    multipleChoice: { prompt: value.multipleChoice.prompt, options: value.multipleChoice.options, correctOptionKeys: value.multipleChoice.correctOptionKeys, correctOptionAnswers: value.multipleChoice.correctOptionKeys.map((key, index) => ({ key, canonicalAnswer: value.canonicalAnswers[index] })), explanation: value.multipleChoice.explanation },
    fillBlank: { prompt: value.fillBlank.prompt, blanks: value.fillBlank.blanks, explanation: value.fillBlank.explanation },
  }, random);
  if (!validateQuizPairDraft(raw)) return value;
  const pair = assembleQuizPair(raw, "limit-normalization");
  return freeze({ ...pair, multipleChoice: freeze({ ...pair.multipleChoice, id: value.multipleChoice.id }), fillBlank: freeze({ ...pair.fillBlank, id: value.fillBlank.id }) });
}

/** Canonicalize redundant aliases only after the complete resulting draft passes the unchanged strict validator.
 * Keep the first spelling and order, including each blank's first canonical spelling, and distinct synonyms.
 * Unknown fields, counts, identities, answer mappings and prompt blanks remain strict; failed candidates stay raw.
 * The received provider object is never mutated or replaced in historical stage storage.
 * @param {unknown} value @returns {unknown}
 */
export function normalizeQuizPairDraftAliases(value) {
  if (validateQuizPairDraft(value)) return value;
  if (!record(value) || !record(value.fillBlank) || !Array.isArray(value.fillBlank.blanks) || !value.fillBlank.blanks.every(blank => record(blank) && textList(blank.acceptedAnswers) && blank.acceptedAnswers.length <= 12)) return value;
  const candidate = { ...value, fillBlank: { ...value.fillBlank, blanks: value.fillBlank.blanks.map(blank => {
    const seen = new Set();
    const acceptedAnswers = blank.acceptedAnswers.filter((/** @type {string} */ answer) => { const key = normalize(answer); if (seen.has(key)) return false; seen.add(key); return true; });
    return { ...blank, acceptedAnswers };
  }) } };
  return validateQuizPairDraft(candidate) ? candidate : value;
}

/** Explain all applicable strict paired-draft faults for the existing bounded regeneration.
 * This never changes acceptance or repairs provider data.
 * @param {unknown} value @returns {readonly string[]}
 */
export function quizPairDraftValidationIssues(value) {
  if (validateQuizPairDraft(value)) return freeze([]);
  const issues = [];
  if (!exactRecord(value, ["knowledgeId", "knowledgeRevision", "canonicalAnswers", "citedEvidenceUrls", "multipleChoice", "fillBlank"])) return freeze(["draft: return exactly the required paired-quiz fields."]);
  if (!text(value.knowledgeId)) issues.push("knowledgeId: use a nonempty knowledge ID.");
  if (typeof value.knowledgeRevision !== "number" || !Number.isSafeInteger(value.knowledgeRevision) || value.knowledgeRevision < 1) issues.push("knowledgeRevision: use a positive integer revision.");
  if (!textList(value.citedEvidenceUrls)) issues.push("citedEvidenceUrls: include nonempty cited source URLs.");
  const answers = textList(value.canonicalAnswers) ? value.canonicalAnswers : null;
  if (answers === null) issues.push("canonicalAnswers: include nonempty answer text.");
  else {
    if (answers.length > 3 || answers.some(answer => answer.length > 300)) issues.push("canonicalAnswers: use one to three answers of at most 300 characters.");
    if (new Set(answers.map(normalize)).size !== answers.length) issues.push("canonicalAnswers: all answers must be distinct after NFKC, whitespace and case normalization.");
  }
  const mc = value.multipleChoice;
  if (!exactRecord(mc, ["prompt", "options", "correctOptionKeys", "correctOptionAnswers", "explanation"])) issues.push("multipleChoice: return exactly prompt, options, correctOptionKeys, correctOptionAnswers and explanation.");
  else {
    if (!text(mc.prompt) || mc.prompt.length > 1_000) issues.push("multipleChoice.prompt: use nonempty text of at most 1000 characters.");
    if (!text(mc.explanation) || mc.explanation.length > 4_000) issues.push("multipleChoice.explanation: use nonempty text of at most 4000 characters.");
    const options = Array.isArray(mc.options) && mc.options.every(option => exactRecord(option, ["key", "text"]) && text(option.key) && text(option.text)) ? mc.options : null;
    if (options === null) issues.push("multipleChoice.options: each option needs exactly a nonempty key and text.");
    else {
      if (options.length < 2 || options.length > 5 || options.some(option => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(option.key) || option.text.length > 500)) issues.push("multipleChoice.options: use two to five valid option keys with text of at most 500 characters.");
      if (new Set(options.map(option => option.key)).size !== options.length) issues.push("multipleChoice.options: keys must be unique.");
      if (new Set(options.map(option => normalize(option.text))).size !== options.length) issues.push("multipleChoice.options: option texts must be unique after normalization.");
      if (answers?.some(answer => options.some(option => option.key === answer))) issues.push("canonicalAnswers: use answer text rather than option keys.");
    }
    const keys = textList(mc.correctOptionKeys) ? mc.correctOptionKeys : null;
    if (keys === null) issues.push("multipleChoice.correctOptionKeys: include nonempty correct option keys.");
    else if (new Set(keys).size !== keys.length || answers && keys.length !== answers.length || options && keys.some(key => !options.some(option => option.key === key))) issues.push("multipleChoice.correctOptionKeys: use one unique existing option key per canonical answer.");
    const mappings = Array.isArray(mc.correctOptionAnswers) && mc.correctOptionAnswers.every(entry => exactRecord(entry, ["key", "canonicalAnswer"]) && text(entry.key) && text(entry.canonicalAnswer)) ? mc.correctOptionAnswers : null;
    if (mappings === null) issues.push("multipleChoice.correctOptionAnswers: each entry needs exactly key and canonicalAnswer.");
    else {
      if (answers && (mappings.length !== answers.length || new Set(mappings.map(entry => normalize(entry.canonicalAnswer))).size !== answers.length || answers.some(answer => !mappings.some(entry => normalize(entry.canonicalAnswer) === normalize(answer))))) issues.push("multipleChoice.correctOptionAnswers: map each canonical answer exactly once, using the same answer text.");
      if (keys && keys.some((key, index) => key !== mappings[index]?.key)) issues.push("multipleChoice.correctOptionAnswers: keys must align with correctOptionKeys in corresponding order.");
    }
  }
  const fill = value.fillBlank;
  if (!exactRecord(fill, ["prompt", "blanks", "explanation"])) issues.push("fillBlank: return exactly prompt, blanks and explanation.");
  else {
    if (!text(fill.prompt) || fill.prompt.length > 1_000) issues.push("fillBlank.prompt: use nonempty text of at most 1000 characters.");
    if (!text(fill.explanation) || fill.explanation.length > 4_000) issues.push("fillBlank.explanation: use nonempty text of at most 4000 characters.");
    if (!Array.isArray(fill.blanks)) issues.push("fillBlank.blanks: include the ordered blank entries.");
    else {
      if (answers && fill.blanks.length !== answers.length) issues.push("fillBlank.blanks: include exactly one blank per canonical answer.");
      fill.blanks.forEach((blank, index) => {
        const field = `fillBlank.blanks[${index}]`;
        if (!exactRecord(blank, ["id", "canonicalAnswer", "acceptedAnswers"])) { issues.push(`${field}: return exactly id, canonicalAnswer and acceptedAnswers.`); return; }
        if (blank.id !== `blank-${index + 1}`) issues.push(`${field}.id: use sequential blank-${index + 1}.`);
        if (!text(blank.canonicalAnswer) || answers && index < answers.length && normalize(blank.canonicalAnswer) !== normalize(answers[index])) issues.push(`${field}.canonicalAnswer: use canonicalAnswers[${index}] without substituting a subset or combined phrase.`);
        if (!textList(blank.acceptedAnswers)) issues.push(`${field}.acceptedAnswers: include the canonical answer first; synonyms are optional.`);
        else {
          if (blank.acceptedAnswers.length > 12) issues.push(`${field}.acceptedAnswers: include at most 12 accepted answers.`);
          if (answers && index < answers.length && normalize(blank.acceptedAnswers[0]) !== normalize(answers[index])) issues.push(`${field}.acceptedAnswers[0]: use canonicalAnswers[${index}].`);
          const normalizedAliases = blank.acceptedAnswers.map(normalize);
          if (new Set(normalizedAliases).size !== normalizedAliases.length) {
            const duplicate = normalizedAliases.find((alias, aliasIndex) => normalizedAliases.indexOf(alias) < aliasIndex);
            issues.push(`${field}.acceptedAnswers: remove NFKC-equivalent, case or whitespace duplicate aliases. At least two entries normalize to ${JSON.stringify(duplicate)}; keep only one entry for each normalized value across this entire array. The canonical answer alone is sufficient.`);
          }
        }
      });
      if (typeof fill.prompt === "string" && (fill.prompt.match(/(?<!_)____(?!_)/gu) ?? []).length !== fill.blanks.length) issues.push("fillBlank.prompt: include exactly one ____ placeholder per blank entry.");
    }
  }
  return freeze(issues);
}

/** @param {unknown} value */
export function quizPairSchema(value) {
  if (value !== true) throw new TypeError("Quiz pair schema selector is invalid.");
  const string = { type: "string", minLength: 1 };
  const stringListSchema = { type: "array", minItems: 1, items: string };
  const draftSchema = { type: "object", additionalProperties: false, properties: {
    knowledgeId: string, knowledgeRevision: { type: "integer", minimum: 1 }, canonicalAnswers: { type: "array", description: quizAnswerQualityInstruction + " Choose one to three distinct compact terms or short phrases, each the exact answer text for one fill-blank position. Use the same ordered answers in correctOptionAnswers and fillBlank.blanks; do not list a combined phrase here when a blank asks for only one part. A single-choice quiz has one answer, one correct key and one blank; a multi-select quiz has one unique correct key and one blank per answer.", minItems: 1, maxItems: 3, items: { type: "string", minLength: 1, maxLength: 300 } }, citedEvidenceUrls: stringListSchema,
    multipleChoice: { type: "object", additionalProperties: false, properties: { prompt: string, options: { type: "array", minItems: 2, maxItems: 5, items: { type: "object", additionalProperties: false, properties: { key: string, text: string }, required: ["key", "text"] } }, correctOptionKeys: { ...stringListSchema, maxItems: 3, description: "Exactly one distinct existing option key per canonical answer and blank, in the same order as correctOptionAnswers and canonicalAnswers. The count must equal canonicalAnswers.length and fillBlank.blanks.length. Never repeat a key or map several canonical answers to one correct key." }, correctOptionAnswers: { type: "array", description: "One entry per canonical answer, in canonicalAnswers order. Each key must equal correctOptionKeys at the same index and uniquely identify a correct option; canonicalAnswer must be the exact same answer text as canonicalAnswers and fillBlank.blanks at that index, not the fuller option wording or a combined list.", minItems: 1, maxItems: 3, items: { type: "object", additionalProperties: false, properties: { key: string, canonicalAnswer: string }, required: ["key", "canonicalAnswer"] } }, explanation: string }, required: ["prompt", "options", "correctOptionKeys", "correctOptionAnswers", "explanation"] },
    fillBlank: { type: "object", additionalProperties: false, properties: { prompt: string, blanks: { type: "array", description: "Exactly one blank per canonical answer and correct option key, in prompt order, with sequential ids blank-1 onward and one ____ in the prompt per entry. At each index canonicalAnswer and acceptedAnswers[0] must be exactly canonicalAnswers at that index and the corresponding correctOptionAnswers answer text. Each answer must fill its actual sentence grammatically; do not substitute a subset, combined answer or explanatory statement.", minItems: 1, maxItems: 3, items: { type: "object", additionalProperties: false, properties: { id: string, canonicalAnswer: string, acceptedAnswers: { type: "array", description: "The exact canonical answer alone is sufficient. Synonyms are optional; begin with the exact canonical answer and include only distinct legitimate synonyms, never cosmetic glyph or Unicode variants that normalize to an existing entry. All entries must be unique after Unicode NFKC normalization, trimming, case folding and collapsing whitespace: capitalization, compatibility-character and whitespace variants are duplicates, not extra aliases.", minItems: 1, maxItems: 12, items: string } }, required: ["id", "canonicalAnswer", "acceptedAnswers"] } }, explanation: string }, required: ["prompt", "blanks", "explanation"] },
  }, required: ["knowledgeId", "knowledgeRevision", "canonicalAnswers", "citedEvidenceUrls", "multipleChoice", "fillBlank"] };
  return Object.freeze({ name: "paired_quiz_v4", schema: Object.freeze(draftSchema) });
}

/**
 * Derive repeatable IDs from immutable ownership/version identity.
 * @param {{ readonly sourceId: string, readonly knowledgeId: string, readonly revision: number }} scope
 * @returns {string}
 */
export function quizPairStableId(scope) {
  if (!record(scope) || !text(scope.sourceId) || !text(scope.knowledgeId) || !Number.isSafeInteger(scope.revision) || scope.revision < 1) throw new TypeError("Quiz pair identity is invalid.");
  return `quiz:${encodeURIComponent(scope.sourceId)}:${encodeURIComponent(scope.knowledgeId)}:r${scope.revision}`;
}

/** @param {unknown} value @param {string} stableId @returns {QuizPair} */
export function assembleQuizPair(value, stableId) {
  if (!validateQuizPairDraft(value) || !text(stableId) || stableId.endsWith(":")) throw new TypeError("Quiz pair draft is invalid.");
  const draft = value;
  const canonicalAnswers = freeze([...draft.canonicalAnswers]);
  const options = freeze(draft.multipleChoice.options.map((option) => freeze({ key: option.key, text: option.text })));
  const correctOptionKeys = freeze([...draft.multipleChoice.correctOptionKeys]);
  const blanks = freeze(draft.fillBlank.blanks.map((blank) => freeze({ id: blank.id, canonicalAnswer: blank.canonicalAnswer, acceptedAnswers: freeze([...blank.acceptedAnswers]) })));
  return freeze({
    canonicalAnswers,
    multipleChoice: freeze({ id: `${stableId}:mcq`, kind: correctOptionKeys.length === 1 ? "single-choice" : "multiple-choice", prompt: draft.multipleChoice.prompt, options, correctOptionKeys, canonicalAnswers, explanation: draft.multipleChoice.explanation }),
    fillBlank: freeze({ id: `${stableId}:fill`, kind: "fill-blank", prompt: draft.fillBlank.prompt, blanks, canonicalAnswers, explanation: draft.fillBlank.explanation }),
    citedEvidenceUrls: freeze([...draft.citedEvidenceUrls]),
  });
}

/** @param {unknown} value @returns {value is QuizPair} */
export function validateAssembledQuizPair(value) {
  return validAssembledQuizPairStructure(value) && value.canonicalAnswers.length <= 3 && value.multipleChoice.options.length <= 5;
}

/** @param {unknown} value @returns {value is QuizPair} */
function validAssembledQuizPairStructure(value) {
  if (!exactRecord(value, ["multipleChoice", "fillBlank", "canonicalAnswers", "citedEvidenceUrls"]) || !textList(value.canonicalAnswers) || !textList(value.citedEvidenceUrls) || new Set(value.canonicalAnswers.map(normalize)).size !== value.canonicalAnswers.length) return false;
  const answers = /** @type {readonly string[]} */ (value.canonicalAnswers);
  const mcq = value.multipleChoice;
  const fill = value.fillBlank;
  if (!record(mcq) || !exactRecord(mcq, ["id", "kind", "prompt", "options", "correctOptionKeys", "canonicalAnswers", "explanation"]) || !text(mcq.id) || (mcq.kind !== "single-choice" && mcq.kind !== "multiple-choice") || !text(mcq.prompt) || !text(mcq.explanation) || !Array.isArray(mcq.options) || mcq.options.length < 2 || !mcq.options.every((option) => exactRecord(option, ["key", "text"]) && text(option.key) && text(option.text)) || !textList(mcq.correctOptionKeys) || mcq.correctOptionKeys.length !== answers.length || !textList(mcq.canonicalAnswers) || mcq.canonicalAnswers.length !== answers.length || answers.some((answer) => !(/** @type {readonly string[]} */ (mcq.canonicalAnswers)).some((candidate) => normalize(candidate) === normalize(answer)))) return false;
  const options = /** @type {readonly ChoiceOption[]} */ (mcq.options);
  const correctKeys = /** @type {readonly string[]} */ (mcq.correctOptionKeys);
  if (new Set(options.map((option) => option.key)).size !== options.length || new Set(correctKeys).size !== correctKeys.length || correctKeys.some((key) => !options.some((option) => option.key === key)) || (mcq.kind === "single-choice") !== (correctKeys.length === 1)) return false;
  if (!record(fill) || !exactRecord(fill, ["id", "kind", "prompt", "blanks", "canonicalAnswers", "explanation"]) || !text(fill.id) || fill.kind !== "fill-blank" || !text(fill.prompt) || !Array.isArray(fill.blanks) || fill.blanks.length !== answers.length || !textList(fill.canonicalAnswers) || fill.canonicalAnswers.length !== answers.length || answers.some((answer, index) => normalize(/** @type {readonly string[]} */ (fill.canonicalAnswers)[index]) !== normalize(answer)) || !text(fill.explanation)) return false;
  const blanks = fill.blanks;
  if (!blanks.every((blank, index) => exactRecord(blank, ["id", "canonicalAnswer", "acceptedAnswers"]) && blank.id === `blank-${index + 1}` && text(blank.canonicalAnswer) && normalize(blank.canonicalAnswer) === normalize(answers[index]) && textList(blank.acceptedAnswers) && normalize(blank.acceptedAnswers[0]) === normalize(answers[index]))) return false;
  return (fill.prompt.match(/(?<!_)____(?!_)/gu) ?? []).length === blanks.length;
}
