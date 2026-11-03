-- Private owner-scoped examples survive card purges; no reason means no exclusion.
CREATE TABLE knowledge_deletion_feedback (
  owner_id TEXT NOT NULL,
  deletion_id TEXT NOT NULL,
  knowledge_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  main_subject TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, deletion_id)
);
CREATE INDEX knowledge_deletion_feedback_subject ON knowledge_deletion_feedback(owner_id, main_subject);
