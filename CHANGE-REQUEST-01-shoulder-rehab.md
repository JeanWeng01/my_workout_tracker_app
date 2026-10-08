# Change Request 01: Shoulder rehab track, pain check, shoulder accessories, rest timer

**For Claude Code.** This amends the existing build spec (`bulletproof-app-spec.md`, or wherever its copy lives in this repo). The app is already built and I have real workout data in it (Day 1 is logged), both on my phone and in Railway Postgres.

## 0. How to work on this

1. **Start in plan mode.** Read this document, the current spec, and the current code. Then give me a plan before editing anything:
   - which files change,
   - how existing data is handled (section 9),
   - any server or database migration (show me the SQL before running it on Railway; still nothing outside the `bulletproof` schema),
   - which existing tests change and which new tests you'll add.
2. **Never modify or delete my existing logged sessions.** All new behaviour is added through new settings, new exercise types, and new decision types.
3. Engine changes stay pure TypeScript and test-first, as in the original spec.
4. When done, **update the spec document in the repo** so it describes the app as it now works. That document stays the single source of truth for future changes.
5. If anything here conflicts with how the app was actually built, ask me instead of guessing.

## 1. Why

On Day 1, barbell bench press (45 lb) aggravated an old shoulder problem: instability, weakness and vague pain at the front/side of the shoulder (about the 1:30 position if the front is 12:00 and the side is 3:00), showing up in sets 3–5. The same spot was first hurt doing deep bodyweight dips at 19, and again by a sudden arm movement while swimming about 8 months ago. For roughly the next 12 weeks:

- Squat, Deadlift and Barbell Row continue normal linear progression.
- Bench Press and Overhead Press are **replaced by neutral-grip dumbbell variations** that step up slowly, gated by how my shoulder feels.
- When the shoulder is ready, Bench and OHP **return to the barbell** at light weights and start normal linear progression.

## 2. New concept: per-lift track

Each main lift now has a **track**: `rehab` | `linear` | `531`.

- At the moment this change ships: Squat, Deadlift, Row → `linear` (unchanged). Bench, OHP → `rehab`.
- Whatever slot a lift occupies in a workout (A/B in linear, rotation in 5/3/1), the app shows the exercise for that lift's current track.
- Settings gets a **per-lift track override** (either direction), saved as a decision. Example: a physio tells me to go back to dumbbells.

## 3. Rehab track

### 3.1 Exercises

| Lift slot | Rehab exercise |
|---|---|
| Bench Press | **Dumbbell Floor Press, neutral grip** (palms facing each other) |
| Overhead Press | **Seated Dumbbell Overhead Press, neutral grip** |

- These are **separate exercises with their own history** (new exercise IDs). Barbell Bench and OHP history stays as it is and is ignored while the lift is on the rehab track.
- **Scheme: 3 sets, with reps climbing before weight does** ("double progression", see 3.3). Not 5×5: rehab programs typically use lighter loads for more reps, with a slow, controlled lowering.
- Weights are shown **per hand**: "2 × 15 lb". No plate breakdown for dumbbells.
- Under the weight, a small fixed cue: `Lower for 3 s`.
- Warm-ups: none generated for rehab exercises.

### 3.2 Dumbbell ladders and rep steps (Settings, editable)

| Exercise | Default weight ladder (lb per hand) |
|---|---|
| DB Floor Press | 15 → 17.5 → 20 → 25 → 30 |
| Seated DB OHP | 12.5 → 15 → 17.5 → 20 |

| Setting | Default |
|---|---|
| Rehab sets | 3 |
| Rehab rep steps | 10 → 12 → 15 |

- The weight stepper on a rehab card moves only through ladder values.
- I'll edit the ladders to match my gym's dumbbell rack (e.g., adding 22.5 or 27.5 if available) and anything a physio prescribes later. Don't hard-code them.

### 3.3 Rehab progression rules (per rehab exercise)

Definitions: **completed** = all 3 sets reached the current rep target. **Pain zone** comes from the shoulder check (section 4).

Each rehab exercise tracks a **weight step** and a **rep step**. A new weight always starts at the first rep step (3 × 10).

- **Completed + green** →
  - not yet at the top rep step: next session moves up one rep step at the same weight (3 × 10 → 3 × 12 → 3 × 15);
  - at the top rep step (3 × 15): next session moves up one ladder weight, back to 3 × 10.
