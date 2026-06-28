# 清熙小院小红书 30 天起号本地运营工作台

这是一个 local-first 单机网页工具，只给一个人在固定电脑、固定浏览器里本地使用。

## 日常打开方式

推荐在项目目录启动一个固定本地地址：

```bash
python3 -m http.server 5173
```

然后打开：

```text
http://localhost:5173
```

这样每天使用的是同一个浏览器域名，localStorage 数据更稳定。

## 是否需要 npm

当前项目不是 Vite / React 项目，没有构建步骤，不需要：

```bash
npm install
npm run dev
npm run build
npm run preview
```

页面由 `index.html`、`src/app.js`、`src/data.js`、`src/fullContent.js` 和 `src/styles.css` 直接运行。

## 直接打开 index.html

直接双击 `index.html` 也能使用，但浏览器会使用 `file://` 路径保存本地数据。如果以后移动文件夹、换路径、换浏览器，可能看不到原来的进度。

更稳的方式是每天通过固定地址 `http://localhost:5173` 打开。

## 数据保存在哪里

运营进度保存在当前浏览器的 localStorage 中，key 为：

```text
qingxi_xhs_workbench_v1
```

包含任务状态、发布检查、复盘数据、手动编辑内容、最近保存时间和最近备份时间。

## 备份建议

每天运营结束后，在页面里点击“导出今日备份”，保存下载的 JSON 文件。

换电脑、换浏览器、清缓存前，请先导出 JSON，再到新环境导入。

## 数据丢失时

先找最近导出的 JSON 备份，在页面里导入恢复。没有备份时，只能恢复原始 30 天内容，无法找回已清除的本地进度。
