# Neon 协作化上线手册

## 当前默认值

生产环境仍应保持：

```text
QINGXI_STORAGE_BACKEND=blob
```

Neon 连接只放在 Vercel Server 环境变量中：`DATABASE_URL`。不要把 `DATABASE_URL_UNPOOLED`、`PGHOST` 或任何连接串写进前端、日志或仓库。

## Preview 验证顺序

1. 在 Vercel Neon Integration 中只给 Production 和 Preview 注入变量，Development 暂不注入；Sensitive 保持开启。
2. 在 Preview 对应环境拉取变量后，执行 `pnpm db:migrate:neon`。
3. 用仅在本机终端临时存在的环境变量执行 `pnpm db:seed:neon`。如需成员账号，额外提供 `QINGXI_OWNER_PASSWORD` 和 `QINGXI_EDITOR_PASSWORD`；脚本只写入哈希，不写明文。
4. 将 Preview 的 `QINGXI_STORAGE_BACKEND` 设置为 `neon`，访问 `/api/db-health` 确认健康状态。
5. 用两个浏览器账号分别修改不同 Day，再修改同一个字段；后一次应收到冲突提示，不能静默覆盖。
6. 导出 Blob 旧数据，核对 30 天内容、状态、图片勾选和复盘数据。

## Production 切换

只有 Preview 验收完成后，才由负责人单独授权以下动作：

1. 在 Production 执行迁移和播种。
2. 保留 Blob 为只读备份。
3. 将 `QINGXI_STORAGE_BACKEND` 改为 `neon` 并重新部署。
4. 观察至少 7 天；期间发现异常时，把开关改回 `blob`，不要删除 Blob 备份。

## 回滚边界

切回 Blob 只能回到最近一次 Blob 写入的状态，不能自动把 Neon 新产生的修改反向合并回 Blob。因此切换前后都要导出 JSON，并保留 Neon 只读数据，避免回滚造成数据分叉。

## 免费额度监控

Neon 控制台 Usage 作为数据库额度来源；Vercel 日志中只记录健康状态和错误类别，不记录连接串。达到额度预警时暂停内容导入和高频轮询，先导出备份再处理。
