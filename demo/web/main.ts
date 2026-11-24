import {
  analyzeMachine,
  applyTokens,
  extractTokens,
  formatPlainState,
  parsePlainState,
  stepMachine,
  type StateMachine,
} from "../../src/index.js";

const EXAMPLES: Record<string, string> = {
  "button-press": `***plainstate***

- Starts in :Idle:.
- Unhandled events leave state unchanged and emit nothing.

- :Idle: No gesture is in progress.
  - On begin, when interactive, go to :Pressed:.
    - Present press.
  - On activate, when interactive, stay.
    - Emit activated with an empty payload.
    - Present activation.
- :Pressed: One gesture is in progress.
  - On release, when interactive, go to :Idle:.
    - Emit activated with an empty payload.
    - Present activation.
  - On release, when not interactive, go to :Idle:.
    - Present cancel.
  - On cancel, go to :Idle:.
    - Present cancel.
`,
  "async-fetch": `***plainstate***

- Starts in :Idle:.
- Unhandled events leave state unchanged and emit nothing.

- :Idle: Waiting for a request.
  - On fetch, when online, go to :Loading:.
    - Request networkFetch.
- :Loading: Request is in flight.
  - On resolve, go to :Ready:.
    - Do storeData.
    - Emit loaded.
  - On reject, go to :Failed:.
    - Do storeError.
    - Emit failed.
  - On cancel, go to :Idle:.
- :Ready: Data is available.
  - On fetch, when online, go to :Loading:.
    - Request networkFetch.
- :Failed: Last request failed.
  - On retry, when online, go to :Loading:.
    - Request networkFetch.
  - On reset, go to :Idle:.
`,
  "door-lock": `***plainstate***

- Starts in :Locked:.
- Unhandled events leave state unchanged and emit nothing.

- :Locked: Bolt is engaged.
  - On unlock, when hasKey, go to :Closed:.
    - Emit unlocked.
- :Closed: Door is shut but unlocked.
  - On lock, go to :Locked:.
    - Emit locked.
  - On open, go to :Open:.
- :Open: Door is open.
  - On close, go to :Closed:.
`,
};

const plainInput = document.getElementById("plain-input") as HTMLTextAreaElement;
const formattedView = document.getElementById("formatted-view") as HTMLDivElement;
const tokensBar = document.getElementById("tokens-bar") as HTMLDivElement;
const tokenValues: Record<string, string> = {};

function renderTokensBar(tokens: string[]): void {
  tokensBar.hidden = tokens.length === 0;
  const existing = Array.from(tokensBar.querySelectorAll<HTMLInputElement>("input[data-token]")).map(
    (el) => el.dataset.token!,
  );
  if (existing.join(",") === tokens.join(",")) return;
  tokensBar.innerHTML = "";
  for (const token of tokens) {
    const label = document.createElement("label");
    label.className = "token-field";
    const span = document.createElement("span");
    span.textContent = `{{${token}}}`;
    const input = document.createElement("input");
    input.dataset.token = token;
    input.value = tokenValues[token] ?? "";
    input.placeholder = "value";
    input.addEventListener("input", () => {
      if (input.value === "") delete tokenValues[token];
      else tokenValues[token] = input.value;
      compile();
    });
    label.append(span, input);
    tokensBar.appendChild(label);
  }
}
const jsonView = document.getElementById("json-view") as HTMLPreElement;
const exampleSelect = document.getElementById("example-select") as HTMLSelectElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const statusMeta = document.getElementById("status-meta") as HTMLSpanElement;
const compileBadge = document.getElementById("compile-badge") as HTMLSpanElement;
const plainNotes = document.getElementById("plain-notes") as HTMLElement;
const stateList = document.getElementById("state-list") as HTMLDivElement;
const guardsBlock = document.getElementById("guards-block") as HTMLDivElement;
const guardList = document.getElementById("guard-list") as HTMLDivElement;
const eventList = document.getElementById("event-list") as HTMLDivElement;
const traceList = document.getElementById("trace-list") as HTMLOListElement;
const formatBtn = document.getElementById("format-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const simResetBtn = document.getElementById("sim-reset") as HTMLButtonElement;
const copyJsonBtn = document.getElementById("copy-json") as HTMLButtonElement;

let currentMachine: StateMachine | null = null;
let currentState = "";
let guardValues: Record<string, boolean> = {};
let trace: Array<{ text: string; ignored: boolean }> = [];

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(text: string): string {
  return escapeHtml(text).replace(
    /:([A-Za-z][A-Za-z0-9_-]*):/g,
    '<strong class="pv-ref">$1</strong>',
  );
}

function renderReader(source: string): string {
  const rows: string[] = [];
  for (const line of source.split("\n")) {
    if (line.trim() === "" || /^\*\*\*[^*]+\*\*\*$/.test(line.trim())) continue;
    const indent = line.length - line.trimStart().length;
    const depth = Math.floor(indent / 2);
    if (!line.startsWith("- ", indent)) continue;
    const body = line.slice(indent + 2);

    const stateDecl = /^:([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*))?$/.exec(body);
    if (stateDecl) {
      const desc = stateDecl[2]?.trim()
        ? `<span class="pv-sep"> — </span><span class="pv-desc">${renderInline(stateDecl[2].trim())}</span>`
        : "";
      rows.push(`<div class="pv-row pv-definition" style="--depth:${depth}"><strong class="pv-name">${escapeHtml(stateDecl[1]!)}</strong>${desc}</div>`);
      continue;
    }

    const edge = /^(On\s+)([A-Za-z][A-Za-z0-9_-]*)(.*)$/.exec(body);
    if (edge) {
      rows.push(
        `<div class="pv-row pv-edge" style="--depth:${depth}"><span class="pv-bullet">→</span><span class="pv-keyword">${escapeHtml(edge[1]!)}</span><span class="pv-event">${escapeHtml(edge[2]!)}</span>${renderInline(edge[3]!)}</div>`,
      );
      continue;
    }

    rows.push(`<div class="pv-row pv-directive" style="--depth:${depth}"><span class="pv-bullet">·</span>${renderInline(body)}</div>`);
  }
  return rows.join("");
}

function renderSimulator(): void {
  if (!currentMachine) return;
  const analysis = analyzeMachine(currentMachine);

  stateList.innerHTML = "";
  for (const s of currentMachine.states) {
    const pill = document.createElement("span");
    pill.className = `state-pill${s.name === currentState ? " active" : ""}`;
    pill.textContent = `:${s.name}:`;
    pill.title = s.description;
    stateList.appendChild(pill);
  }

  guardsBlock.hidden = analysis.guards.length === 0;
  guardList.innerHTML = "";
  for (const g of analysis.guards) {
    if (!(g in guardValues)) guardValues[g] = true;
    const label = document.createElement("label");
    label.className = "guard-toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(guardValues[g]);
    input.addEventListener("change", () => {
      guardValues[g] = input.checked;
    });
    label.append(input, document.createTextNode(g));
    guardList.appendChild(label);
  }

  eventList.innerHTML = "";
  for (const ev of analysis.events) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "event-btn";
    btn.textContent = ev;
    btn.addEventListener("click", () => {
      if (!currentMachine) return;
      const res = stepMachine(currentMachine, currentState, ev, guardValues);
      currentState = res.to;
      if (res.matched && res.transition) {
        const extras = [
          ...res.transition.actions.map((a) => `do ${a}`),
          ...res.transition.emits.map((e) => `emit ${e.event}`),
          ...res.transition.effects.map((f) => `req ${f}`),
          ...(res.transition.present ? [`present ${res.transition.present}`] : []),
        ];
        const suffix = extras.length ? ` [${extras.join(", ")}]` : "";
        trace.unshift({ text: `${res.from} --(${ev})--> ${res.to}${suffix}`, ignored: false });
      } else {
        trace.unshift({ text: `${res.from} --(${ev})--> ignored`, ignored: true });
      }
      trace = trace.slice(0, 12);
      renderSimulator();
    });
    eventList.appendChild(btn);
  }

  traceList.innerHTML = "";
  if (trace.length === 0) {
    const li = document.createElement("li");
    li.className = "trace-item ignored";
    li.textContent = `Started in :${currentState}:. Click an event above.`;
    traceList.appendChild(li);
  } else {
    for (const item of trace) {
      const li = document.createElement("li");
      li.className = `trace-item${item.ignored ? " ignored" : ""}`;
      li.textContent = item.text;
      traceList.appendChild(li);
    }
  }
}

