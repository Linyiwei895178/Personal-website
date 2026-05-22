const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sanitizePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const safePath = decoded === "/" ? "/index.html" : decoded;
  const resolved = path.normalize(path.join(PUBLIC_DIR, safePath));
  return resolved.startsWith(PUBLIC_DIR) ? resolved : null;
}

async function handleChat(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const baseUrl = (body.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const apiKey = body.apiKey || process.env.OPENAI_API_KEY;
    const model = body.model || process.env.OPENAI_MODEL || "gpt-4.1-mini";

    if (!apiKey) {
      sendJson(res, 200, {
        mode: "mock",
        text: buildMockResponse(body)
      });
      return;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: body.messages || [],
        temperature: Number(body.temperature ?? 0.7),
        max_tokens: Number(body.maxTokens ?? 700)
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      sendJson(res, response.status, {
        error: payload.error?.message || `Model request failed with status ${response.status}.`
      });
      return;
    }

    sendJson(res, 200, {
      mode: "live",
      text: payload.choices?.[0]?.message?.content || ""
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
}

function buildMockResponse(body) {
  const lastUser = [...(body.messages || [])].reverse().find((message) => message.role === "user")?.content || "";
  const topic = matchField(lastUser, "Topic") || matchField(lastUser, "议题") || "the topic";
  const role = matchField(lastUser, "Speaker") || matchField(lastUser, "发言方") || "Debater";
  const phase = matchField(lastUser, "Round") || matchField(lastUser, "环节") || "speech";

  if (/judge|裁判|评审/i.test(role) || /judge|裁判|评审/i.test(phase)) {
    return [
      `裁判意见：围绕“${topic}”，双方都提出了可比较的理由。`,
      "胜方：暂定为论证更具体、回应更直接的一方。",
      "关键依据：1. 是否定义清楚；2. 是否回应对方最强论点；3. 是否给出可检验的例子。",
      "改进建议：下一轮应减少抽象判断，补充数据、案例或边界条件。"
    ].join("\n\n");
  }

  const openings = [
    `我方在“${topic}”上主张先把判断标准说清楚：一个好立场不仅要听起来合理，还要能解释真实场景中的取舍。`,
    `核心论点有三点。第一，它能带来更高的长期收益；第二，它降低了系统性风险；第三，它比反方方案更容易执行。`,
    "我也承认对方可能会强调短期成本，但短期摩擦不等于长期不可行。真正要比较的是总成本，而不是眼前最显眼的成本。"
  ];

  const rebuttals = [
    `针对对方在“${topic}”上的说法，我认为最大问题是把局部现象当成整体规律。`,
    "对方的论证需要证明两个环节：这个问题普遍存在，以及他们的方案能稳定解决它。现在看，第二个环节还没有被充分证明。",
    "我方不是否认风险，而是认为风险可以通过规则、激励和反馈机制管理。"
  ];

  const cross = [
    `我想追问一个问题：在“${topic}”中，如果出现资源有限、时间紧迫的情况，你方标准如何排序？`,
    "如果你方承认存在例外，那么例外的边界在哪里？谁来判断？",
    "请给出一个具体场景，说明你方方案比我方方案更少副作用。"
  ];

  const closing = [
    `总结来说，关于“${topic}”，我方的优势在于标准明确、路径可执行、能处理反例。`,
    "对方提出的担忧值得重视，但担忧本身不是结论。我们需要比较两套方案在真实世界中的净效果。",
    "因此，我方立场更稳健，也更适合作为最终判断。"
  ];

  const bank = /cross|质询/i.test(phase)
    ? cross
    : /rebut|反驳/i.test(phase)
      ? rebuttals
      : /close|总结/i.test(phase)
        ? closing
        : openings;

  return `${role}：\n\n${bank.join("\n\n")}`;
}

function matchField(text, label) {
  const match = text.match(new RegExp(`${label}\\s*[:：]\\s*(.+)`, "i"));
  return match?.[1]?.split("\n")[0]?.trim();
}

function serveStatic(req, res) {
  const filePath = sanitizePath(req.url || "/");
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/chat") {
    handleChat(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`AI Debate Arena is running at http://localhost:${PORT}`);
});