- **Hold** (repeat the same weight and reps) on missed reps, amber pain, or a missing pain rating. Holding never counts as a stall, and there is no automatic deload on the rehab track.
- **Red** pain → alert suggesting I drop back one ladder weight at 3 × 10 (Accept / Keep my numbers). On the first ladder weight, the suggestion is 3 × 10 at the same weight.
- **Red pain in 2 consecutive sessions** of the same exercise → alert: "Your shoulder flagged red twice in a row. Pause this lift and get it assessed before continuing." Buttons: **Pause this lift** (it shows as "Paused" and is skipped automatically until I resume it in Settings) / Keep going.

**How a rehab card shows this:** the app does the tracking; the card only shows today's prescription.

- **Collapsed:** `DB Floor Press · 3 × 12 · 2 × 15 lb`
- **Expanded:** the weight (2 × 15 lb), the set chips (each targeting today's reps), the cue `Lower for 3 s`, and the Shoulder rating row. Nothing else: no progress lines, no rule explanations.
- The rules above run silently in the engine. The only progression text I see is the short info alert after a session when something changes (section 8).

Pace check (for "About the rules"): each weight takes at least 3 sessions of that exercise; each press comes up every other workout. At 3 workouts a week, the floor press ladder takes about 10 weeks at the fastest, and longer if I hold.

### 3.4 Return to the barbell (alert, not automatic)

Unlike the automatic 5/3/1 switch, this is a deliberate choice, because it's an injury decision.

- Trigger: on the **final ladder weight**, a session at the top rep step (3 × 15) completed with green pain.
- Alert copy: "Your shoulder has handled 2 × 30 lb for 3 × 15 cleanly. Ready to return to the barbell bench press at 55 lb?" Buttons: **Return to barbell** / Not yet.
- **Not yet** → keep the rehab track at the final weight and 3 × 15, and ask again after 3 more sessions.
- **Return to barbell** → the lift switches to the `linear` track with **fresh state** (5×5, missed-reps streak 0, no deloads) at the configured return weight:

| Lift | Return weight (default) |
|---|---|
| Bench Press | 55 |
| Overhead Press | 45 (empty bar) |

- From then on, normal linear rules apply, plus the pain rules for tracked lifts (4.3).

### 3.5 Interaction with the automatic 5/3/1 switch

The squat-only trigger and the automatic switch are unchanged.

- Lifts on the `linear` track at the switch move to `531` as already specified.
- **Lifts on the `rehab` track at the switch stay on rehab.** Their slot in the 5/3/1 rotation shows the rehab exercise at its current weight and rep step (3 sets, no 5/3/1 percentages, no supplemental work).
- A lift that **returns to the barbell after the program is already on 5/3/1** runs linear 5×5 in its rotation slot until its **first stall**. At that point it moves to `531` automatically, with its TM calculated per spec 4.3, entering at block 1, cycle 1, week 1. Small info alert: "Bench joins 5/3/1. Training max: 85 lb." (No congratulations screen.)
- The congratulations screen's TM list shows only lifts that actually switched. Lifts still on rehab show "Bench: still on shoulder rehab".

## 4. Shoulder check (pain rating)

### 4.1 Which lifts

Setting **Shoulder tracking**: on by default. Setting **Tracked lifts**: default DB Floor Press, Seated DB OHP, Bench Press, Overhead Press, Barbell Row. Squat and Deadlift are available to add.

### 4.2 UI

- Inside an expanded card for a tracked lift, below the set chips: a single row labelled **Shoulder**, with chips **0 1 2 3 4 5 6 7 8 9 10** (one tap) and a small **Sharp / pinching** toggle.
- One rating per lift per session, not per set. Selected chip color follows the zone. Color is never the only signal: the zone name ("OK", "Caution", "Stop") appears next to the row once a value is chosen.
- At **Finish workout**, if a tracked lift has sets logged but no rating: "Rate your shoulder for DB Floor Press?" with the chips inline and a "Skip" option.

### 4.3 Zones and rules

Defaults (editable in Settings; I'll adjust these with a physio):

| Zone | Rule |
|---|---|
| Green | 0–2 |
| Amber | 3–4 |
| Red | 5 or more, **or** Sharp / pinching toggled on |

Effects:

- **Rehab track:** section 3.3.
- **Linear track (tracked lifts):**
  - Green or no rating → normal rules.
  - Amber → hold weight next time. This does **not** count as missed reps or toward a stall.
  - Red → alert suggesting a 10% deload (Accept / Keep).
  - Red twice in a row → the same "get it assessed" alert as 3.3, with Pause.
- **531 track (tracked lifts):** any red session in a cycle → that lift's TM is held at cycle end (no increase), with an info alert. Amber is logged only.

## 5. Shoulder warm-up and shoulder accessories (no extra cards)

Shown while Shoulder tracking is on. **Neither adds a card to the workout page.** The page shows only the main lift cards, exactly as before.

### 5.1 Pull-aparts inside the first card's warm-up row

- The **first lift card** of every workout (Squat in linear) gets **Band pull-aparts, 2 × 20** as the first item of its existing collapsed "Warm-up" row, before any barbell warm-up sets. Cue: "Squeeze, hold 1 s".
- If that lift has no barbell warm-ups (e.g., working weight is the empty bar), the Warm-up row still appears, holding just the pull-aparts.
- Warm-up only: never progresses, never affects progression. Exported with `set_type = prep`.

### 5.2 Shoulder accessories inside the last card

**Exercises** (each done per arm where relevant):

| Exercise | Cue | Default weight ladder (lb) |
|---|---|---|
| Side-lying DB external rotation (per arm) | "Towel under elbow, hold 2 s" | 3 → 5 → 8 → 10 → 12 |
| DB scaption | "Thumbs up, 45°, to shoulder height" | 3 → 5 → 8 → 10 → 12 → 15 |

**Placement and reveal:**

- They ride inside the **last lift card of the workout** (linear: Row in Workout A, Deadlift in Workout B; 5/3/1: whichever main lift is last that session). If that lift is skipped, they move to the previous non-skipped card.
- They appear as a **second, smaller chip row** inside the expanded card, one line per exercise (name, weight, chips), styled like the 5/3/1 supplemental row.
- **Hidden until that lift's main work is done**: the row appears only after the last work set (and any supplemental set) of that lift has been tapped. Before that, the card looks exactly like a normal lift card. The collapsed card never mentions them.
- If they're untouched at **Finish workout**, include them in the existing untouched-sets prompt.

**Progression** (each exercise tracks its own weight step and rep step):

- **Rehab mode** (while Bench or OHP is still on the `rehab` track): 3 sets, reps 10 → 12 → 15, then the next ladder weight at 3 × 10. Same as the rehab presses (3.3).
- **Maintenance mode** (automatically, once **both** Bench and OHP are back on the barbell): **2 sets**, same rep steps and ladder, carrying over the current weight. Small info alert when it switches: "Shoulder work drops to 2 sets for maintenance."
- **Shoulder gate:** no separate rating row. They use the session's **worst** shoulder rating across tracked lifts. Completed + green → step up. Missed reps, amber, or no rating that session → hold. Red → automatically drop back one ladder weight at the first rep step, with a one-line info alert.
- **Top of the ladder** at the top rep step, completed + green → stay there, and show one info alert: "Scaption is clean at 15 lb for 3 × 15. Add a heavier dumbbell in Settings to keep progressing." Ladders, sets per mode, and rep steps are editable in Settings.
- Exported with `set_type = accessory`.

## 6. Rest timer

Day 1 I rested ~5 seconds between sets, which is far too short.

- Tapping a **work** set chip starts a **count-up** timer, shown as small text under that lift's chip row: "Rest 1:12".
- Marks: at **1:30** the text changes to "Ready" in `iron`; after **3:00** it reads "Ready (heavy sets: go now)". Thresholds editable in Settings.
- Tapping the next chip restarts it. No sounds, vibration, or notifications, and it doesn't block anything.
- Keep the screen awake during an active workout (Screen Wake Lock API where supported; fail silently otherwise).

## 7. Barbell Row

No rule change. It stays on normal linear progression (+5 lb per completed session), now pain-gated as a tracked lift. Day 1 was logged at 45 × 5×5 completed, so the next suggestion is 50 as usual.

## 8. Alerts to add

| Trigger | Copy |
|---|---|
| Rehab rep step up | "Clean and comfortable. Next time: 2 × 15 lb for 3 × 12." (info) |
| Rehab weight step up | "3 × 15 done with a happy shoulder. Next time: 2 × 17.5 lb for 3 × 10." (info) |
| Rehab hold | "Holding at 2 × 15 lb for 3 × 12 (shoulder rated 3)." (info) |
| Rehab red | "Shoulder rated 6. Drop back to 2 × 15 lb for 3 × 10?" (Accept / Keep) |
| Two reds | "Your shoulder flagged red twice in a row. Pause this lift and get it assessed before continuing." (Pause / Keep going) |
| Return to barbell | Section 3.4 |
| Linear amber | "Shoulder rated 3, so bench holds at 60 next time. This doesn't count as a miss." (info) |
| Linear red | "Shoulder rated 5. Dial bench down to 55?" (Accept / Keep) |
| 531 red | "Shoulder flagged red this cycle. Bench training max stays at 95." (info) |
| Late joiner to 5/3/1 | Section 3.5 |

## 9. Existing data and migration

- Existing sessions are untouched. Day 1's barbell bench (45 × 5×5) stays in history and in the calendar.
- On first launch after the update, create decisions (effective after the latest finished session):
  - `track_change`: Bench → `rehab`, starting at the first ladder value (15).
  - `track_change`: OHP → `rehab`, starting at the first ladder value (12.5).
- Bump the settings schema version and fill new settings with the defaults above.
- New record types (pain ratings inside sessions, pull-apart and accessory sets, accessory progression state, new decision types) must sync to Postgres. If records are stored as JSONB documents as specified, no table change should be needed. If the actual implementation differs, show me the migration first.
- CSV export: add columns `pain_0_10` and `pain_sharp` (the lift's session rating repeated on each of that lift's set rows; blank when not rated), and support `set_type = prep` and `set_type = accessory`. Exercise names in the `lift` column must distinguish `DB Floor Press` and `Seated DB OHP` from `Bench Press` and `Overhead Press`.

## 10. Tests to add

1. After migration, the next Workout A shows Squat, **DB Floor Press 2 × 15 lb, 3 × 10**, Row 50, and the next Workout B shows Squat, **Seated DB OHP 2 × 12.5 lb, 3 × 10**, Deadlift.
2. Double progression: 3 × 10 → 3 × 12 → 3 × 15 at 15 lb, then 17.5 lb at 3 × 10, each step only after a completed + green session.
3. Amber, missed reps, or a missing pain rating → hold the same weight and reps.
4. Rehab red → drop-back alert; accepting moves down one ladder weight at 3 × 10. Red on the first ladder weight → 3 × 10 at the same weight.
5. Two consecutive reds → pause alert; Pause makes the lift auto-skipped until resumed.
6. Final weight at 3 × 15, completed + green → return alert. "Not yet" → asked again after 3 more sessions. "Return" → linear Bench 55 at 5×5, fresh state.
7. Linear tracked lift: amber → hold, not counted toward stall. Red → deload suggestion.
8. Squat triggers 5/3/1 while Bench is on rehab: Bench stays rehab in its rotation slot. After returning, Bench runs linear until its first stall, then joins 5/3/1 at block 1, cycle 1, week 1 with TM per spec 4.3.
9. 5/3/1 tracked lift with one red session in a cycle → TM held.
10. Editing a ladder in Settings changes the next suggestion without altering history.
11. CSV includes pain columns and prep rows. Day 1 barbell bench rows are unchanged.
12. Sync round-trip of pain ratings, pull-apart and accessory sets, and track-change decisions.
13. Expanded rehab card shows only the weight, today's set chips (target = current rep step), the `Lower for 3 s` cue, and the Shoulder row. No progress or rule text.
14. Pull-aparts appear as the first item in the first card's Warm-up row (also when there are no barbell warm-ups) and never affect progression. No separate prep or accessories card exists on the workout page.
15. Accessories appear inside the last lift card only after that lift's last work set is tapped. If the last lift is skipped, they move to the previous card. Untouched accessories are included in the Finish prompt.
16. Accessory progression: side-lying ER 3 lb at 3 × 10 → 3 × 12 → 3 × 15 → 5 lb at 3 × 10, each step only when completed and the session's worst shoulder rating is green. Amber anywhere that session → hold. Red → drop back one weight.
17. Once both Bench and OHP return to the barbell, accessories switch to 2 sets at their current weight and rep step. Top of ladder + clean → stays, with the "add a heavier dumbbell" alert shown once.
