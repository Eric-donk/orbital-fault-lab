import assert from "node:assert/strict";
import test from "node:test";
import {
  FAULTS, generateCase, addInterference, classify, evaluate, splitCases,
} from "./model.mjs";

test("a case is reproducible and adding interference preserves its original data and label", () => {
  const original = generateCase(231, "power");
  const snapshot = structuredClone(original);
  const noisy = addInterference(original);
  assert.deepEqual(generateCase(231, "power"), snapshot);
  assert.deepEqual(original, snapshot);
  assert.equal(noisy.fault, original.fault);
  assert.equal(noisy.seed, original.seed);
  assert.notDeepEqual(noisy.frames, original.frames);
  assert.deepEqual(addInterference(original), noisy);
  assert.equal(original.frames.length, 18);
  assert.ok(noisy.frames.every(frame => frame.every(value => Number.isFinite(value) && value >= 0 && value <= 100)));
});

test("prediction reads telemetry without the true label", () => {
  const sample = generateCase(52, "thermal");
  const result = classify(sample.frames);
  assert.ok(FAULTS.some(fault => fault.id === result.id));
  assert.equal(result.votes, result.ranking[0].votes);
  assert.equal(result.ranking.reduce((sum, item) => sum + item.votes, 0), 5);
});

test("experiment uses disjoint seeds and the same cases for each condition", () => {
  const { train, test: holdout } = splitCases();
  assert.equal(train.length, 360);
  assert.equal(holdout.length, 180);
  const seeds = new Set(train.map(sample => sample.seed));
  assert.equal(seeds.size, 360);
  assert.equal(new Set(holdout.map(sample => sample.seed)).size, 180);
  assert.ok(holdout.every(sample => !seeds.has(sample.seed)));
  const results = evaluate();
  assert.equal(results.total, 180);
  for (const condition of [results.clean, results.noisy, results.baselineNoisy]) {
    assert.equal(condition.matrix.length, 3);
    assert.ok(condition.matrix.every(row => row.reduce((a, b) => a + b, 0) === 60));
    assert.equal(condition.correct, condition.matrix.reduce((sum, row, index) => sum + row[index], 0));
  }
});
