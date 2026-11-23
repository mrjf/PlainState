export interface GuardClause {
  readonly name: string;
  readonly negated: boolean;
}

export interface EmitClause {
  readonly event: string;
  readonly payload?: string;
}

export interface Transition {
  readonly from: string;
  readonly event: string;
  readonly guards: readonly GuardClause[];
  readonly to: string;
  readonly actions: readonly string[];
  readonly emits: readonly EmitClause[];
  readonly effects: readonly string[];
  readonly present?: string;
}

export interface StateDefinition {
  readonly name: string;
  readonly description: string;
}

export interface StateMachine {
  readonly initial: string;
  readonly unhandled: "ignore";
  readonly states: readonly StateDefinition[];
  readonly transitions: readonly Transition[];
}

export interface MachineAnalysis {
  readonly states: readonly string[];
  readonly events: readonly string[];
  readonly guards: readonly string[];
  readonly unreachableStates: readonly string[];
  readonly terminalStates: readonly string[];
}

export interface StepResult {
  readonly matched: boolean;
  readonly from: string;
  readonly to: string;
  readonly event: string;
  readonly transition?: Transition;
}

export class PlainStateError extends Error {
  public readonly line: number | undefined;

  public constructor(message: string, line?: number) {
    super(line !== undefined ? `PlainState line ${line}: ${message}` : message);
    this.name = "PlainStateError";
    this.line = line;
  }
}

const IDENT = /^[A-Za-z][A-Za-z0-9_-]*$/;

function parseGuards(raw: string, line: number): GuardClause[] {
  const parts = raw.split(" and ");
  const guards: GuardClause[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const trimmed = part.trim();
    const negated = trimmed.startsWith("not ");
    const name = negated ? trimmed.slice(4).trim() : trimmed;
    if (!IDENT.test(name)) {
      throw new PlainStateError(`Invalid guard identifier "${trimmed}"`, line);
    }
    const key = `${negated ? "!" : ""}${name}`;
    if (seen.has(key)) {
      throw new PlainStateError(`Duplicate guard "${trimmed}"`, line);
    }
    seen.add(key);
    guards.push({ name, negated });
  }
  return guards;
}

function formatGuards(guards: readonly GuardClause[]): string {
  return guards.map((g) => (g.negated ? `not ${g.name}` : g.name)).join(" and ");
}

function guardSatisfied(
  guards: readonly GuardClause[],
  env: Readonly<Record<string, boolean>>,
): boolean {
  return guards.every((g) => {
    const val = Boolean(env[g.name]);
    return g.negated ? !val : val;
  });
}

function guardsCanOverlap(a: readonly GuardClause[], b: readonly GuardClause[]): boolean {
  const map = new Map<string, boolean>();
  for (const g of [...a, ...b]) {
    const required = !g.negated;
    const prev = map.get(g.name);
    if (prev !== undefined && prev !== required) return false;
    map.set(g.name, required);
  }
  return true;
}

export function validateMachine(machine: StateMachine): void {
  if (machine.unhandled !== "ignore") {
    throw new PlainStateError(`Unsupported unhandled-event policy "${String(machine.unhandled)}"`);
  }
  const stateNames = new Set<string>();
  for (const s of machine.states) {
    if (!IDENT.test(s.name)) {
      throw new PlainStateError(`Invalid state name "${s.name}"`);
    }
    if (stateNames.has(s.name)) {
      throw new PlainStateError(`Duplicate state "${s.name}"`);
    }
    stateNames.add(s.name);
  }
  if (!stateNames.has(machine.initial)) {
    throw new PlainStateError(`Initial state "${machine.initial}" is not declared`);
  }

  for (let i = 0; i < machine.transitions.length; i += 1) {
    const t = machine.transitions[i]!;
    if (!stateNames.has(t.from)) {
      throw new PlainStateError(`Unknown source state "${t.from}"`);
    }
    if (!stateNames.has(t.to)) {
      throw new PlainStateError(`Unknown target state "${t.to}"`);
    }
    if (!IDENT.test(t.event)) {
      throw new PlainStateError(`Invalid event name "${t.event}"`);
    }
    for (let j = i + 1; j < machine.transitions.length; j += 1) {
      const other = machine.transitions[j]!;
      if (other.from === t.from && other.event === t.event && guardsCanOverlap(t.guards, other.guards)) {
        throw new PlainStateError(
          `Overlapping transitions for ${t.from} on "${t.event}"`,
        );
      }
    }
  }
}

