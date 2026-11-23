#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import {
  analyzeMachine,
  formatPlainStateText,
  fromJsonMachine,
  parsePlainState,
  toJsonMachine,
} from "./index.js";

function usage(): never {
  process.stderr.write(
    [
      "Usage:",
      "  plainstate from-json [file] [-o out]",
      "  plainstate to-json [file] [--pretty] [-o out]",
      "  plainstate check [file]",
      "  plainstate format [file] [-o out]",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

function readInput(path?: string): string {
  return path ? readFileSync(path, "utf8") : readFileSync(0, "utf8");
}

function writeOutput(text: string, outPath?: string): void {
  if (outPath) {
    writeFileSync(outPath, text, "utf8");
  } else {
    process.stdout.write(text);
  }
}

const args = process.argv.slice(2);
const command = args.shift();
if (!command || command === "-h" || command === "--help") usage();

let inputPath: string | undefined;
let outPath: string | undefined;
let pretty = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]!;
  if (arg === "-o" || arg === "--output") {
    outPath = args[++i];
    if (!outPath) usage();
  } else if (arg === "--pretty") {
    pretty = true;
  } else if (arg.startsWith("-")) {
    usage();
  } else if (!inputPath) {
    inputPath = arg;
  } else {
    usage();
  }
}

try {
  const input = readInput(inputPath);
  if (command === "from-json") {
    writeOutput(fromJsonMachine(input), outPath);
  } else if (command === "to-json") {
    writeOutput(toJsonMachine(input, pretty ? 2 : undefined) + "\n", outPath);
  } else if (command === "format") {
    writeOutput(formatPlainStateText(input), outPath);
  } else if (command === "check") {
    const machine = parsePlainState(input);
    const analysis = analyzeMachine(machine);
    const warnings = analysis.unreachableStates.length
      ? ` (unreachable: ${analysis.unreachableStates.join(", ")})`
      : "";
    process.stdout.write(
      `OK ${analysis.states.length} states, ${machine.transitions.length} transitions${warnings}\n`,
    );
  } else {
    usage();
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
