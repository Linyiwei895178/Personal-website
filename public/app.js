const $ = (selector) => document.querySelector(selector);

const elements = {
  topic: $("#topic"),
  sideA: $("#sideA"),
  sideB: $("#sideB"),
  roundCount: $("#roundCount"),
  judgeCriteria: $("#judgeCriteria"),
  liveMode: $("#liveMode"),
  apiKey: $("#apiKey"),
  baseUrl: $("#baseUrl"),
  model: $("#model"),
  temperature: $("#temperature"),
  maxTokens: $("#maxTokens"),
  transcript: $("#transcript"),
  currentRound: $("#currentRound"),
  progressLabel: $("#progressLabel"),
  modeLabel: $("#modeLabel"),
  startDebate: $("#startDebate"),
  nextTurn: $("#nextTurn"),
  autoRun: $("#autoRun"),
  resetDebate: $("#resetDebate"),
  exportMarkdown: $("#exportMarkdown"),
  exportJson: $("#exportJson"),
  template: $("#messageTemplate")
};

const STORAGE_KEY = "ai-debate-arena-settings";

let state = {
  plan: [],
  turnIndex: 0,
  transcript: [],
  running: false,
  liveResponses: false
};

function getSettings() {
  return {
    topic: elements.topic.value.trim(),
    sideA: elements.sideA.value.trim(),
    sideB: elements.sideB.value.trim(),
    roundCount: clamp(Number(elements.roundCount.value), 1, 3),
    judgeCriteria: elements.judgeCriteria.value.trim(),
    liveMode: elements.liveMode.checked,
    apiKey: elements.apiKey.value.trim(),
    baseUrl: elements.baseUrl.value.trim(),
    model: elements.model.value.trim(),
    temperature: Number(elements.temperature.value || 0.7),
    maxTokens: Number(elements.maxTokens.value || 520)
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value || min, min), max);
}

function saveSettings() {
  const settings = getSettings();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...settings,
      apiKey: ""
    })
  );
}

function loadSettings() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;
  try {
    const settings = JSON.parse(saved);
    Object.entries(settings).forEach(([key, value]) => {
      if (!elements[key] || key === "apiKey") return;
      if (elements[key].type === "checkbox") {
        elements[key].checked = Boolean(value);
      } else {
        elements[key].value = value;
      }
    });
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function buildPlan(settings) {
  const plan = [
    { phase: "开篇陈词", speaker: "正方", side: "A", stance: settings.sideA },
    { phase: "开篇陈词", speaker: "反方", side: "B", stance: settings.sideB }
  ];

  for (let i = 1; i <= settings.roundCount; i += 1) {
    plan.push(
      { phase: `第 ${i} 轮反驳`, speaker: "正方", side: "A", stance: settings.sideA },
      { phase: `第 ${i} 轮反驳`, speaker: "反方", side: "B", stance: settings.sideB },
      { phase: `第 ${i} 轮质询`, speaker: "正方", side: "A", stance: settings.sideA },
      { phase: `第 ${i} 轮质询`, speaker: "反方", side: "B", stance: settings.sideB }
    );
  }

  plan.push(
    { phase: "总结陈词", speaker: "正方", side: "A", stance: settings.sideA },
    { phase: "总结陈词", speaker: "反方", side: "B", stance: settings.sideB },
    { phase: "裁判点评", speaker: "裁判", side: "judge", stance: "中立裁判" }
  );

  return plan;
}

function startDebate() {
  const settings = getSettings();
  if (!settings.topic) {
    toast("请先填写辩题。");
    return;
  }

  state = {
    plan: buildPlan(settings),
    turnIndex: 0,
    transcript: [],
    running: false,
    liveResponses: false
  };

  elements.transcript.classList.remove("empty");
  elements.transcript.innerHTML = "";
  elements.nextTurn.disabled = false;
  elements.autoRun.disabled = false;
  updateStatus();
  runNextTurn();
}

async function runNextTurn() {
  if (state.running || state.turnIndex >= state.plan.length) return false;

  state.running = true;
  setActionState(false);

  const settings = getSettings();
  const turn = state.plan[state.turnIndex];
  const loadingId = addMessage({
    speaker: turn.speaker,
    phase: turn.phase,
    side: turn.side,
    text: "正在思考..."
  });

  try {
    const text = await requestAiSpeech(settings, turn);
    updateMessage(loadingId, text);
    state.transcript.push({
      speaker: turn.speaker,
      phase: turn.phase,
      side: turn.side,
      text,
      at: new Date().toISOString()
    });
    state.turnIndex += 1;
    saveSettings();
    return true;
  } catch (error) {
    updateMessage(loadingId, `生成失败：${error.message}`);
    toast(error.message);
    return false;
  } finally {
    state.running = false;
    setActionState(true);
    updateStatus();
  }
}

async function runAll() {
  while (state.turnIndex < state.plan.length) {
    const completed = await runNextTurn();
    if (!completed) break;
  }
}

function setActionState(enabled) {
  const complete = state.turnIndex >= state.plan.length;
  elements.nextTurn.disabled = !enabled || complete;
  elements.autoRun.disabled = !enabled || complete;
  elements.startDebate.disabled = !enabled;
}

async function requestAiSpeech(settings, turn) {
  const messages = buildMessages(settings, turn);
  const shouldUseLive = settings.liveMode && settings.apiKey;

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      apiKey: shouldUseLive ? settings.apiKey : "",
      baseUrl: settings.baseUrl,
      model: settings.model,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "AI 请求失败。");
  }

  state.liveResponses ||= payload.mode === "live";
  return payload.text || "没有生成内容。";
}

