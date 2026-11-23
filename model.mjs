export const FAULTS = [
  { id: "thermal", name: "温控异常", channel: "温度上升", short: "温控", color: "#ffb864", clue: "温度往往在后半段持续走高。电量和信号也可能小幅波动。" },
  { id: "power", name: "供电异常", channel: "电量下降", short: "供电", color: "#59e0b5", clue: "电量往往持续下降，有时伴随信号走弱。" },
  { id: "signal", name: "通信异常", channel: "信号走弱", short: "通信", color: "#82acff", clue: "信号强度往往明显走低，波动也可能比其他通道大。" },
];

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
  const index = FAULTS.findIndex(item => item.id === fault);
  if (index < 0) throw new RangeError("Unknown fault");
  const baselines = [42, 79, 76].map(base => base + fluctuate(random, 9));
  const onset = 4 + Math.floor(random() * 6);
  const severity = 12 + random() * 21;
  const deltas = [
    [severity, -severity * 0.27, -severity * 0.16],
    [severity * 0.17, -severity, -severity * 0.42],
    [severity * 0.13, -severity * 0.23, -severity],
  ][index];
  const drift = baselines.map(() => fluctuate(random, 7));
  const frames = Array.from({ length: 18 }, (_, minute) => {
    const progress = Math.max(0, (minute - onset) / (17 - onset));
    return baselines.map((base, channel) => {
      const jitter = channel === 2 && index === 2 && progress > 0 ? 6 : 3.7;
      return clamp(base + drift[channel] * minute / 17
        + deltas[channel] * progress + fluctuate(random, jitter));
    });
  });
  return { seed, fault, frames };
}

export function addInterference(sample) {
  const random = randomFrom(sample.seed ^ 0x82d79b9f);
  const gradual = [0, 0, 0].map(() => fluctuate(random, 10));
  const frames = sample.frames.map((frame, minute) => frame.map((value, index) => {
    const spike = random() < 0.1 ? fluctuate(random, 25) : 0;
    return clamp(value + fluctuate(random, 15) + gradual[index] * minute / 17 + spike);
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
  return { rows, scale, method };
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
  const ranking = FAULTS.map(fault => {
    const matches = nearest.filter(row => row.id === fault.id);
    return { id: fault.id, votes: matches.length, distance: matches.reduce((sum, row) => sum + row.distance, 0) };
  }).sort((a, b) => b.votes - a.votes || a.distance - b.distance);
  return { id: ranking[0].id, votes: ranking[0].votes, ranking, vector };
}

export function evaluate() {
  const noisy = datasets.test.map(addInterference);
  function score(samples, model) {
    const matrix = FAULTS.map(() => FAULTS.map(() => 0));
    for (const sample of samples) {
      const result = classify(sample.frames, model);
      matrix[FAULTS.findIndex(fault => fault.id === sample.fault)]
        [FAULTS.findIndex(fault => fault.id === result.id)] += 1;
    }
    const correct = matrix.reduce((sum, row, index) => sum + row[index], 0);
    return { correct, matrix };
  }
  return {
    total: datasets.test.length,
    clean: score(datasets.test, windowModel),
    noisy: score(noisy, windowModel),
    baselineNoisy: score(noisy, endpointModel),
  };
}
