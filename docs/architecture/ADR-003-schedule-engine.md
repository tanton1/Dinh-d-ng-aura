# ADR-003: Extend optimizer-v12 with checkpoints, not a rewrite

Optimizer-v12 already implements the required priority order, repair chain and bounded search. The next improvement is checkpoint/background execution plus optimality and unassigned-reason metrics for large branches. The eight-session target remains soft.