function compile(): void {
  try {
    const tokens = extractTokens(plainInput.value);
    renderTokensBar(tokens);
    const applied = applyTokens(plainInput.value, tokenValues);
    const machine = parsePlainState(applied.text);
    const canonical = formatPlainState(machine);
    const analysis = analyzeMachine(machine);
    const json = JSON.stringify(machine, null, 2);

    const stateStillExists = machine.states.some((s) => s.name === currentState);
    if (!currentMachine || !stateStillExists) {
      currentState = machine.initial;
      trace = [];
    }
    currentMachine = machine;

    formattedView.innerHTML = renderReader(canonical);
    jsonView.textContent = json + "\n";

    const warn = analysis.unreachableStates.length
      ? ` • unreachable: ${analysis.unreachableStates.join(", ")}`
      : "";
    plainNotes.textContent = `Deterministic • ${analysis.states.length} states, ${machine.transitions.length} transitions${warn}`;
    plainNotes.className = "notes";

    statusEl.dataset.phase = "synced";
    statusText.textContent = "Deterministic";
    statusMeta.textContent = `${analysis.states.length} states · ${machine.transitions.length} transitions`;
    compileBadge.textContent = "Valid";
    compileBadge.className = "badge ok";
    renderSimulator();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    plainNotes.textContent = msg;
    plainNotes.className = "notes error";
    statusEl.dataset.phase = "error";
    statusText.textContent = "Compile error";
    statusMeta.textContent = "";
    compileBadge.textContent = "Error";
    compileBadge.className = "badge err";
  }
}

function loadExample(id: string): void {
  plainInput.value = EXAMPLES[id] ?? EXAMPLES["button-press"]!;
  currentMachine = null;
  guardValues = {};
  trace = [];
  compile();
}

plainInput.addEventListener("input", compile);
exampleSelect.addEventListener("change", () => loadExample(exampleSelect.value));
formatBtn.addEventListener("click", () => {
  try {
    plainInput.value = formatPlainState(parsePlainState(plainInput.value));
    compile();
  } catch {
    compile();
  }
});
resetBtn.addEventListener("click", () => loadExample(exampleSelect.value));
simResetBtn.addEventListener("click", () => {
  if (!currentMachine) return;
  currentState = currentMachine.initial;
  trace = [];
  renderSimulator();
});
copyJsonBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(jsonView.textContent ?? "");
    copyJsonBtn.textContent = "Copied";
    setTimeout(() => { copyJsonBtn.textContent = "Copy"; }, 1200);
  } catch {
    copyJsonBtn.textContent = "Failed";
  }
});

loadExample("button-press");