export function parsePlainState(source: string): StateMachine {
  const rawLines = source.replace(/\r\n/g, "\n").split("\n");
  const rows = rawLines
    .map((text, index) => ({ text: text.trimEnd(), line: index + 1 }))
    .filter((row) => row.text.trim().length > 0);

  if (rows.shift()?.text !== "***plainstate***") {
    throw new PlainStateError("Expected ***plainstate*** header", 1);
  }

  let initial = "";
  let unhandled = false;
  const states: StateDefinition[] = [];
  const transitions: Array<{
    from: string;
    event: string;
    guards: GuardClause[];
    to: string;
    actions: string[];
    emits: EmitClause[];
    effects: string[];
    present?: string;
  }> = [];

  let currentState = "";
  let currentEdge: (typeof transitions)[number] | undefined;

  for (const { text, line } of rows) {
    let m: RegExpMatchArray | null;
    if (!currentState && (m = text.match(/^- Starts in :([A-Za-z][A-Za-z0-9_-]*):\.$/))) {
      if (initial) throw new PlainStateError("Duplicate initial state declaration", line);
      initial = m[1]!;
    } else if (!currentState && text === "- Unhandled events leave state unchanged and emit nothing.") {
      if (unhandled) throw new PlainStateError("Duplicate unhandled-event policy", line);
      unhandled = true;
    } else if ((m = text.match(/^- :([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.+))?$/))) {
      currentState = m[1]!;
      currentEdge = undefined;
      if (states.some((s) => s.name === currentState)) {
        throw new PlainStateError(`Duplicate state :${currentState}:`, line);
      }
      states.push({ name: currentState, description: m[2]?.trim() ?? "" });
    } else if (
      currentState &&
      (m = text.match(
        /^  - On ([A-Za-z][A-Za-z0-9_-]*)(?:, when ([^,]+))?, (?:go to :([A-Za-z][A-Za-z0-9_-]*):|stay)\.$/,
      ))
    ) {
      const guards = m[2] ? parseGuards(m[2], line) : [];
      currentEdge = {
        from: currentState,
        event: m[1]!,
        guards,
        to: m[3] ?? currentState,
        actions: [],
        emits: [],
        effects: [],
      };
      transitions.push(currentEdge);
    } else if (currentEdge && (m = text.match(/^    - Do ([A-Za-z][A-Za-z0-9_-]*)\.$/))) {
      currentEdge.actions.push(m[1]!);
    } else if (
      currentEdge &&
      (m = text.match(/^    - Emit ([A-Za-z][A-Za-z0-9_-]*)(?: with (.+))?\.$/))
    ) {
      const emit: EmitClause = m[2] !== undefined ? { event: m[1]!, payload: m[2] } : { event: m[1]! };
      currentEdge.emits.push(emit);
    } else if (currentEdge && (m = text.match(/^    - Request (.+)\.$/))) {
      currentEdge.effects.push(m[1]!);
    } else if (currentEdge && (m = text.match(/^    - Present ([A-Za-z][A-Za-z0-9_-]*)\.$/))) {
      if (currentEdge.present !== undefined) {
        throw new PlainStateError("Duplicate Present clause", line);
      }
      currentEdge.present = m[1]!;
    } else {
      throw new PlainStateError(`Unsupported or misplaced sentence: ${text}`, line);
    }
  }

  if (!initial) {
    throw new PlainStateError("Missing initial state declaration (- Starts in :State:.)");
  }
  if (!unhandled) {
    throw new PlainStateError(
      "Missing unhandled-event policy (- Unhandled events leave state unchanged and emit nothing.)",
    );
  }

  const machine: StateMachine = {
    initial,
    unhandled: "ignore",
    states,
    transitions,
  };
  validateMachine(machine);
  return machine;
}

export function formatPlainState(machine: StateMachine): string {
  validateMachine(machine);
  const rows = [
    "***plainstate***",
    "",
    `- Starts in :${machine.initial}:.`,
    "- Unhandled events leave state unchanged and emit nothing.",
    "",
  ];

  for (const state of machine.states) {
    rows.push(
      state.description ? `- :${state.name}: ${state.description}` : `- :${state.name}:`,
    );
    for (const edge of machine.transitions.filter((t) => t.from === state.name)) {
      const guardPart = edge.guards.length > 0 ? `, when ${formatGuards(edge.guards)}` : "";
      const targetPart = edge.to === state.name ? "stay" : `go to :${edge.to}:`;
      rows.push(`  - On ${edge.event}${guardPart}, ${targetPart}.`);
      for (const action of edge.actions) {
        rows.push(`    - Do ${action}.`);
      }
      for (const emit of edge.emits) {
        rows.push(
          emit.payload !== undefined
            ? `    - Emit ${emit.event} with ${emit.payload}.`
            : `    - Emit ${emit.event}.`,
        );
      }
      for (const effect of edge.effects) {
        rows.push(`    - Request ${effect}.`);
      }
      if (edge.present !== undefined) {
        rows.push(`    - Present ${edge.present}.`);
      }
    }
  }

  return rows.join("\n") + "\n";
}

export function fromJsonMachine(jsonText: string): string {
  const parsed = JSON.parse(jsonText) as StateMachine;
  return formatPlainState(parsed);
}

export function toJsonMachine(plainStateText: string, indent?: number): string {
  const machine = parsePlainState(plainStateText);
  return JSON.stringify(machine, null, indent);
}

export function formatPlainStateText(plainStateText: string): string {
  return formatPlainState(parsePlainState(plainStateText));
}

export function stepMachine(
  machine: StateMachine,
  state: string,
  event: string,
  guards: Readonly<Record<string, boolean>> = {},
): StepResult {
  const match = machine.transitions.find(
    (t) => t.from === state && t.event === event && guardSatisfied(t.guards, guards),
  );
  if (!match) {
    return { matched: false, from: state, to: state, event };
  }
  return { matched: true, from: state, to: match.to, event, transition: match };
}

export function analyzeMachine(machine: StateMachine): MachineAnalysis {
  const states = machine.states.map((s) => s.name);
  const events = [...new Set(machine.transitions.map((t) => t.event))];
  const guards = [...new Set(machine.transitions.flatMap((t) => t.guards.map((g) => g.name)))];

  const reachable = new Set<string>([machine.initial]);
  const queue = [machine.initial];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const t of machine.transitions) {
      if (t.from === current && !reachable.has(t.to)) {
        reachable.add(t.to);
        queue.push(t.to);
      }
    }
  }

  const unreachableStates = states.filter((s) => !reachable.has(s));
  const terminalStates = states.filter(
    (s) => !machine.transitions.some((t) => t.from === s && t.to !== s),
  );

  return { states, events, guards, unreachableStates, terminalStates };
}
