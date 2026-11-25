import {
  FAULTS, SCENARIOS, NOISE_LABELS, generateCase, addInterference,
  classify, diagnoseAdvanced, evaluate, evaluateAdvanced, scenarioId,
} from "./model.mjs";

const $ = id => document.getElementById(id);
const names = ["温度", "电量", "信号强度"];
const canvases = names.map((_, index) => $(`chart-${index}`));
const form = $("diagnose");
const experiment = $("experiment");
const findFault = id => SCENARIOS.find(fault => fault.id === id);
const choices = [...$("multi-options").querySelectorAll("input")];
const scores = { basic: [0, 0], advanced: [0, 0] };
let mode = "basic";
let advancedStarted = false;
let mission = 1;
let original = generateCase(813, "power");
let level = 0;
let minute = 17;
let selection = null;
let reportReady = false;
let advancedStudy;

function pathFor(ctx, coords) {
  ctx.beginPath();
  ctx.moveTo(...coords[0]);
  for (const coordinate of coords.slice(1)) ctx.lineTo(...coordinate);
}

function draw(canvas, values, index) {
  const { width, height } = canvas.getBoundingClientRect();
  if (width < 1 || height < 1) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const withTime = index === 2;
  const left = 30;
  const right = width - 10;
  const top = 8;
  const bottom = height - (withTime ? 21 : 5);
  const x = minute => left + minute / 17 * (right - left);
  const y = value => bottom - value / 100 * (bottom - top);
  ctx.lineWidth = 1;
  ctx.font = "11px Consolas, monospace";
  ctx.fillStyle = "#a8bad2";
  ctx.strokeStyle = "#23314a";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const value of [0, 50, 100]) {
    const row = y(value);
    pathFor(ctx, [[left, row], [right, row]]);
    ctx.stroke();
    ctx.fillText(value, left - 7, row);
  }
  ctx.textAlign = "center";
  for (const minute of [0, 4, 8, 12, 17]) {
    const column = x(minute);
    pathFor(ctx, [[column, top], [column, bottom]]);
    ctx.stroke();
    if (withTime) ctx.fillText(minute, column, bottom + 12);
  }
  const points = values.map((value, minute) => [x(minute), y(value)]);
  const color = FAULTS[index].color;
  const fill = ctx.createLinearGradient(0, top, 0, bottom);
  fill.addColorStop(0, color + "37");
  fill.addColorStop(1, color + "03");
  pathFor(ctx, points);
  ctx.lineTo(right, bottom);
  ctx.lineTo(left, bottom);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  pathFor(ctx, points);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  if (minute !== 17) {
    ctx.strokeStyle = "#bed3ef";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    pathFor(ctx, [[x(minute), top], [x(minute), bottom]]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.arc(...points[minute], 3, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
}

function renderTelemetry() {
  const sample = addInterference(original, level);
  canvases.forEach((canvas, index) => {
    const values = sample.frames.map(frame => frame[index]);
    $(`value-${index}`).value = values[minute].toFixed(1);
    canvas.setAttribute("aria-label", `${names[index]}模拟读数，从第 0 到 17 分钟，每分钟一个值：${values.map(value => value.toFixed(0)).join("、")}`);
    draw(canvas, values, index);
  });
  $("minute-readout").value = `第 ${minute} 分钟`;
  $("signal-mode").textContent = mode === "basic" && level ? "已加干扰" : NOISE_LABELS[level];
  $("signal-mode").classList.toggle("noisy", level > 0);
}

function renderResult() {
  const truth = findFault(original.fault);
  const diagnose = mode === "advanced" ? diagnoseAdvanced : classify;
  const clean = diagnose(original.frames);
  const current = level ? diagnose(addInterference(original, level).frames) : clean;
  const prediction = findFault(current.id);
  $("truth").textContent = truth.name;
  $("human-guess").textContent = findFault(selection).name;
  $("human-mark").textContent = selection === original.fault ? "正确" : "猜错";
  $("model-guess").textContent = prediction.name + (current.id === original.fault ? " · 正确" : " · 误判");
  $("vote-text").textContent = current.ranking.filter(item => item.votes > 0)
    .map(item => `${findFault(item.id).short} ${item.votes} 票`).join(" · ");
  $("votes").replaceChildren(...current.ranking.flatMap(item => Array.from({ length: item.votes }, () => {
    const line = document.createElement("i");
    line.style.background = findFault(item.id).color;
    return line;
  })));
  $("clue").textContent = mode === "basic" ? truth.clue : original.events.map(event => (
    `第 ${event.minute} 分钟开始：${findFault(event.id).name}`
  )).join(" · ") || "全程未注入故障，读数仍可能自然波动。";
  $("features").textContent = "模型使用的变化量（后 5 点均值减前 4 点均值）：" +
    current.vector.map((value, index) => `${names[index]} ${value > 0 ? "+" : ""}${value.toFixed(1)}`).join(" · ");
  $("comparison").textContent = level
    ? `原始：${findFault(clean.id).name}（${clean.votes}/5 票） · 干扰后：${prediction.name}（${current.votes}/5 票）`
    : "尝试增加干扰，对照同一个案例的模型判断。";
  $("noise").textContent = level ? "移除干扰" : "增加干扰";
  $("noise").setAttribute("aria-pressed", String(level > 0));
  $("noise-readout").value = NOISE_LABELS[level];
  $("announcement").textContent = `模拟设定为${truth.name}。模型判断为${prediction.name}，${current.votes}票。`;
}

function checkedFaults() {
  return choices.filter(input => input.checked).map(input => input.value);
}

function updateOptions(changed) {
  if (changed?.checked) {
    for (const input of choices) {
      if (input !== changed && (input.value === "none" || changed.value === "none")) input.checked = false;
    }
  }
  const checked = checkedFaults();
  for (const input of choices) input.disabled = checked.length === 2 && !input.checked && input.value !== "none";
  $("submit").disabled = !scenarioId(checked);
}

function showScore() {
  const [correct, completed] = scores[mode];
  $("score").value = `本次答对 ${correct} / ${completed}`;
}

form.addEventListener("change", event => {
  if (mode === "advanced") updateOptions(event.target);
  else $("submit").disabled = false;
});
form.addEventListener("submit", event => {
  event.preventDefault();
  if (selection) return;
  const value = mode === "advanced" ? scenarioId(checkedFaults()) : new FormData(form).get("fault");
  if (!findFault(value)) return;
  selection = value;
  scores[mode][1] += 1;
  if (selection === original.fault) scores[mode][0] += 1;
  showScore();
  $("diagnosis-step").textContent = "对照你的判断、模型判断与模拟设定";
  form.hidden = true;
  $("result").hidden = false;
  renderResult();
  $(mode === "advanced" ? "noise-level" : "noise").focus({ preventScroll: true });
});

$("noise").addEventListener("click", () => {
  level = level ? 0 : 2;
  renderTelemetry();
  renderResult();
});
$("noise-level").addEventListener("input", event => {
  level = Number(event.target.value);
  renderTelemetry();
  renderResult();
});
$("minute").addEventListener("input", event => {
  minute = Number(event.target.value);
  renderTelemetry();
});

function startRound({ demo = false, focus = false } = {}) {
  const advanced = mode === "advanced";
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const options = (advanced ? SCENARIOS : FAULTS).filter(fault => fault.id !== original.fault);
  original = demo ? generateCase(813, "power+signal") : generateCase(seed, options[seed % options.length].id);
  mission += 1;
  level = 0;
  minute = 17;
  selection = null;
  $("diagnosis-step").textContent = advanced ? "选设备正常，或勾选最多两种故障" : "选择一种最可能的原因";
  form.reset();
  form.hidden = false;
  $("options").hidden = $("options").disabled = advanced;
  $("multi-options").hidden = $("multi-options").disabled = !advanced;
  updateOptions();
  $("noise").hidden = advanced;
  $("noise-control").hidden = !advanced;
  $("noise-level").value = "0";
  $("minute").value = "17";
  $("submit").disabled = true;
  $("result").hidden = true;
  $("mission-id").textContent = `ORB-${String(mission).padStart(2, "0")}`;
  $("announcement").textContent = `第 ${mission} 局已开始。`;
  showScore();
  renderTelemetry();
  if (focus) {
    $("telemetry-title").scrollIntoView({ block: "start" });
    $(advanced ? "multi-options" : "options").querySelector("input").focus({ preventScroll: true });
  }
}

$("next").addEventListener("click", () => startRound({ focus: true }));
for (const type of ["basic", "advanced"]) {
  $(`${type}-mode`).addEventListener("click", () => {
    if (type === mode) return;
    mode = type;
    $("basic-mode").setAttribute("aria-pressed", String(mode === "basic"));
    $("advanced-mode").setAttribute("aria-pressed", String(mode === "advanced"));
    startRound({ demo: mode === "advanced" && !advancedStarted });
    if (mode === "advanced") advancedStarted = true;
  });
}

function renderMetrics(container, cases, sampleSize) {
  for (const [label, condition] of cases) {
    const card = document.createElement("div");
    card.className = "metric";
    const heading = document.createElement("span");
    heading.textContent = label;
    const score = document.createElement("strong");
    score.textContent = (100 * condition.correct / sampleSize).toFixed(1) + "%";
    const total = document.createElement("span");
    total.textContent = `识别正确 ${condition.correct} / ${sampleSize}`;
    card.append(heading, score, total);
    container.append(card);
  }
}

function renderMatrix(table, categories, matrix) {
  table.replaceChildren();
  const header = table.createTHead().insertRow();
  for (const label of ["实际 ↓　预测 →", ...categories.map(fault => fault.short)]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    header.append(cell);
  }
  const body = table.createTBody();
  matrix.forEach((values, index) => {
    const row = body.insertRow();
    const head = document.createElement("th");
    head.scope = "row";
    head.textContent = categories[index].short;
    row.append(head);
    values.forEach((value, column) => {
      const cell = row.insertCell();
      cell.textContent = value;
      cell.classList.toggle("match", column === index);
    });
  });
}

function showExperiment() {
  if (!experiment.open || reportReady) return;
  const results = evaluate();
  renderMetrics($("metrics"), [
    ["原始信号 · 分段均值", results.clean],
    ["加干扰 · 分段均值", results.noisy],
    ["加干扰 · 首尾单点", results.baselineNoisy],
  ], results.total);
  renderMatrix($("matrix"), FAULTS, results.noisy.matrix);
  const difference = results.noisy.correct - results.baselineNoisy.correct;
  const change = 100 * difference / results.total;
  $("experiment-note").textContent = `同样的干扰下，分段均值版与首尾单点版相比，正确数变化为 ${difference > 0 ? "+" : ""}${difference} 个（${change > 0 ? "+" : ""}${change.toFixed(1)} 个百分点）。`;
  reportReady = true;
}

function showAdvancedMatrix() {
  if (!advancedStudy) return;
  const selected = Number($("matrix-level").value);
  renderMatrix($("advanced-matrix"), SCENARIOS, advancedStudy.levels[selected].matrix);
}

$("advanced-study").addEventListener("toggle", event => {
  if (!event.target.open || advancedStudy) return;
  advancedStudy = evaluateAdvanced();
  renderMetrics($("advanced-metrics"), advancedStudy.levels.map((study, index) => (
    [NOISE_LABELS[index], study]
  )), advancedStudy.total);
  showAdvancedMatrix();
});
$("matrix-level").addEventListener("change", showAdvancedMatrix);
experiment.addEventListener("toggle", showExperiment);
document.querySelector(".jump").addEventListener("click", () => { experiment.open = true; });
let redraw;
new ResizeObserver(() => {
  cancelAnimationFrame(redraw);
  redraw = requestAnimationFrame(renderTelemetry);
}).observe($("charts"));
renderTelemetry();
