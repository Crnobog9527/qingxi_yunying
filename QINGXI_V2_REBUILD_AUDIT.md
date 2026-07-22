# Qingxi V2 rebuild audit

Status: QINGXI_V2_DEPLOYED

## Branch and deployment

- Branch: `feature/qingxi-emotion-workbench-v2`
- Implementation commit: `b471cb6`
- Preview: `https://qingxi-yunying-6vhuc8dzz-simons-projects-bfe3e99f.vercel.app`
- Preview deployment: `dpl_E4eRXmnJZUTML6ADe5JxqfhpSqkx`, Ready
- Production: `https://qingxi.grayscalegroup.cn`
- Final Production deployment: `dpl_4e6EzpiwV6oJo7v3MdJzcXY5mVaw`, Ready
- Production inspect also confirmed the `v2-workspace` function is present.

## New storage contract

The new runtime uses only:

- Table: `qingxi_app_v2`
- Workspace: `qingxi-v2`
- API: `GET/POST /api/v2-workspace`

The API creates the table and seeds the workspace on the first authenticated GET if the row does not exist. Saves use an atomic revision-checked update; a stale revision returns HTTP 409. The table definition is:

```sql
CREATE TABLE IF NOT EXISTS qingxi_app_v2 (
  workspace_id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## New data

- Source: `emotion-words-seed(1).json` only.
- Seed validation: 12 emotion words, 120 captions.
- Stable IDs for words, captions, products, publish logs, notes and library entries.
- Caption removal is archive-only.
- Publish logs keep title/body/tags/full-text snapshots.
- Shanghai-date shoot checks use `Asia/Shanghai`.
- Metric nulls are excluded from averages; numeric 0 remains valid.
- Export and restore operate on complete V2 JSON.

## UI

The old 30-day, task-board, weekly-review, analytics and progress flows were removed from the active SPA. The new six entries are:

1. 今日发布
2. 词库管理
3. 发布日志
4. 拍摄清单
5. 排期笔记
6. 产品 / 资料

The login mechanism was left unchanged. New runtime code does not call the old Blob/workspace APIs. Old files, tables and Blob objects were not deleted.

## Files changed

- `.vercelignore`
- `index.html`
- `package.json`
- `pnpm-lock.yaml`
- `api/_http.js`
- `api/_v2-seed.js`
- `api/_v2.js`
- `api/v2-workspace.js`
- `src/app.js`
- `src/styles.css`
- `src/v2-model.js`
- `tests/v2-workbench.test.js`

## Verification

- `pnpm test`: 4 passed, 0 failed.
- `pnpm build`: passed.
- Node syntax checks for V2 API/model/app: passed.
- `git diff --check`: passed.
- Preview deployment: Ready.
- Production deployment: Ready.
- Production custom-domain login page: rendered successfully.
- Local Playwright mock smoke: 12 word cards, 6 mobile nav items, publish dialog opened, 375px viewport had no horizontal overflow (`scrollWidth=360`).
- Authenticated Production read/write smoke was not observed because no access password was supplied; no password or secret value was read or echoed.

## Legacy data boundary

No Blob data, old Neon workspace data, old 30-day content, migration registry, reconciliation output or schema-repair flow was read, migrated, merged, reconciled or deleted by the new runtime. The existing legacy files remain outside the active V2 entrypoint and legacy storage remains untouched.

## Remaining risk

The first authenticated Production GET is the point at which `qingxi_app_v2 / qingxi-v2` will be created or seeded. That live initialization and the authenticated add/publish/refresh round trip still require an authorized user session to observe; deployment itself is Ready.

