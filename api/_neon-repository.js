import { query, transaction } from "./_db.js";

export const WORKSPACE_ID = process.env.QINGXI_WORKSPACE_ID || "qingxi";

function json(value) {
  return JSON.stringify(value ?? {});
}

export async function loadNeonWorkspace() {
  const workspace = await query("SELECT id, slug, name, version FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
  const content = await query("SELECT version, data FROM content_versions WHERE workspace_id = $1 ORDER BY version DESC LIMIT 1", [WORKSPACE_ID]);
  const tasks = await query(`
    SELECT t.day, t.content, t.version AS content_row_version,
      p.status, p.checks, p.manual_notes, p.assigned_to, p.version AS progress_version,
      r.data AS review, r.version AS review_version,
      COALESCE(jsonb_agg(jsonb_build_object('index', s.shot_index, 'done', s.done, 'version', s.version)
        ORDER BY s.shot_index) FILTER (WHERE s.shot_index IS NOT NULL), '[]'::jsonb) AS shots
    FROM tasks t
    LEFT JOIN task_progress p ON p.task_id = t.id
    LEFT JOIN reviews r ON r.task_id = t.id
    LEFT JOIN shot_progress s ON s.task_id = t.id
    WHERE t.workspace_id = $1
    GROUP BY t.day, t.content, t.version, p.status, p.checks, p.manual_notes, p.assigned_to,
      p.version, r.data, r.version
    ORDER BY t.day`, [WORKSPACE_ID]);
  const state = await query("SELECT today_shoot_plan, version FROM workspace_state WHERE workspace_id = $1", [WORKSPACE_ID]);
  const cursor = await query("SELECT COALESCE(MAX(id), 0) AS cursor FROM activity_log WHERE workspace_id = $1", [WORKSPACE_ID]);
  return {
    workspace: workspace.rows[0] || null,
    content: content.rows[0] || null,
    tasks: tasks.rows,
    state: state.rows[0] || null,
    cursor: Number(cursor.rows[0]?.cursor || 0),
  };
}

async function taskId(day) {
  const result = await query("SELECT id FROM tasks WHERE workspace_id = $1 AND day = $2", [WORKSPACE_ID, day]);
  return result.rows[0]?.id || null;
}

async function conflict(day, kind) {
  const id = await taskId(day);
  if (!id) return null;
  if (kind === "progress") {
    const result = await query("SELECT status, checks, manual_notes, assigned_to, version FROM task_progress WHERE task_id = $1", [id]);
    return result.rows[0] || null;
  }
  if (kind === "review") {
    const result = await query("SELECT data, version FROM reviews WHERE task_id = $1", [id]);
    return result.rows[0] || null;
  }
  return null;
}

export async function patchTaskProgress({ day, version, changes, actorId }) {
  const id = await taskId(day);
  if (!id) return { missing: true };
  return transaction(async (client) => {
    const result = await client.query(`
      UPDATE task_progress
      SET status = COALESCE($3, status),
          checks = COALESCE($4::jsonb, checks),
          manual_notes = COALESCE($5::jsonb, manual_notes),
          assigned_to = COALESCE($6, assigned_to),
          version = version + 1, updated_at = now(), updated_by = $2
      WHERE task_id = $1 AND version = $7
      RETURNING status, checks, manual_notes, assigned_to, version, updated_at`,
      [id, actorId, changes.status ?? null, changes.checks ? json(changes.checks) : null,
        changes.manualNotes ? json(changes.manualNotes) : null, changes.assignedTo ?? null, version]);
    if (!result.rowCount) return { conflict: await client.query("SELECT status, checks, manual_notes, assigned_to, version FROM task_progress WHERE task_id = $1", [id]).then((r) => r.rows[0]) };
    await client.query("INSERT INTO activity_log (workspace_id, actor_id, action, entity_type, entity_id, changed_fields) VALUES ($1,$2,$3,$4,$5,$6::jsonb)", [WORKSPACE_ID, actorId, "update", "task_progress", String(day), json(changes)]);
    return { row: result.rows[0] };
  });
}

export async function patchShot({ day, index, version, done, actorId }) {
  const id = await taskId(day);
  if (!id) return { missing: true };
  return transaction(async (client) => {
    const result = await client.query(`UPDATE shot_progress SET done=$3, version=version+1, updated_at=now(), updated_by=$2
      WHERE task_id=$1 AND shot_index=$4 AND version=$5 RETURNING shot_index, done, version, updated_at`, [id, actorId, Boolean(done), index, version]);
    if (!result.rowCount) {
      const current = await client.query("SELECT shot_index, done, version FROM shot_progress WHERE task_id=$1 AND shot_index=$2", [id, index]);
      return { conflict: current.rows[0] || null };
    }
    await client.query("INSERT INTO activity_log (workspace_id, actor_id, action, entity_type, entity_id, changed_fields) VALUES ($1,$2,$3,$4,$5,$6::jsonb)", [WORKSPACE_ID, actorId, "update", "shot_progress", `${day}:${index}`, json({ done })]);
    return { row: result.rows[0] };
  });
}

export async function patchReview({ day, version, data, actorId }) {
  const id = await taskId(day);
  if (!id) return { missing: true };
  return transaction(async (client) => {
    const result = await client.query(`UPDATE reviews SET data=$3::jsonb, version=version+1, updated_at=now(), updated_by=$2
      WHERE task_id=$1 AND version=$4 RETURNING data, version, updated_at`, [id, actorId, json(data), version]);
    if (!result.rowCount) {
      const current = await client.query("SELECT data, version FROM reviews WHERE task_id=$1", [id]);
      return { conflict: current.rows[0] || null };
    }
    await client.query("INSERT INTO activity_log (workspace_id, actor_id, action, entity_type, entity_id, changed_fields) VALUES ($1,$2,$3,$4,$5,$6::jsonb)", [WORKSPACE_ID, actorId, "update", "review", String(day), json(data)]);
    return { row: result.rows[0] };
  });
}

export async function listChanges(cursor) {
  const result = await query(`SELECT id, actor_id, action, entity_type, entity_id, changed_fields, created_at
    FROM activity_log WHERE workspace_id=$1 AND id>$2 ORDER BY id LIMIT 200`, [WORKSPACE_ID, cursor]);
  return result.rows;
}

export async function importContent(content, actorId, importId) {
  const counts = {
    contentPlan: Array.isArray(content.contentPlan) ? content.contentPlan.length : 0,
    fullContent: Array.isArray(content.fullContent) ? content.fullContent.length : 0,
    products: Array.isArray(content.products) ? content.products.length : 0,
    library: Array.isArray(content.library) ? content.library.length : 0,
  };
  return transaction(async (client) => {
    const current = await client.query("SELECT COALESCE(MAX(version),0) AS version FROM content_versions WHERE workspace_id=$1", [WORKSPACE_ID]);
    const version = Number(current.rows[0].version) + 1;
    const contentId = `${WORKSPACE_ID}:content:${version}`;
    await client.query("INSERT INTO content_versions (id, workspace_id, version, data, created_by) VALUES ($1,$2,$3,$4::jsonb,$5)", [contentId, WORKSPACE_ID, version, json(content), actorId]);
    for (const item of content.contentPlan || []) {
      const day = Number(item.day);
      if (!Number.isInteger(day) || day < 1 || day > 30) continue;
      const taskIdValue = `${WORKSPACE_ID}:day:${day}`;
      const full = (content.fullContent || []).find((entry) => Number(entry.day) === day) || {};
      await client.query(`INSERT INTO tasks (id, workspace_id, day, content, content_version_id, updated_by)
        VALUES ($1,$2,$3,$4::jsonb,$5,$6)
        ON CONFLICT (workspace_id,day) DO UPDATE SET content=EXCLUDED.content, content_version_id=EXCLUDED.content_version_id,
          version=tasks.version+1, updated_at=now(), updated_by=EXCLUDED.updated_by`, [taskIdValue, WORKSPACE_ID, day, json({ ...item, fullContent: full }), contentId, actorId]);
      await client.query(`INSERT INTO task_progress (task_id, workspace_id, updated_by) VALUES ($1,$2,$3) ON CONFLICT (task_id) DO NOTHING`, [taskIdValue, WORKSPACE_ID, actorId]);
      await client.query(`INSERT INTO reviews (task_id, workspace_id, updated_by) VALUES ($1,$2,$3) ON CONFLICT (task_id) DO NOTHING`, [taskIdValue, WORKSPACE_ID, actorId]);
      const imagePlan = Array.isArray(full.imagePlan)
        ? full.imagePlan
        : (Array.isArray(full.shotPlan) ? full.shotPlan : []);
      for (let index = 0; index < imagePlan.length; index += 1) {
        await client.query(`INSERT INTO shot_progress (task_id, workspace_id, shot_index, updated_by)
          VALUES ($1,$2,$3,$4) ON CONFLICT (task_id, shot_index) DO NOTHING`,
        [taskIdValue, WORKSPACE_ID, index, actorId]);
      }
    }
    await client.query("INSERT INTO import_runs (id, workspace_id, status, counts, completed_at, created_by) VALUES ($1,$2,'committed',$3::jsonb,now(),$4)", [importId, WORKSPACE_ID, json(counts), actorId]);
    await client.query("INSERT INTO activity_log (workspace_id, actor_id, action, entity_type, entity_id, changed_fields) VALUES ($1,$2,'import','content_version',$3,$4::jsonb)", [WORKSPACE_ID, actorId, contentId, json(counts)]);
    return { version, counts };
  });
}

export { conflict };
