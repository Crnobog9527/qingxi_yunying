ALTER TABLE shot_progress
  ADD COLUMN IF NOT EXISTS workspace_id TEXT;

UPDATE shot_progress AS shot
SET workspace_id = task.workspace_id
FROM tasks AS task
WHERE task.id = shot.task_id
  AND shot.workspace_id IS NULL;

ALTER TABLE shot_progress
  ALTER COLUMN workspace_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shot_progress_workspace_id_fkey'
  ) THEN
    ALTER TABLE shot_progress
      ADD CONSTRAINT shot_progress_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
END $$;
