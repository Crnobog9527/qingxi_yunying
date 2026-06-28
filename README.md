# 清熙小院小红书 30 天起号运营工作台

这是一个给清熙小院内部使用的小红书运营工作台。页面本身部署到 Vercel，运营数据使用 Vercel Blob 保存为一个线上 JSON 文件，同时保留浏览器 localStorage 作为本地缓存和兜底。

不使用 Supabase、Firebase 或传统数据库。

## 数据保存方式

- 线上主存储：Vercel Blob，默认文件名 `qingxi-workbench.json`
- 本地缓存：当前浏览器 localStorage
- 本地缓存 key：`qingxi_xhs_workbench_v1`
- 线上口令缓存 key：`qingxi_xhs_cloud_auth_v1`

保存内容包括 30 天任务状态、发布检查 checkbox、复盘数据、备注、当前查看 day、手动编辑内容、产品库、资料库和完整 30 天基础内容。

## Vercel 环境变量

部署前需要在 Vercel Project 里配置：

```text
QINGXI_ADMIN_TOKEN=你自己设置的管理口令
BLOB_READ_WRITE_TOKEN=Vercel Blob 自动提供
QINGXI_BLOB_PATH=qingxi-workbench.json
QINGXI_BLOB_ACCESS=private
```

说明：

- `QINGXI_ADMIN_TOKEN` 是页面里“连接线上存储”时输入的口令。
- `BLOB_READ_WRITE_TOKEN` 由 Vercel Blob Store 绑定项目后自动注入。
- `QINGXI_BLOB_PATH` 可不填，默认就是 `qingxi-workbench.json`。
- `QINGXI_BLOB_ACCESS` 建议使用 `private`。

## 部署到 Vercel

1. 在 Vercel 新建 Project，导入 GitHub 仓库 `Crnobog9527/qingxi_yunying`。
2. 在 Storage / Blob 中创建并绑定一个 Blob Store。
3. 在 Project Settings / Environment Variables 中设置 `QINGXI_ADMIN_TOKEN`。
4. 部署完成后打开线上地址。
5. 页面顶部点击“连接线上存储”，输入同一个口令。
6. 第一次连接时，如果线上还没有数据，页面会把当前本地进度保存到线上。

## 本地开发

安装依赖：

```bash
pnpm install
```

启动带 API Routes 的本地开发环境：

```bash
pnpm run dev
```

然后打开 Vercel CLI 给出的本地地址，通常是：

```text
http://localhost:3000
```

如果只是查看静态页面，也可以运行：

```bash
pnpm run serve
```

然后打开：

```text
http://localhost:5173
```

但 `python3 -m http.server` 只会启动静态文件，不能调用 `/api/load-data` 和 `/api/save-data`，因此不能测试线上 Blob 保存。

## 日常使用建议

- 日常使用固定的 Vercel 页面地址。
- 每次换电脑或换浏览器，先点击“连接线上存储”，再点“从线上读取”。
- 重要节点仍建议点击“导出 JSON”，留一份本地备份。
- 不要把 `QINGXI_ADMIN_TOKEN` 发给不需要改数据的人。
- 如果页面提示线上保存失败，先导出 JSON 备份，再检查 Vercel 环境变量和 Blob Store 绑定。

## 构建

当前项目是静态页面 + Vercel API Routes，没有前端构建步骤：

```bash
pnpm run build
```

该命令只输出提示，用于说明项目不需要打包。
