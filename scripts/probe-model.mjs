import fs from "node:fs";
import path from "node:path";
import * as ort from "onnxruntime-node";

const root = process.cwd();
const onnxPath = path.join(root, "models", "veera", "veera_quantized.onnx");
const vocabPath = path.join(root, "models", "veera", "tokenizer", "vocab.txt");

console.log("Veera model probe");
console.log("-----------------");

console.log(`ONNX model: ${fs.existsSync(onnxPath) ? "found" : "MISSING"}`);
console.log(`Vocab:      ${fs.existsSync(vocabPath) ? "found" : "MISSING"}`);

if (fs.existsSync(onnxPath)) {
  try {
    const session = await ort.InferenceSession.create(onnxPath, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    });
    const length = 8;
    const ids = new BigInt64Array(length).fill(0n);
    const mask = new BigInt64Array(length).fill(1n);
    const results = await session.run({
      input_ids: new ort.Tensor("int64", ids, [1, length]),
      attention_mask: new ort.Tensor("int64", mask, [1, length]),
    });
    console.log(`ONNX load:  OK — logits = ${Array.from(results.logits.data).join(", ")}`);
  } catch (error) {
    console.error(`ONNX load:  FAILED — ${error instanceof Error ? error.message : error}`);
  }
}

try {
  const response = await fetch("http://127.0.0.1:11434/api/tags", {
    signal: AbortSignal.timeout(3000),
  });
  const data = await response.json();
  const models = (data.models ?? []).map((model) => model.name);
  console.log(`Ollama:     ${response.ok ? "online" : "offline"}`);
  console.log(`Models:     ${models.length ? models.join(", ") : "(none)"}`);
} catch (error) {
  console.log(`Ollama:     offline (${error instanceof Error ? error.message : "unreachable"})`);
}
