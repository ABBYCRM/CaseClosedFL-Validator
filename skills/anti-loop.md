# Anti-loop skill

The runtime, not the model, enforces this skill.

- Every external action is fingerprinted from tool + capability + normalized arguments.
- A materially identical failed action may not be retried after the configured failure threshold unless observable state changed.
- Prefer a different provider/source/method after failure: known official source -> government-domain discovery -> alternative search -> read-only browser -> incomplete.
- Every cycle must produce a new fact, evidence record, resolved unknown, tool observation, strategy change, or terminal decision.
- Two no-progress cycles are `LOOP_DETECTED`; stop recursive reasoning and choose a materially different action or terminate.
- Tool/model/cycle budgets are hard boundaries, not suggestions.
- Failure, UNKNOWN, and INCOMPLETE are acceptable terminal outcomes.
