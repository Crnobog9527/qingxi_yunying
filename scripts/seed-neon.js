import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { Pool } from "@neondatabase/serverless";
import { hashPassword } from "../api/_password.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("请先设置 DATABASE_URL；本脚本不会从项目文件读取密钥。");

async function loadWindowFile(path) {
  const code = await readFile(path, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox, { filename: path });
  return sandbox.window;
}

  const data = await loadWindowFile("src/data.js");
  const full = await loadWindowFile("src/fullContent.js");
  const content = {
  contentPlan: data.QINGXI_DATA?.contentPlan || [],
  fullContent: full.QINGXI_FULL_CONTENT || [],
  products: data.QINGXI_DATA?.products || [],
  library: data.QINGXI_DATA?.library || [],
};
const actor = process.env.QINGXI_SEED_ACTOR || "seed-script";
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(`INSERT INTO workspaces (id, slug, name, updated_by) VALUES ($1,$2,$3,$4)
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, updated_at=now(), updated_by=EXCLUDED.updated_by`, ["qingxi", "qingxi-yunying", "清熙小院运营工作台", actor]);
  await client.query(`INSERT INTO workspace_state (workspace_id, updated_by) VALUES ($1,$2) ON CONFLICT (workspace_id) DO NOTHING`, ["qingxi", actor]);
  for (const member of [
    { id: "owner", username: process.env.QINGXI_OWNER_USERNAME || "owner", display: "Owner", role: "owner", password: process.env.QINGXI_OWNER_PASSWORD },
    { id: "editor", username: process.env.QINGXI_EDITOR_USERNAME || "editor", display: "Editor", role: "editor", password: process.env.QINGXI_EDITOR_PASSWORD },
  ]) {
    if (!member.password) continue;
    const passwordHash = await hashPassword(member.password);
    await client.query(`INSERT INTO members (id,workspace_id,username,display_name,role,password_hash,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (workspace_id,username) DO UPDATE SET display_name=EXCLUDED.display_name, role=EXCLUDED.role, password_hash=EXCLUDED.password_hash,
      version=members.version+1, updated_at=now(), updated_by=EXCLUDED.updated_by`, [member.id, "qingxi", member.username, member.display, member.role, passwordHash, actor]);
  }
  const versionResult = await client.query("SELECT COALESCE(MAX(version),0)+1 AS version FROM content_versions WHERE workspace_id=$1", ["qingxi"]);
  const version = Number(versionResult.rows[0].version);
  const contentId = `qingxi:content:${version}`;
  await client.query("INSERT INTO content_versions (id, workspace_id, version, data, created_by) VALUES ($1,$2,$3,$4::jsonb,$5)", [contentId, "qingxi", version, JSON.stringify(content), actor]);
  for (const item of content.contentPlan) {
    const day = Number(item.day);
    if (!Number.isInteger(day) || day < 1 || day > 30) continue;
    const taskId = `qingxi:day:${day}`;
    const fullItem = content.fullContent.find((entry) => Number(entry.day) === day) || {};
    await client.query(`INSERT INTO tasks (id,workspace_id,day,content,content_version_id,updated_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6)
      ON CONFLICT (workspace_id,day) DO UPDATE SET content=EXCLUDED.content, content_version_id=EXCLUDED.content_version_id,
      version=tasks.version+1, updated_at=now(), updated_by=EXCLUDED.updated_by`, [taskId, "qingxi", day, JSON.stringify({ ...item, fullContent: fullItem }), contentId, actor]);
    await client.query("INSERT INTO task_progress (task_id,workspace_id,updated_by) VALUES ($1,$2,$3) ON CONFLICT (task_id) DO NOTHING", [taskId, "qingxi", actor]);
    await client.query("INSERT INTO reviews (task_id,workspace_id,updated_by) VALUES ($1,$2,$3) ON CONFLICT (task_id) DO NOTHING", [taskId, "qingxi", actor]);
    const imagePlan = fullItem.imagePlan || fullItem.shotPlan || [];
    for (let index = 0; index < imagePlan.length; index += 1) {
      await client.query("INSERT INTO shot_progress (task_id,workspace_id,shot_index,updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (task_id,shot_index) DO NOTHING", [taskId, "qingxi", index, actor]);
    }
  }
  await client.query("COMMIT");
  console.log(`Neon seed complete: ${content.contentPlan.length} tasks, content version ${version}`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
