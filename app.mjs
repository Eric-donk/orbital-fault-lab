import { FAULTS, generateCase, addInterference, classify, evaluate } from "./model.mjs";

const $ = id => document.getElementById(id);
const names = ["温度", "电量", "信号强度"];
const canvases = names.map((_, index) => $(`chart-${index}`));
const form = $("diagnose");
const experiment = $("experiment");
const findFault = id => FAULTS.find(fault => fault.id === id);
let mission = 1;
let original = generateCase(813, "power");
let noisy = false;
let selection = null;
let reportReady = false;

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
  ctx.beginPath();
  ctx.arc(...points.at(-1), 3, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
}

function renderTelemetry() {
  const sample = noisy ? addInterference(original) : original;
  canvases.forEach((canvas, index) => {
    const values = sample.frames.map(frame => frame[index]);
    $(`value-${index}`).value = values.at(-1).toFixed(1);
    canvas.setAttribute("aria-label", `${names[index]}模拟读数，从第 0 到 17 分钟，每分钟一个值：${values.map(value => value.toFixed(0)).join("、")}`);
    draw(canvas, values, index);
  });
  $("signal-mode").textContent = noisy ? "已加干扰" : "原始信号";
  $("signal-mode").classList.toggle("noisy", noisy);
}

function renderResult() {
  const truth = findFault(original.fault);
  const clean = classify(original.frames);
  const current = noisy ? classify(addInterference(original).frames) : clean;
  const prediction = findFault(current.id);
  $("truth").textContent = truth.name;
  $("human-guess").textContent = findFault(selection).name + (selection === original.fault ? " · 正确" : " · 猜错");
  $("model-guess").textContent = prediction.name + (current.id === original.fault ? " · 正确" : " · 误判");
  $("vote-text").textContent = current.ranking.map(item => `${findFault(item.id).short} ${item.votes} 票`).join(" · ");
  $("votes").replaceChildren(...current.ranking.flatMap(item => Array.from({ length: item.votes }, () => {
    const line = document.createElement("i");
    line.style.background = findFault(item.id).color;
    return line;
  })));
  $("clue").textContent = truth.clue;
  $("comparison").textContent = noisy
    ? `原始：${findFault(clean.id).name}（${clean.votes}/5 票） · 干扰后：${prediction.name}（${current.votes}/5 票）`
    : "尝试增加干扰，对照同一个案例的模型判断。";
  $("noise").textContent = noisy ? "移除干扰" : "增加干扰";
  $("noise").setAttribute("aria-pressed", String(noisy));
  $("announcement").textContent = `模拟设定为${truth.name}。模型判断为${prediction.name}，${current.votes}票。`;
}

form.addEventListener("change", () => { $("submit").disabled = false; });
form.addEventListener("submit", event => {
  event.preventDefault();
  if (selection) return;
  const value = new FormData(form).get("fault");
  if (!findFault(value)) return;
  selection = value;
  $("diagnosis-step").textContent = "对照你的判断、模型判断与模拟设定";
  form.hidden = true;
  $("result").hidden = false;
  renderResult();
  $("noise").focus({ preventScroll: true });
});

$("noise").addEventListener("click", () => {
  noisy = !noisy;
  renderTelemetry();
  renderResult();
});

$("next").addEventListener("click", () => {
  mission += 1;
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const options = FAULTS.filter(fault => fault.id !== original.fault);
  original = generateCase(seed, options[seed % options.length].id);
  noisy = false;
  selection = null;
  $("diagnosis-step").textContent = "选择一种最可能的原因";
  form.reset();
  form.hidden = false;
  $("submit").disabled = true;
  $("result").hidden = true;
  $("mission-id").textContent = `ORB-${String(mission).padStart(2, "0")}`;
  $("announcement").textContent = `第 ${mission} 局已开始。`;
  renderTelemetry();
  $("telemetry-title").scrollIntoView({ block: "start" });
  form.querySelector("input").focus({ preventScroll: true });
});

function showExperiment() {
  if (!experiment.open || reportReady) return;
  const results = evaluate();
  const cases = [
    ["原始信号 · 分段均值", results.clean],
    ["加干扰 · 分段均值", results.noisy],
    ["加干扰 · 首尾单点", results.baselineNoisy],
  ];
  for (const [label, condition] of cases) {
    const card = document.createElement("div");
    card.className = "metric";
    const heading = document.createElement("span");
    heading.textContent = label;
    const score = document.createElement("strong");
    score.textContent = (100 * condition.correct / results.total).toFixed(1) + "%";
    const total = document.createElement("span");
    total.textContent = `识别正确 ${condition.correct} / ${results.total}`;
    card.append(heading, score, total);
    $("metrics").append(card);
  }
  const table = $("matrix");
  const header = table.createTHead().insertRow();
  for (const label of ["实际 ↓　预测 →", ...FAULTS.map(fault => fault.short)]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    header.append(cell);
  }
  const body = table.createTBody();
  results.noisy.matrix.forEach((values, index) => {
    const row = body.insertRow();
    const head = document.createElement("th");
    head.scope = "row";
    head.textContent = FAULTS[index].short;
    row.append(head);
    values.forEach((value, column) => {
      const cell = row.insertCell();
      cell.textContent = value;
      cell.classList.toggle("match", column === index);
    });
  });
  const difference = results.noisy.correct - results.baselineNoisy.correct;
  const change = 100 * difference / results.total;
  $("experiment-note").textContent = `同样的干扰下，分段均值版与首尾单点版相比，正确数变化为 ${difference > 0 ? "+" : ""}${difference} 个（${change > 0 ? "+" : ""}${change.toFixed(1)} 个百分点）。`;
  reportReady = true;
}

experiment.addEventListener("toggle", showExperiment);
document.querySelector(".jump").addEventListener("click", () => { experiment.open = true; });
let redraw;
new ResizeObserver(() => {
  cancelAnimationFrame(redraw);
  redraw = requestAnimationFrame(renderTelemetry);
}).observe($("charts"));
renderTelemetry();
