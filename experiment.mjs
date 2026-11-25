import { evaluate, evaluateAdvanced } from "./model.mjs";

console.log(JSON.stringify(process.argv.includes("--advanced") ? evaluateAdvanced() : evaluate(), null, 2));
