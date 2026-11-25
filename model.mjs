export const FAULTS = [
  { id: "thermal", name: "温控异常", channel: "温度上升", short: "温控", color: "#ffb864", clue: "温度往往在后半段持续走高。电量和信号也可能小幅波动。" },
  { id: "power", name: "供电异常", channel: "电量下降", short: "供电", color: "#59e0b5", clue: "电量往往持续下降，有时伴随信号走弱。" },
  { id: "signal", name: "通信异常", channel: "信号走弱", short: "通信", color: "#82acff", clue: "信号强度往往明显走低，波动也可能比其他通道大。" },
];

const healthy = { id: "none", name: "设备正常", short: "正常", color: "#a7b7d1", members: [] };
export const SCENARIOS = [
  healthy,
  ...FAULTS.map(fault => ({ ...fault, members: [fault.id] })),
  ...FAULTS.flatMap((first, index) => FAULTS.slice(index + 1).map(second => ({
    id: first.id + "+" + second.id,
    name: first.short + "＋" + second.short + "异常",
    short: first.short + "＋" + second.short,
    color: "#c3a2ff",
    members: [first.id, second.id],
  }))),
];
export const NOISE_LABELS = ["原始信号", "轻度干扰", "中度干扰", "重度干扰"];

export function scenarioId(values) {
  if (values.length === 1 && values[0] === "none") return "none";
  if (!values.every(value => FAULTS.some(fault => fault.id === value))) return null;
  const id = FAULTS.filter(fault => values.includes(fault.id)).map(fault => fault.id).join("+");
  return SCENARIOS.some(scenario => scenario.id === id && scenario.members.length === values.length) ? id : null;
}

function randomFrom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const clamp = value => Math.min(100, Math.max(0, value));
const fluctuate = (random, amplitude) => (2 * random() - 1) * amplitude;

export function generateCase(seed, fault) {
  const random = randomFrom(seed);
  const scenario = SCENARIOS.find(item => item.id === fault);
  if (!scenario) throw new RangeError("Unknown fault");
  const baselines = [42, 79, 76].map(base => base + fluctuate(random, 9));
  const onset = 4 + Math.floor(random() * 6);
  const severity = 12 + random() * 21;
  const drift = baselines.map(() => fluctuate(random, 7));
  const signatures = [[1, -.27, -.16], [.17, -1, -.42], [.13, -.23, -1]];
  const components = scenario.members.map((id, order) => {
    const strength = order ? 12 + random() * 21 : severity;
    return {
      id, minute: order ? onset + 2 + Math.floor(random() * 3) : onset,
      deltas: signatures[FAULTS.findIndex(item => item.id === id)].map(value => value * strength),
    };
  });
  const frames = Array.from({ length: 18 }, (_, minute) => {
    return baselines.map((base, channel) => {
      const jitter = channel === 2 && components.some(event => event.id === "signal" && minute > event.minute) ? 6 : 3.7;
      const change = components.reduce((sum, event) => (
        sum + event.deltas[channel] * Math.max(0, (minute - event.minute) / (17 - event.minute))
      ), 0);
      return clamp(base + drift[channel] * minute / 17 + change + fluctuate(random, jitter));
    });
  });
  return { seed, fault, frames, events: components.map(({ id, minute }) => ({ id, minute })) };
}

export function addInterference(sample, level = 2) {
  const strength = [0, .5, 1, 1.5][level];
  if (strength === undefined) throw new RangeError("Unknown interference level");
  if (strength === 0) return sample;
  const random = randomFrom(sample.seed ^ 0x82d79b9f);
  const gradual = [0, 0, 0].map(() => fluctuate(random, 10));
  const frames = sample.frames.map((frame, minute) => frame.map((value, index) => {
    const spike = random() < 0.1 ? fluctuate(random, 25) : 0;
    return clamp(value + (fluctuate(random, 15) + gradual[index] * minute / 17 + spike) * strength);
  }));
  return { ...sample, frames };
}

export function splitCases() {
  const build = (base, size) => FAULTS.flatMap((fault, category) => (
    Array.from({ length: size }, (_, index) => (
      generateCase((base + category * 4096 + index) * 2654435761 >>> 0, fault.id)
    ))
  ));
  return { train: build(1000, 120), test: build(24000, 60) };
}

function average(frames, channel) {
  return frames.reduce((sum, frame) => sum + frame[channel], 0) / frames.length;
}

export function extractFeatures(frames, method = "window") {
  const before = method === "endpoint" ? frames.slice(0, 1) : frames.slice(0, 4);
  const after = method === "endpoint" ? frames.slice(-1) : frames.slice(-5);
  return [0, 1, 2].map(channel => average(after, channel) - average(before, channel));
}

function buildModel(samples, method) {
  const rows = samples.map(sample => ({
    id: sample.fault, vector: extractFeatures(sample.frames, method),
  }));
  const scale = [0, 1, 2].map(channel => {
    const mean = rows.reduce((sum, row) => sum + row.vector[channel], 0) / rows.length;
    const variance = rows.reduce((sum, row) => sum + (row.vector[channel] - mean) ** 2, 0);
    return Math.sqrt(variance / rows.length) || 1;
  });
  return { rows, scale, method, categories: [...new Set(rows.map(row => row.id))] };
}

const datasets = splitCases();
const windowModel = buildModel(datasets.train, "window");
const endpointModel = buildModel(datasets.train, "endpoint");

export function classify(frames, model = windowModel) {
  const vector = extractFeatures(frames, model.method);
  const nearest = model.rows.map(row => ({
    id: row.id,
    distance: row.vector.reduce((sum, value, channel) => (
      sum + ((value - vector[channel]) / model.scale[channel]) ** 2
    ), 0),
  })).sort((a, b) => a.distance - b.distance).slice(0, 5);
  const ranking = model.categories.map(id => {
    const matches = nearest.filter(row => row.id === id);
    return { id, votes: matches.length, distance: matches.reduce((sum, row) => sum + row.distance, 0) };
  }).sort((a, b) => b.votes - a.votes || a.distance - b.distance);
  return { id: ranking[0].id, votes: ranking[0].votes, ranking, vector };
}

function score(samples, model) {
  const matrix = model.categories.map(() => model.categories.map(() => 0));
  for (const sample of samples) {
    const result = classify(sample.frames, model);
    matrix[model.categories.indexOf(sample.fault)][model.categories.indexOf(result.id)] += 1;
  }
  const correct = matrix.reduce((sum, row, index) => sum + row[index], 0);
  return { correct, matrix };
}

export function evaluate() {
  const noisy = datasets.test.map(sample => addInterference(sample));
  return {
    total: datasets.test.length,
    clean: score(datasets.test, windowModel),
    noisy: score(noisy, windowModel),
    baselineNoisy: score(noisy, endpointModel),
  };
}

function advancedCases(base, size) {
  return SCENARIOS.flatMap((scenario, category) => Array.from({ length: size }, (_, index) => {
    const seed = Math.imul(base + category * 4096 + index, 2654435761) >>> 0;
    return generateCase(seed, scenario.id);
  }));
}

let advancedModel;
function getAdvancedModel() {
  advancedModel ??= buildModel(advancedCases(48000, 120), "window");
  return advancedModel;
}

export function diagnoseAdvanced(frames) {
  return classify(frames, getAdvancedModel());
}

export function evaluateAdvanced() {
  const cases = advancedCases(84000, 40);
  const model = getAdvancedModel();
  return {
    total: cases.length,
    levels: NOISE_LABELS.map((_, level) => score(cases.map(sample => addInterference(sample, level)), model)),
  };
}
