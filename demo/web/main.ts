import {
  analyzeMachine,
  applyTokens,
  extractTokens,
  formatPlainState,
  parsePlainState,
  stepMachine,
  type StateMachine,
  type TokenSpan,
} from "../../src/index.js";

const DEFAULT_TOKENS: Record<string, string> = {
  guard: "interactive",
  pressCue: "press",
  toggleCue: "toggle",
  activateCue: "activation",
  cancelCue: "cancel",
  commitEvent: "changed",
};

const EXAMPLES: Record<string, string> = {
  checkbox: `***plainstate***

- Starts in :Unchecked:.
- Unhandled events leave state unchanged and emit nothing.

- :Unchecked: The checkbox is not checked.
  - On press, when {{guard}}, go to :PressingToCheck:.
    - Present {{pressCue}}.
  - On toggle, when {{guard}}, go to :Checked:.
    - Emit {{commitEvent}} with true.
    - Present {{toggleCue}}.
- :PressingToCheck: A pointer or key press began while unchecked.
  - On release, when {{guard}}, go to :Checked:.
    - Emit {{commitEvent}} with true.
    - Present {{toggleCue}}.
  - On release, when not {{guard}}, go to :Unchecked:.
    - Present {{cancelCue}}.
  - On cancel, go to :Unchecked:.
    - Present {{cancelCue}}.
- :Checked: The checkbox is checked.
  - On press, when {{guard}}, go to :PressingToUncheck:.
    - Present {{pressCue}}.
  - On toggle, when {{guard}}, go to :Unchecked:.
    - Emit {{commitEvent}} with false.
    - Present {{toggleCue}}.
- :PressingToUncheck: A pointer or key press began while checked.
  - On release, when {{guard}}, go to :Unchecked:.
    - Emit {{commitEvent}} with false.
    - Present {{toggleCue}}.
  - On release, when not {{guard}}, go to :Checked:.
    - Present {{cancelCue}}.
  - On cancel, go to :Checked:.
    - Present {{cancelCue}}.
`,
  "button-press": `***plainstate***

- Starts in :Idle:.
- Unhandled events leave state unchanged and emit nothing.

- :Idle: No gesture is in progress.
  - On begin, when {{guard}}, go to :Pressed:.
    - Present {{pressCue}}.
  - On activate, when {{guard}}, stay.
    - Emit activated with an empty payload.
    - Present {{activateCue}}.
- :Pressed: One gesture is in progress.
  - On release, when {{guard}}, go to :Idle:.
    - Emit activated with an empty payload.
    - Present {{activateCue}}.
  - On release, when not {{guard}}, go to :Idle:.
    - Present {{cancelCue}}.
  - On cancel, go to :Idle:.
    - Present {{cancelCue}}.
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

const tokenValues: Record<string, string> = { ...DEFAULT_TOKENS };
let currentMachine: StateMachine | null = null;
let currentState = "";
let guardValues: Record<string, boolean> = {};
let trace: Array<{ text: string; ignored: boolean }> = [];

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clipSpans(spans: readonly TokenSpan[], start: number, end: number): TokenSpan[] {
  const out: TokenSpan[] = [];
  for (const s of spans) {
    if (s.start < end && start < s.end) {
      out.push({
        token: s.token,
        start: Math.max(s.start, start) - start,
        end: Math.min(s.end, end) - start,
      });
    }
  }
  return out;
}

function paintSlice(text: string, spans: readonly TokenSpan[]): string {
  if (spans.length === 0) return escapeHtml(text);
  let html = "";
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) html += escapeHtml(text.slice(cursor, s.start));
    html += `<span class="pv-token-resolved" data-token="${escapeHtml(s.token)}" title="{{${escapeHtml(s.token)}}}">${escapeHtml(text.slice(s.start, s.end))}</span>`;
    cursor = s.end;
  }
  if (cursor < text.length) html += escapeHtml(text.slice(cursor));
  return html;
}

function renderInline(text: string, spans: readonly TokenSpan[]): string {
  let html = "";
  let cursor = 0;
  for (const match of text.matchAll(/:([A-Za-z][A-Za-z0-9_-]*):/g)) {
    const at = match.index ?? 0;
    const end = at + match[0].length;
    if (at > cursor) html += paintSlice(text.slice(cursor, at), clipSpans(spans, cursor, at));
    html += `<strong class="pv-ref">${paintSlice(match[1]!, clipSpans(spans, at + 1, end - 1))}</strong>`;
    cursor = end;
  }
  if (cursor < text.length) html += paintSlice(text.slice(cursor), clipSpans(spans, cursor, text.length));
  return html;
}

function renderReader(source: string, spans: readonly TokenSpan[] = []): string {
  const normalized = source.replace(/\r\n/g, "\n");
  const rows: string[] = [];
  let offset = 0;
  for (const line of normalized.split("\n")) {
    const base = offset;
    offset += line.length + 1;
    if (line.trim() === "" || /^\*\*\*[^*]+\*\*\*$/.test(line.trim())) continue;
    const indent = line.length - line.trimStart().length;
    const depth = Math.floor(indent / 2);
    if (!line.startsWith("- ", indent)) continue;
    const bodyStart = indent + 2;
    const body = line.slice(bodyStart);
    const bodySpans = clipSpans(spans, base + bodyStart, base + line.length);

    const stateDecl = /^:([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*))?$/.exec(body);
    if (stateDecl) {
      const name = stateDecl[1]!;
      const rest = stateDecl[2]?.trim() ?? "";
      const restStart = rest ? body.indexOf(rest, name.length + 2) : body.length;
      const desc = rest
        ? `<span class="pv-sep"> — </span><span class="pv-desc">${renderInline(rest, clipSpans(bodySpans, restStart, restStart + rest.length))}</span>`
        : "";
      rows.push(`<div class="pv-row pv-definition" style="--depth:${depth}"><strong class="pv-name">${paintSlice(name, clipSpans(bodySpans, 1, 1 + name.length))}</strong>${desc}</div>`);
      continue;
    }

    const edge = /^(On\s+)([A-Za-z][A-Za-z0-9_-]*)(.*)$/.exec(body);
    if (edge) {
      const evStart = edge[1]!.length;
      const restStart = evStart + edge[2]!.length;
      rows.push(
        `<div class="pv-row pv-edge" style="--depth:${depth}"><span class="pv-bullet">→</span><span class="pv-keyword">${escapeHtml(edge[1]!)}</span><span class="pv-event">${paintSlice(edge[2]!, clipSpans(bodySpans, evStart, restStart))}</span>${renderInline(edge[3]!, clipSpans(bodySpans, restStart, body.length))}</div>`,
      );
      continue;
    }

    rows.push(`<div class="pv-row pv-directive" style="--depth:${depth}"><span class="pv-bullet">·</span>${renderInline(body, bodySpans)}</div>`);
  }
  return rows.join("");
}

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
          ...res.transition.emits.map((e) => `emit ${e.event}${e.payload ? `(${e.payload})` : ""}`),
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
    const analysis = analyzeMachine(machine);
    const json = JSON.stringify(machine, null, 2);

    const stateStillExists = machine.states.some((s) => s.name === currentState);
    if (!currentMachine || !stateStillExists) {
      currentState = machine.initial;
      trace = [];
    }
    currentMachine = machine;

    formattedView.innerHTML = renderReader(applied.text, applied.spans);
    jsonView.textContent = json + "\n";

    const warn = analysis.unreachableStates.length
      ? ` • unreachable: ${analysis.unreachableStates.join(", ")}`
      : "";
    const tokNote = tokens.length ? ` • ${tokens.length} tokens` : "";
    plainNotes.textContent = `Deterministic • ${analysis.states.length} states, ${machine.transitions.length} transitions${tokNote}${warn}`;
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
  plainInput.value = EXAMPLES[id] ?? EXAMPLES.checkbox!;
  Object.assign(tokenValues, DEFAULT_TOKENS);
  currentMachine = null;
  guardValues = {};
  trace = [];
  compile();
}

plainInput.addEventListener("input", compile);
exampleSelect.addEventListener("change", () => loadExample(exampleSelect.value));
formatBtn.addEventListener("click", () => {
  try {
    const applied = applyTokens(plainInput.value, tokenValues);
    plainInput.value = formatPlainState(parsePlainState(applied.text));
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

loadExample("checkbox");
