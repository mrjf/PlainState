# PlainState

PlainState is a controlled-natural-language notation for finite state machines.
It shares the readable, Markdown-like shape of
[`PlainType`](https://github.com/mrjf/PlainType),
[`PlainData`](https://github.com/mrjf/PlainData), and
[`***plain`](https://www.plainlang.org/docs/), while giving every transition a
deterministic grammar so a compiler—not an LLM—decides its meaning.

Its primary invariant is:

```text
JSON Machine -> PlainState -> JSON Machine = the same state machine
```

## Example

```plain
***plainstate***

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
```

PlainState checks guard determinism at parse time—overlapping transitions for
the same `(state, event)` are rejected—and ships a zero-dependency step
evaluator and reachability analyzer.

## Use

Node.js 20 or newer is required.

```bash
npm install
npm run build

node dist/src/cli.js to-json examples/button-press.plainstate --pretty
node dist/src/cli.js from-json examples/button-press.json
node dist/src/cli.js check examples/button-press.plainstate
node dist/src/cli.js format examples/button-press.plainstate
```

Library API:

```ts
import { parsePlainState, formatPlainState, stepMachine, analyzeMachine } from "plainstate";

const machine = parsePlainState(source);
const next = stepMachine(machine, machine.initial, "begin", { interactive: true });
const report = analyzeMachine(machine);
```

## Studio

The interactive [PlainState Studio](https://mrjf.github.io/PlainState/) runs
entirely in the browser—edit machines live, toggle guards, fire events in the
built-in simulator, inspect the live state diagram, and view canonical PlainState
and JSON output.

```bash
cd demo
bun run build:pages
```

See [docs/language.md](docs/language.md) for the full language contract.

## The Plain Family

| Project | Purpose | Repo | Studio |
| --- | --- | --- | --- |
| **PlainType** | Controlled-natural-language JSON Schema | [mrjf/PlainType](https://github.com/mrjf/PlainType) | [PlainType Studio](https://mrjf.github.io/PlainType/) |
| **PlainData** | Lossless JSON data notation | [mrjf/PlainData](https://github.com/mrjf/PlainData) | [PlainData Studio](https://mrjf.github.io/PlainData/) |
| **PlainState** | Deterministic finite state machines | [mrjf/PlainState](https://github.com/mrjf/PlainState) | [PlainState Studio](https://mrjf.github.io/PlainState/) |
| **PlainView** | Typographic reader for `***plain` documents | [mrjf/PlainView](https://github.com/mrjf/PlainView) | [PlainView Studio](https://mrjf.github.io/PlainView/) |
