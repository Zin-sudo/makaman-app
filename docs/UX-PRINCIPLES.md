# UX design principles

Standing instructions for this project (user, 2026-09-02). Apply them across layouts,
navigation, onboarding, forms, settings, dashboards, and interactive flows. The goal is to
minimise confusion, reduce effort, prevent mistakes, and help someone finish what they came
to do as quickly as possible.

These arrived after the app was largely built, so they govern everything from here on
rather than being a mandate to redesign what already works. Where an existing screen
already satisfies a rule, leave it alone. Where it breaks one, that is a defect with a
name.

---

## 1. Reduce choices per screen — Hick's Law
Decision time grows with the number and complexity of the choices offered.
- One clear purpose per screen.
- Remove irrelevant or low-priority options.
- Break complicated decisions into smaller steps.
- Recommend an option when the choice is genuinely hard.

## 2. Make targets large — Fitts's Law
Large, nearby targets are faster and easier to hit.
- Buttons and controls easy to click or tap.
- Enough spacing between interactive elements.
- Never a tiny icon as the only interaction target.
- Increase the clickable area around important controls.

## 3. Follow familiar patterns — Jakob's Law
People expect this to work like the products they already use.
- Established conventions.
- Navigation, search, settings and account controls where they are expected.
- Familiar icons and interaction patterns.
- Invent a new pattern only for a meaningful advantage.

## 4. Group related information — Law of Proximity
Elements near one another are read as related.
- Related labels, controls and information together.
- Spacing communicates relationships.
- Extra space separates unrelated groups.
- Do not reach for a border when spacing establishes the hierarchy.

## 5. Break content into chunks — Miller's Law
Working memory handles only so much at once.
- Long content divided into small, meaningful groups.
- Complex forms and tasks split into manageable steps.
- Headings, sections, concise labels.
- Never ask somebody to carry information between screens in their head.

## 6. Respond within 400 milliseconds — Doherty Threshold
An interface feels productive when feedback arrives within roughly 400 ms.
- Acknowledge every action immediately.
- Show loading, processing or success states when the result is not instant.
- Optimistic updates where they are safe.
- Never leave somebody wondering whether their action registered.

## 7. Highlight the primary action — Von Restorff Effect
What differs visually gets the attention.
- Strongest visual emphasis on the primary action.
- One dominant call to action per section.
- Secondary actions visually quieter.
- Not every button competing.

## 8. Place key actions nearby — Fitts's Law
Interaction is faster when the target is near the current focus.
- Actions beside the content they affect.
- Form submission near the final input.
- Frequent actions within easy reach.
- No unnecessary cursor or eye movement.

## 9. Put essentials first — Serial Position Effect
The first and last items in a sequence are remembered best.
- Most important information first.
- Final action or takeaway at the end.
- Lower-priority material in the middle.
- Navigation and lists ordered by importance to the user.

## 10. End flows memorably — Peak-End Rule
An experience is judged by its most intense moment and by how it ends.
- A clear, satisfying completion state.
- Confirm what was accomplished.
- Say what happens next.
- Never end a flow on an empty or ambiguous screen.

## 11. Show visible progress — Zeigarnik Effect
Unfinished tasks stay mentally active and draw people back.
- Show completed and unfinished steps.
- Save progress wherever possible.
- Make an interrupted task easy to resume.
- Checklists or completion states for multi-step work.

## 12. Simplify complex interfaces — Law of Prägnanz
Complex or ambiguous designs are read in the simplest form available.
- Simple structures, recognisable shapes.
- No unnecessary decoration or visual noise.
- An obvious visual hierarchy.
- Understandable at a glance.

## 13. Use sensible defaults — Hick's Law
Good defaults remove decisions.
- Preselect the safest and most common option.
- Use context to avoid asking for what is already known.
- Never a default that creates an unexpected commitment.
- Every default easy to change.

## 14. Prevent errors proactively — Postel's Law
Accept reasonable variation in input; produce clear, predictable results.
- Accept common formats and variations.
- Explain requirements *before* submission.
- Disable impossible or unavailable actions.
- Warn before anything risky or destructive.

## 15. Make errors recoverable — Postel's Law
Handle mistakes gracefully rather than turning them into failure.
- Preserve the person's work after an error.
- Explain what went wrong in plain language.
- Say exactly how to fix it.
- Offer undo, retry, restore or cancel where appropriate.

## 16. Maintain pattern consistency — Law of Similarity
Things that look alike are taken to do alike.
- Same appearance and behaviour for similar components.
- Consistent colours, labels, icons, spacing and interaction states.
- Never the same visual treatment for different actions.
- Reuse an established component before creating a new one.

## 17. Connect related elements visually — Law of Uniform Connectedness
Visually connected elements read as more closely related.
- Containers, lines, backgrounds or shared states show relationships.
- Controls visually connected to the content they affect.
- Unrelated elements kept visually separate.
- Connection used deliberately, not decoratively.

## 18. Reduce task completion time — Parkinson's Law
Tasks expand to fill the time made available.
- Fewest steps.
- No unnecessary confirmations or screens.
- Prefill what has already been provided.
- Shortcuts for frequent or repeat actions.

## 19. Reveal complexity gradually — Tesler's Law
Some complexity cannot be removed, only managed or moved.
- Essential controls first.
- Advanced options revealed when relevant.
- The system absorbs complexity wherever it can.
- Never force somebody to understand internal technical detail.

## 20. Make completion feel closer — Goal-Gradient Effect
Motivation rises as the goal comes into view.
- Show progress through multi-step flows.
- Divide long tasks into visible milestones.
- Emphasise progress already made.
- Make the remaining work specific and achievable.

---

## When building or revising an interface

1. Identify the user's primary goal.
2. Design the shortest clear path to it.
3. Make the next action visually obvious.
4. Remove anything that distracts from completion.
5. Give immediate feedback after every interaction.
6. Prevent errors before they occur.
7. Preserve work when something goes wrong.
8. Confirm clearly when the goal is reached.

When these conflict, prioritise clarity, accessibility, user control and successful task
completion. Do not apply them mechanically — use them to make deliberate decisions about
the situation in front of you.

---

## Applied here so far

| # | where | what changed |
|---|---|---|
| 2, 16 | six row-delete `×` controls | one `.mk-rowdel` class, 40 × 40 minimum, a danger wash and a real label |
| 7, 12 | the suggestion chip and the counter tiles | a proposal looks like a proposal — dashed outline and a wash, quieter than the accent buttons it sits beside |
| 11, 20 | ticket approval | the checklist counts what is left and the button names the blockers |
| 13 | Base Location, Customer Rep | hardcoded defaults on every ticket, changeable by the office only |
| 14 | sign-up | the `@makaman.ly` requirement is stated on the form before anything is typed, and refused in plain words rather than as a database error |
| 15 | the outbox and the error log | a refused write keeps the work and is recorded with a code |
| 12, 5 | the awaiting-paperwork backlog | an unbounded list of warning rows became one count that filters the list below |

Deferred past the v1.0.0 trial, deliberately: Hick #1 / Miller #5 screen-splitting and
Tesler #19 progressive disclosure. Both are redesigns of screens technicians are being
trained on this week.
