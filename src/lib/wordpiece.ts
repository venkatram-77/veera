import fs from "node:fs";
import { config } from "./config";

let vocab: Map<string, number> | null = null;

function getVocab(): Map<string, number> {
  if (vocab) return vocab;
  const words = fs.readFileSync(config.vocabPath, "utf8").split(/\r?\n/);
  vocab = new Map();
  words.forEach((word, index) => {
    if (word) vocab!.set(word, index);
  });
  return vocab;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function basicTokenize(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}']+/u)
    .map((token) => token.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

export type EncodedText = {
  inputIds: BigInt64Array;
  attentionMask: BigInt64Array;
  tokens: string[];
};

export function encode(text: string, maxLength = 512): EncodedText {
  const table = getVocab();
  const pieces: string[] = ["[CLS]"];

  for (const word of basicTokenize(text)) {
    if (pieces.length >= maxLength - 1) break;
    if (table.has(word)) {
      pieces.push(word);
      continue;
    }

    const subwords: string[] = [];
    let start = 0;
    let valid = true;

    while (start < word.length) {
      let end = word.length;
      let found: string | null = null;
      while (end > start) {
        const fragment = word.slice(start, end);
        const candidate = start === 0 ? fragment : `##${fragment}`;
        if (table.has(candidate)) {
          found = candidate;
          break;
        }
        end -= 1;
      }
      if (!found) {
        valid = false;
        break;
      }
      subwords.push(found);
      start = end;
    }

    pieces.push(...(valid ? subwords : ["[UNK]"]));
  }

  pieces.push("[SEP]");
  const length = pieces.length;
  const inputIds = new BigInt64Array(length);
  const attentionMask = new BigInt64Array(length).fill(BigInt(1));
  pieces.forEach((piece, index) => {
    inputIds[index] = BigInt(table.get(piece) ?? 100);
  });

  return { inputIds, attentionMask, tokens: pieces };
}

export function vocabSize(): number {
  return getVocab().size;
}
