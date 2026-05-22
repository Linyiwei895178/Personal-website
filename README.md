# AI Debate Arena

一个完整的本地 AI 辩论项目。它可以让正方、反方和裁判围绕一个议题自动完成辩论，也支持导出 Markdown 或 JSON 记录。

## 功能

- 自定义辩题、正方立场、反方立场和裁判标准
- 自动生成开篇陈词、反驳、质询、总结陈词和裁判点评
- 支持 OpenAI-compatible `/chat/completions` 接口
- 没有 API key 时自动使用模拟 AI，方便立即体验完整流程
- 辩论记录可导出为 Markdown 或 JSON
- 零前端依赖，后端只使用 Node.js 内置模块

## 运行

请先确认已经安装 Node.js 18 或更高版本。

```bash
npm start
```

然后打开：

```text
http://localhost:5173
```

## 使用真实 AI

你可以在页面右侧打开“使用真实模型”，填入 API Key、Base URL 和模型名。

也可以用环境变量启动：

```bash
$env:OPENAI_API_KEY="你的 API Key"
$env:OPENAI_BASE_URL="https://api.openai.com/v1"
$env:OPENAI_MODEL="gpt-4.1-mini"
npm start
```

如果没有填写 API Key，项目会自动进入模拟 AI 模式。

## 项目结构

```text
.
├── package.json
├── server.js
├── public
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── README.md
```

## 后续可扩展方向

- 增加多人在线房间
- 增加辩论评分细则和雷达图
- 增加流式输出
- 给不同辩手配置不同模型或人格
- 保存历史辩论到本地数据库
