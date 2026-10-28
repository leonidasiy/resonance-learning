-- Preserve media records and provenance; seek active bindings per knowledge point.
CREATE INDEX knowledge_workflow_media_active_knowledge
  ON knowledge_workflow_media_assets(owner_id, knowledge_id, run_id, source_revision, asset_id)
  WHERE binding_json IS NOT NULL AND revoked_at IS NULL;
