-- Accept usable score-seven quizzes; preserve all existing quiz rows, keys and cancellation fences.

CREATE TABLE knowledge_workflow_quizzes_accept_seven (
  owner_id TEXT NOT NULL,
  quiz_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  knowledge_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  draft_fingerprint TEXT NOT NULL,
  draft_json TEXT NOT NULL CHECK (json_valid(draft_json)),
  score INTEGER NOT NULL CHECK (score >= 7 AND score <= 10),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1 AND attempt_number <= 4),
  status TEXT NOT NULL CHECK (status IN ('published', 'pending-review')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, quiz_id),
  UNIQUE (owner_id, run_id, knowledge_id),
  UNIQUE (owner_id, source_id, source_revision, draft_fingerprint),
  FOREIGN KEY (owner_id, run_id) REFERENCES knowledge_workflow_runs(owner_id, run_id)
) STRICT;

INSERT INTO knowledge_workflow_quizzes_accept_seven SELECT * FROM knowledge_workflow_quizzes;
DROP TABLE knowledge_workflow_quizzes;
ALTER TABLE knowledge_workflow_quizzes_accept_seven RENAME TO knowledge_workflow_quizzes;

CREATE TRIGGER knowledge_workflow_quizzes_active_attempt_insert
BEFORE INSERT ON knowledge_workflow_quizzes
WHEN EXISTS (SELECT 1 FROM knowledge_workflow_runs r WHERE r.owner_id = NEW.owner_id AND r.run_id = NEW.run_id AND r.state = 'abandoned')
  OR EXISTS (SELECT 1 FROM knowledge_workflow_run_tombstones t WHERE t.owner_id = NEW.owner_id AND t.run_id = NEW.run_id)
BEGIN SELECT RAISE(ABORT, 'WorkflowAttemptAbandoned'); END;

CREATE TRIGGER knowledge_workflow_quizzes_active_attempt_update
BEFORE UPDATE ON knowledge_workflow_quizzes
WHEN EXISTS (SELECT 1 FROM knowledge_workflow_runs r WHERE r.owner_id = NEW.owner_id AND r.run_id = NEW.run_id AND r.state = 'abandoned')
  OR EXISTS (SELECT 1 FROM knowledge_workflow_run_tombstones t WHERE t.owner_id = NEW.owner_id AND t.run_id = NEW.run_id)
BEGIN SELECT RAISE(ABORT, 'WorkflowAttemptAbandoned'); END;
