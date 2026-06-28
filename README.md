# 清熙小院小红书 30 天起号运营工作台

这是一个给清熙小院内部使用的小红书运营工作台。页面部署在 Vercel，运营数据使用 Vercel Blob 保存为一个线上 JSON 文件，同时保留浏览器 localStorage 作为本地缓存。

不使用 Supabase、Firebase 或传统数据库。

## 访问与保存方式

- 访问保护：进入工作台前输入一个站点访问密码。
- 线上主存储：Vercel Blob，默认文件名 `qingxi-workbench.json`。
- 本地缓存：当前浏览器 localStorage，key 为 `qingxi_xhs_workbench_v1`。
- 自动读取：访问密码通过后，页面自动读取 Blob 数据。
- 自动保存：修改状态、checkbox、复盘、备注或编辑内容后，自动保存到 Blob。
- 备份兜底：仍保留导出 / 导入 JSON。

保存内容包括 30 天任务状态、发布检查 checkbox、复盘数据、备注、当前查看 day、手动编辑内容、产品库、资料库和完整 30 天基础内容。

## Vercel 环境变量

部署前需要在 Vercel Project 里配置：

```text
QINGXI_SITE_PASSWORD=你自己设置的访问密码
QINGXI_SESSION_SECRET=一串随机长密钥
BLOB_STORE_ID=Vercel Blob 自动提供
VERCEL_OIDC_TOKEN=Vercel 自动提供
QINGXI_BLOB_PATH=qingxi-workbench.json
QINGXI_BLOB_ACCESS=private
```

说明：

- `QINGXI_SITE_PASSWORD` 是打开网站时输入的访问密码。
- `QINGXI_SESSION_SECRET` 用来签发访问 cookie，不需要记住，也不要发给别人。
- 如果还没有迁移变量名，旧的 `QINGXI_ADMIN_TOKEN` 也会被当作访问密码兼容使用。
- `BLOB_STORE_ID` 和 OIDC 相关变量由 Vercel Blob Store 绑定项目后自动注入。
- `QINGXI_BLOB_PATH` 可不填，默认就是 `qingxi-workbench.json`。
- `QINGXI_BLOB_ACCESS` 建议使用 `private`。

## 部署到 Vercel

1. 在 Vercel 新建 Project，导入 GitHub 仓库 `Crnobog9527/qingxi_yunying`。
2. 在 Storage / Blob 中创建并绑定一个 Blob Store。
3. 在 Project Settings / Environment Variables 中设置 `QINGXI_SITE_PASSWORD` 和 `QINGXI_SESSION_SECRET`。
4. 部署完成后打开线上地址。
5. 输入访问密码进入工作台。
6. 页面会自动读取线上数据，日常修改会自动保存。

## 本地开发

安装依赖：

```bash
pnpm install
```

启动带 API Routes 和 Middleware 的本地开发环境：

```bash
pnpm exec vercel dev
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

但 `python3 -m http.server` 只会启动静态文件，不能测试访问密码、Middleware、API Routes 或 Blob 保存。

## 日常使用建议

- 日常使用固定域名：`https://qingxi.grayscalegroup.cn`。
- 换电脑或换浏览器时，输入访问密码即可自动读取线上数据。
- 重要节点仍建议点击“导出 JSON”，留一份本地备份。
- 不要把访问密码发给不需要修改数据的人。
- 如果页面提示线上保存失败，先导出 JSON 备份，再检查 Vercel 环境变量和 Blob Store 绑定。

## 构建

当前项目是静态页面 + Vercel API Routes + Middleware。构建会把静态文件复制到 `public/`：

```bash
pnpm run build
```
