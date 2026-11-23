import fs from "node:fs";
import * as ort from "onnxruntime-node";
import { config } from "./config";
import type { Sentiment } from "./types";
import { encode } from "./wordpiece";

let sessionPromise: Promise<ort.InferenceSession> | null = null;

export function classifierAvailable(): boolean {
  return fs.existsSync(config.onnxPath) && fs.existsSync(config.vocabPath);
}

async function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(config.onnxPath, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    });
  }
  return sessionPromise;
}

export async function analyzeSentiment(text: string): Promise<Sentiment | null> {
  if (!classifierAvailable()) return null;
  try {
    const { inputIds, attentionMask } = encode(text);
    const session = await getSession();
    const results = await session.run({
      input_ids: new ort.Tensor("int64", inputIds, [1, inputIds.length]),
      attention_mask: new ort.Tensor("int64", attentionMask, [1, attentionMask.length]),
    });

    const logits = results.logits.data as Float32Array;
    const [negative, positive] = logits;
    const max = Math.max(negative, positive);
    const expNeg = Math.exp(negative - max);
    const expPos = Math.exp(positive - max);
    const positiveProbability = expPos / (expNeg + expPos);

    return {
      label: positiveProbability >= 0.5 ? "POSITIVE" : "NEGATIVE",
      confidence: Math.max(positiveProbability, 1 - positiveProbability),
    };
  } catch (error) {
    console.error("[classifier] inference failed:", error);
    return null;
  }
}
