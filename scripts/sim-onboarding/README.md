# onboarding-sim

Re-runnable audit behind section 4 of claude_change_spec.md. Plain Node 22, no dependencies.

    node report.mjs   # structure audit over all 6,144 answer sets, shipped vs new, pressure weight 3/4/5
    node sim.mjs      # respondent simulation, shipped vs new, three noise levels, two priors
    node grid.mjs     # search over secondary-point structures
    node final.mjs    # Bayes ceiling, 300-run robustness check
    node extra.mjs    # drop-one ablation, tiebreak threshold, straight-liners

`lib2.mjs` holds the scoring and the respondent model (STYLE, DOMAIN). The model is an assumption, not measured data.
`designs.mjs` has the shipped (OLD) tables; `finaldesign.mjs` has the new ones. Keep them in step with src/lib/engine.ts if the tables change.
