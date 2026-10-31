# Onboarding questions: evidence for the v3.1 rewrite

Method: brute force over all 4^5 x 6 = 6,144 answer sets (structure), plus a respondent simulation (60,000 synthetic users per cell, fixed seeds). A synthetic user has a hidden core and picks each style option by a probability that depends on it, with a clarity knob h (1 clear, 0.5 very noisy). Assumed mix: Romantic 35, Friend 22, Psych 20, Money 12, Trainer 11 percent. The respondent model is mine, not measured. The simulation tests whether the scoring recovers a hidden core, not whether real people answer this way. Re-run: `onboarding-sim.zip`.

| Measure | Shipped | New |
|---|---|---|
| Top-1 accuracy, clear respondents (h=1), after tiebreak screen | 77.3% | 83.1% |
| h=0.7 / h=0.5 | 64.5% / 54.7% | 70.5% / 59.3% |
| Worst core's recall (h=1) | 60.7% (MONEY) | 81.5% |
| Money pressure lands on MONEY (uniform answers; TRAINER 0% in both) | 40% | 48% |
| Tiebreak screen shown, respondent sim h=1 / h=0.7 | 23.7% / 28.7% | 25.6% / 32.6% (slightly more, see below) |
| Beats shipped when every probability is perturbed +/-35% (300 runs) | | 300 of 300, median +5.7 points |
| MONEY or TRAINER primary also given the other as 30% secondary | n/a | 75% and 84% without the D5 rule, 0% with it |
| Straight-lining card 4 | TRAINER in 5 of 6 | spread across cores |

Findings that shaped the build:
- The new scoring sits at the information ceiling. The Bayes-optimal accuracy for this question structure is 82.2% without the tiebreak screen; the points scheme scores 83.1% with it. More accuracy now needs better questions or real data, not different weights.
- Every question earns its place: dropping any one of q5 to q9 costs 3.0 to 3.3 points, dropping the pressure question costs 2.8. None is redundant, none dominates.
- The first draft had ROMANTIC collecting secondary points from three of four option types, which pulled Friend recall from 84% to 72%. A search over secondary structures (18 configurations, two pressure weights) chose the current one: closeness feeds ROMANTIC and FRIEND, reflective feeds PSYCH alone, playful feeds FRIEND and ROMANTIC, directive feeds MONEY and TRAINER equally.
- Cost of the new set: the tiebreak screen appears 2 to 4 points more often. Directive answers give MONEY and TRAINER an exact tie that only the pressure answer breaks, so a directive user who picks a non-domain pressure (for example "Feeling on my own") is asked MONEY or TRAINER on screen 12. That tie is the honest state of the data. It is also the screen that adds information: the best any scoring can do from the five questions plus pressure is 82.2%, and the tiebreak answer takes it to 83.1%.
- Tiebreak threshold trade-off at h=0.8: margin 1 shows the screen to 10.5% (top-1 72.5%), margin 2 to 30.2% (75.3%), margin 3 to 47.3% (75.8%). Margin 2 kept (D6).

Research behind the option design:
- Cutrona and Russell's optimal matching model: emotional support helps most for stressors people cannot control, informational and instrumental support for ones they can. Studies are mixed (some find only slight support), so it frames the four support styles and is not used as a validated scoring rule.
- Forced-choice items with similar social desirability resist faking and acquiescence better than rating scales (Kreitchmann et al., 2019). Every option is written to be equally flattering; the old "Everyone hears about it" is gone.
- A survey of 404 regular companion-chatbot users (MIT Media Lab) found technology curiosity and entertainment dominate stated motives, ahead of social ones. So the playful style keeps its own route to FRIEND in every question, not only emotional-depth routes.

Post-launch check: after about 200 completed onboardings, compare the assigned-core distribution, tiebreak rate, redraws per core and first-week retention by core. `companions.answers` and `companions.core` already store what is needed.
