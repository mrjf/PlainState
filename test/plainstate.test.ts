import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeMachine,
  formatPlainState,
  fromJsonMachine,
  parsePlainState,
  PlainStateError,
  stepMachine,
  toJsonMachine,
} from "../src/index.js";

const BUTTON_PRESS = `***plainstate***

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
`;

describe("PlainState", () => {
  it("round-trips PlainState <-> JSON losslessly", () => {
    const machine = parsePlainState(BUTTON_PRESS);
    assert.equal(formatPlainState(machine), BUTTON_PRESS);

    const json = toJsonMachine(BUTTON_PRESS, 2);
    assert.equal(fromJsonMachine(json), BUTTON_PRESS);
  });

  it("evaluates transitions and guards deterministically", () => {
    const machine = parsePlainState(BUTTON_PRESS);

    const blocked = stepMachine(machine, "Idle", "begin", { interactive: false });
    assert.equal(blocked.matched, false);
    assert.equal(blocked.to, "Idle");

    const pressed = stepMachine(machine, "Idle", "begin", { interactive: true });
    assert.equal(pressed.matched, true);
    assert.equal(pressed.to, "Pressed");

    const released = stepMachine(machine, "Pressed", "release", { interactive: true });
    assert.equal(released.matched, true);
    assert.equal(released.to, "Idle");
    assert.deepEqual(released.transition?.emits, [
      { event: "activated", payload: "an empty payload" },
    ]);

    const cancelled = stepMachine(machine, "Pressed", "release", { interactive: false });
    assert.equal(cancelled.matched, true);
    assert.equal(cancelled.to, "Idle");
    assert.deepEqual(cancelled.transition?.emits, []);
  });

  it("rejects overlapping guards on the same state and event", () => {
    const ambiguous = `***plainstate***

- Starts in :Idle:.
- Unhandled events leave state unchanged and emit nothing.

- :Idle: Ready.
  - On click, when interactive, go to :Active:.
  - On click, when focused, stay.
- :Active: Running.
`;
    assert.throws(() => parsePlainState(ambiguous), /Overlapping transitions/i);
  });

  it("detects unreachable and terminal states", () => {
    const source = `***plainstate***

- Starts in :Open:.
- Unhandled events leave state unchanged and emit nothing.

- :Open: Door is open.
  - On close, go to :Closed:.
- :Closed: Door is closed.
- :Broken: Unreachable state.
`;
    const machine = parsePlainState(source);
    const analysis = analyzeMachine(machine);
    assert.deepEqual(analysis.unreachableStates, ["Broken"]);
    assert.deepEqual(analysis.terminalStates, ["Closed", "Broken"]);
  });

  it("rejects unknown target states and missing headers", () => {
    assert.throws(() => parsePlainState("bad header\n"), PlainStateError);
    assert.throws(
      () =>
        parsePlainState(`***plainstate***
- Starts in :A:.
- Unhandled events leave state unchanged and emit nothing.
- :A: Start.
  - On go, go to :Missing:.
`),
      /Unknown target state/i,
    );
  });
});
