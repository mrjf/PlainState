# PlainState Language Contract

PlainState is a deterministic, `***plain`-aligned notation for finite state machines.

## Primary invariant

```text
JSON Machine -> PlainState -> JSON Machine = the same state machine
```

## Grammar

A PlainState document consists of:

1. The header line `***plainstate***`.
2. Initial state declaration: `- Starts in :<State>:.`
3. Explicit unhandled-event policy: `- Unhandled events leave state unchanged and emit nothing.`
4. One or more state declarations: `- :<State>: <description>`
5. Zero or more transitions indented by two spaces under their source state:
   - `  - On <event>, go to :<Target>:.`
   - `  - On <event>, stay.`
   - `  - On <event>, when <guard1> and <guard2>, go to :<Target>:.`
   - `  - On <event>, when not <guard>, stay.`
6. Optional transition clauses indented by four spaces:
   - `    - Do <action>.`
   - `    - Emit <event>.` or `    - Emit <event> with <payload>.`
   - `    - Request <effect>.`
   - `    - Present <policy>.`

## Determinism check

For any `(state, event)` pair with multiple transitions, PlainState checks whether their guard conjunctions can be simultaneously satisfied. Overlapping guards are rejected at parse time so every `(state, event, guards)` step is deterministic.