function buildMessages(settings, turn) {
  const priorTranscript = state.transcript
    .map((entry) => `${entry.phase}｜${entry.speaker}：${entry.text}`)
    .join("\n\n");

  const isJudge = turn.side === "judge";
  const system = isJudge
    ? "You are a strict debate judge. Decide based on argument quality, clash, evidence, and practical reasoning. Respond in Chinese."
    : "You are a skilled debate agent. Argue forcefully but fairly, address the best opposing arguments, and avoid fabricating statistics. Respond in Chinese.";

  const user = [
    `Topic: ${settings.topic}`,
    `Round: ${turn.phase}`,
    `Speaker: ${turn.speaker}`,
    `Position: ${turn.stance}`,
    `Affirmative: ${settings.sideA}`,
    `Negative: ${settings.sideB}`,
    `Judge Criteria: ${settings.judgeCriteria}`,
    priorTranscript ? `Transcript so far:\n${priorTranscript}` : "Transcript so far: none",
    isJudge
      ? "请给出胜方、比分、关键理由和双方改进建议。"
      : "请生成本轮发言。结构要清楚，有论点、有回应、有现实例子。不要超过设定长度。"
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

function addMessage(entry) {
  const id = crypto.randomUUID();
  const node = elements.template.content.firstElementChild.cloneNode(true);
  node.dataset.id = id;
  node.classList.toggle("side-b", entry.side === "B");
  node.classList.toggle("judge", entry.side === "judge");
  node.querySelector(".speaker").textContent = entry.speaker;
  node.querySelector(".round").textContent = entry.phase;
  node.querySelector(".message-body").textContent = entry.text;
  elements.transcript.appendChild(node);
  elements.transcript.scrollTop = elements.transcript.scrollHeight;
  return id;
}

function updateMessage(id, text) {
  const node = elements.transcript.querySelector(`[data-id="${id}"]`);
  if (!node) return;
  node.querySelector(".message-body").textContent = text;
  elements.transcript.scrollTop = elements.transcript.scrollHeight;
}

function updateStatus() {
  const current = state.plan[state.turnIndex];
  elements.currentRound.textContent = current ? `${current.phase}｜${current.speaker}` : "已完成";
  elements.progressLabel.textContent = `${Math.min(state.turnIndex, state.plan.length)} / ${state.plan.length}`;
  elements.modeLabel.textContent = state.liveResponses ? "真实模型" : "模拟 AI";
}

function resetDebate() {
  state = {
    plan: [],
    turnIndex: 0,
    transcript: [],
    running: false,
    liveResponses: false
  };
  elements.transcript.classList.add("empty");
  elements.transcript.innerHTML = `
    <div class="empty-state">
      <h2>设置议题后开始辩论</h2>
      <p>双方 AI 会按开篇、反驳、质询、总结和裁判点评推进。没有 API key 时也能先用模拟模式跑完整流程。</p>
    </div>
  `;
  elements.nextTurn.disabled = true;
  elements.autoRun.disabled = true;
  elements.startDebate.disabled = false;
  updateStatus();
}

function exportMarkdown() {
  if (!state.transcript.length) {
    toast("还没有辩论记录可导出。");
    return;
  }

  const settings = getSettings();
  const content = [
    `# AI Debate Arena`,
    "",
    `辩题：${settings.topic}`,
    "",
    `正方：${settings.sideA}`,
    "",
    `反方：${settings.sideB}`,
    "",
    ...state.transcript.flatMap((entry) => [
      `## ${entry.phase}｜${entry.speaker}`,
      "",
      entry.text,
      ""
    ])
  ].join("\n");

  downloadFile("ai-debate-transcript.md", content, "text/markdown;charset=utf-8");
}

function exportJson() {
  if (!state.transcript.length) {
    toast("还没有辩论记录可导出。");
    return;
  }

  downloadFile(
    "ai-debate-transcript.json",
    JSON.stringify({ settings: getSettings(), transcript: state.transcript }, null, 2),
    "application/json;charset=utf-8"
  );
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2800);
}

document.addEventListener("input", (event) => {
  if (event.target.closest("#settingsForm")) saveSettings();
});
elements.startDebate.addEventListener("click", startDebate);
elements.nextTurn.addEventListener("click", runNextTurn);
elements.autoRun.addEventListener("click", runAll);
elements.resetDebate.addEventListener("click", resetDebate);
elements.exportMarkdown.addEventListener("click", exportMarkdown);
elements.exportJson.addEventListener("click", exportJson);

loadSettings();
updateStatus();
