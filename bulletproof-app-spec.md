# Bulletproof: personal strength-training tracker (build spec for Claude Code)

## 0. Read this first, Claude Code

- This is a personal app for one lifter (me), used on my Samsung Android phone. Single user, no sign-up flow, no analytics.
- The **program rules in section 4 are the heart of the app**. Implement them exactly. If a rule is ambiguous or seems wrong, **ask me before changing it**. Don't "improve" the training logic silently.
- Build in the phases listed in section 12. Write the progression engine as **pure TypeScript with unit tests first**, before any UI touches it.
- **Database safety:** my Railway Postgres instance is already used by another project. Everything this app creates lives in its own schema, `bulletproof`. **Never create, alter, or drop anything outside that schema**, and show me each migration before running it against Railway.
- Keep the UI minimal. When in doubt, leave it out and list it in section 13 instead.

---

## 1. What the app does

1. Tells me what to lift today: sets × reps × weight for each main lift, based on what I **actually** lifted last time.
2. Lets me log a workout with single taps, and edit weights and reps when reality differs from the plan.
3. Runs two programs in sequence:
   - **Phase 1, linear progression:** StrongLifts 5×5, stepping down to 3×5 as lifts stall.
   - **Phase 2, Wendler 5/3/1:** training-max based waves with the 7th Week Protocol.
4. Detects plateaus and **suggests** (never forces) "retry", "dial down", "switch to 3×5", "reset training max", and "you're ready for 5/3/1".
5. Syncs all data to my Railway Postgres as a backup, and exports full history as CSV.

---

## 2. Platform and stack

**Local-first installable web app (PWA) + a small API server, deployed as one Railway service, backed by my existing Railway Postgres.**

Why local-first: gym signal is unreliable, and every tap must respond instantly. The phone's IndexedDB is the working copy; Postgres is the durable backup and lets me restore onto a new phone.

**Client** (`/client`):
- Vite + React + TypeScript
- IndexedDB via **Dexie**. Call `navigator.storage.persist()` on first launch.
- `vite-plugin-pwa`: manifest + service worker, offline-first, precache all static assets including fonts. **Never cache `/api/*` responses.**
- Fonts self-hosted via `@fontsource` (no network fonts).
- **Vitest** for engine tests.

**Server** (`/server`):
- Node 20+ with **Fastify** (or Hono), TypeScript, `pg` driver.
- Serves the built client as static files **and** the `/api` routes from the same origin (no CORS needed).
- Plain SQL migration files + a tiny runner, scoped to the `bulletproof` schema.
- The server is dumb storage. **All training logic runs on the client.** The server never computes suggestions.

**Railway deployment:**
- One service deployed from the GitHub repo. Build command builds client and server; start command runs the server.
- Environment variables:
  - `DATABASE_URL`: reference the existing Postgres service's variable, using the private network URL.
  - `SYNC_TOKEN`: a long random secret I generate.
  - `PORT`: provided by Railway; the server must listen on it.
- Health check at `GET /api/health`.
- Write `DEPLOY.md` (Railway setup steps) and `INSTALL.md` (open the Railway URL in Chrome or Samsung Internet → "Add to Home screen" / "Install app" → enter sync token once in Settings).

**Notifications:** in-app alerts only (banners on lift cards and the home screen). No push or scheduled notifications.

---

## 3. Architecture

### 3.1 Event-sourced state (important)

Never store "current weight" as mutable truth. Store **what happened**, and derive the current state by replaying it. Then editing or deleting a past workout automatically fixes every future suggestion.

```
settings     – single record (section 4.1)
sessions     – logged workouts, each with its sets
decisions    – my responses to alerts + manual overrides + phase switches,
               each with a timestamp and the sessionId it applies after
```

Every record has: `id` (UUID, generated on the client), `updatedAt` (ISO timestamp), `deleted` (boolean tombstone; never hard-delete, so deletions sync).

Core pure functions (in `client/src/engine/`, no DOM, no Dexie imports):

```ts
deriveState(settings, sessions, decisions): ProgramState
planNextSession(state, settings): SessionPlan
evaluateSession(state, loggedSession): Alert[]
estimate1RM(weight, reps): number                     // Epley: w × (1 + reps/30), reps 1–10 only
roundToPlates(weight, settings, lift, mode: 'nearest'|'down'): number
platesPerSide(weight, barWeight, platesOwned): number[]
```

Replaying a few hundred sessions is trivially fast. Don't optimize.

**History is never recalculated.** Past sessions keep the weights and reps actually logged. Each finished session also stores a snapshot of the rules it was played under (microplates, retries, deload %, TM %, bar weights), and an accepted alert stores the exact weight it proposed. Changing a setting later only affects sessions logged afterwards, never earlier results.

### 3.2 Local persistence

- **Autosave on every tap.** A workout in progress is a draft session in IndexedDB. Closing the app mid-workout loses nothing, and reopening resumes the draft.
- A session counts toward progression only after I tap **Finish workout**.
- Drafts are not synced; finished sessions are.

### 3.3 Sync with Railway Postgres

**Postgres schema `bulletproof`:**

```sql
settings  (id text pk, data jsonb not null, updated_at timestamptz not null, synced_at timestamptz not null default now())
sessions  (id uuid pk, data jsonb not null, updated_at timestamptz not null, deleted boolean not null default false, synced_at timestamptz not null default now())
decisions (id uuid pk, data jsonb not null, updated_at timestamptz not null, deleted boolean not null default false, synced_at timestamptz not null default now())
-- Two deliberate deviations from the first draft of this spec:
--  * settings.id is text: the client keeps one settings record under a fixed id, not a uuid.
--  * synced_at (server arrival time) is the pull cursor, not updated_at. updated_at is the client's clock and
--    decides last-write-wins; but a record edited offline hours ago must still reach a phone that pulled in
--    between, and only the arrival time can guarantee that.
```

Records are stored as JSONB documents exactly as the client holds them (plus a `schemaVersion` inside `data`).

**API** (all except health require `Authorization: Bearer <SYNC_TOKEN>`; compare in constant time; return 401 otherwise):

- `GET /api/health` → `{ ok: true }`
- `GET /api/sync?since=<ISO>` → all records with `updated_at > since` (including tombstones).
- `POST /api/sync` with `{ settings?, sessions: [], decisions: [] }` → upsert each record **only if** the incoming `updatedAt` is newer than the stored one (last-write-wins per record). Returns the server time to use as the next `since`.

**Client sync behaviour:**
- Records changed locally get a `dirty` flag.
- Sync runs on app open, after **Finish workout**, after any history edit, and from a **Sync now** button.
- Order: push dirty records, then pull changes since the last successful sync, then re-derive state if anything came in.
- Offline or failed sync is silent apart from the status line. Dirty records simply wait for the next attempt.
- **Status line** in Settings and in small text on Home: "Synced 2 min ago" / "Not synced: offline" / "Sync token missing".
- **Restore onto a new phone:** enter the sync token → full pull → done.

---

## 4. Program rules

### 4.1 Settings (all editable in Settings; defaults shown)

| Setting | Default | Notes |
|---|---|---|
| Unit | lb | lb only in v1 |
| Bar weight | 45 per lift | Per-lift override (e.g., lighter bar for OHP early on) |
| Plates owned | 45, 35, 25, 10, 5, 2.5 | |
| I own 1.25 lb microplates | **Off** | See microplate rule below |
| Retries before deload | 3 | "Miss reps N sessions in a row at the same weight → deload" |
| Deload amount (linear) | 10% | |
| Linear layout | `stronglifts` | Alternative: `deadlift_every_session` (see 4.2) |
| Training max % | 85% | Allowed 80–90% |
| 5/3/1 lifts per session | 1 | Alternative: 2 (see 4.4) |
| 5/3/1 template | FSL | Minimalist / FSL / BBB |
| BBB percentage | 50% of TM | |
| 7th week deload style | Forever deload | Alternative: Light deload (see 4.4) |

**Microplate rule:** while "I own 1.25 lb microplates" is off, **nothing about 1.25 plates or 2.5 lb jumps appears anywhere outside that one Settings toggle**. That means no plate breakdowns with 1.25, no "+2.5" suggestions or alerts, and no hints about buying them. The rounding increment is 5 lb. When the toggle is on, the rounding increment becomes 2.5 lb, 1.25 joins the plates list, and the microplate rules in 4.2 activate from the next session.

### 4.2 Phase 1: Linear progression

**Workouts alternate A, B, A, B…** regardless of calendar day. There is no calendar logic: a day without a workout changes nothing, and the app just shows the next workout.

Layout `stronglifts` (default):

| Workout A | Workout B |
|---|---|
| Squat 5×5 | Squat 5×5 |
| Bench Press 5×5 | Overhead Press 5×5 |
| Barbell Row 5×5 | Deadlift 1×5 |

Layout `deadlift_every_session` (selectable, not recommended):

| Workout A | Workout B |
|---|---|
| Squat 5×5 | Squat 5×5 |
| Bench Press 5×5 | Overhead Press 5×5 |
| Deadlift 1×5 | Deadlift 1×5 |

**Starting weights:** entered at onboarding, prefilled as below. Onboarding hint text: "Pick a weight you could lift for 10–12 clean reps. You'll only do 5."

Under the Barbell Row field, add a second hint: "New to rows? Start with the empty bar and add weight only once 5 reps feel smooth." (An empty bar sits on the floor, so I'll row from safety pins or blocks set at mid-shin, or from a hang. The app doesn't need to know which.)

| Lift | Prefill |
|---|---|
| Squat | 65 |
| Bench Press | 45 (empty bar) |
| Barbell Row | 45 (empty bar; I've never rowed before) |
| Overhead Press | 45 (empty bar; lighter bar allowed via per-lift bar weight) |
| Deadlift | 95 |

**Increments after a successful session:**
- Squat, Bench, OHP, Row: +5 lb
- Deadlift: +10 lb **until its first session with missed reps**, then +5 lb permanently.
- *Microplates on only:* after a lift's first deload, Bench and OHP increments become +2.5 lb.

**Terminology (use these words consistently in code and UI copy):**
- **Completed:** every planned work set for that lift reached its target reps. Evaluated **per lift**, not per workout: squat can be completed while bench has missed reps in the same session.
- **Missed reps:** the lift was performed, but at least one work set came up short of target reps.
- **Skipped:** the lift wasn't performed (I tapped "Skip lift", or skipped it at Finish). **Skipped never counts toward a stall** and doesn't change state.
- A **workout that didn't happen** isn't recorded and has no effect on progression (but see 4.7 for long breaks).
- **Working weight:** the lowest weight among that lift's logged work sets.

**Next suggestion is always based on what I actually lifted:**
- Completed at weight W → next = W + increment (even if W differed from the suggestion).
- Missed reps at W → next = W (retry).
- The missed-reps streak increments only when consecutive missed-reps sessions happen at the **same** working weight. Missed reps at a different weight resets the streak to 1. A completed session resets it to 0.

**Per-lift scheme ladder:**

```
5×5 ──stall──► deload ──stall──► deload ──stall──► switch to 3×5 (same weight)
3×5 ──stall──► deload ──stall──► deload ──stall──► LINEAR COMPLETE
Deadlift 1×5 ──stall──► deload ──stall──► deload ──stall──► LINEAR COMPLETE
```

- *Stall* = missed reps in `retriesBeforeDeload` (3) consecutive sessions at the same working weight.
- *Deload* = new weight = `roundToPlates(W × 0.90, 'down')`, never below bar weight.
- Rows follow the 5×5 → 3×5 ladder but **don't count toward graduation** and are dropped in 5/3/1.
- **Holding pattern:** a lift that is LINEAR COMPLETE while the program hasn't switched yet keeps going. On each further stall it deloads 10% and climbs again at the smallest increment. Its card shows "Holding until squat finishes linear progression".

**Graduation (automatic):**
- Trigger **only** when **Squat** becomes LINEAR COMPLETE. Other lifts reaching LINEAR COMPLETE never trigger it; they stay in the holding pattern.
- Rationale (for "About the rules"): squat is trained every session at full volume, so it carries most of the program's recovery cost. When squat can no longer progress session to session, the program as a whole has outgrown linear progression, even if another lift could still inch forward.
- When I tap **Finish workout** on the session that makes squat LINEAR COMPLETE, the app **switches the whole program to 5/3/1 automatically**. No Accept button and no manual step:
  1. Training maxes are calculated per 4.3 from the sessions logged so far (including the one just finished).
  2. A `phase_switch` decision is saved automatically, effective from the next session.
  3. A **congratulations screen** appears right after Finish (see 6.6).
  4. The next session on Home is 5/3/1, starting with Squat, block 1, cycle 1, week 1 for all four lifts. Rows disappear from the program.
- I can still switch phases manually anytime from Settings, in either direction (including undoing the automatic switch).

### 4.3 Transition: calculating training maxes

For each of Squat, Bench, Deadlift, OHP:
1. Look at that lift's last 6 finished sessions where it wasn't skipped.
2. For every work set, compute `estimate1RM(weight, repsDone)` (only sets with 1–10 reps).
3. e1RM = the highest value. TM = `roundToPlates(e1RM × tmPercent, 'down')`.
4. When the switch is automatic (4.2), these TMs take effect immediately. They're shown on the congratulations screen, with an optional "Adjust" link to edit any of them. When I switch manually from Settings, show the same TMs on a review screen before switching.

Example: best set 180 × 5 → e1RM 210 → TM at 85% = 178.5 → **175**.

### 4.4 Phase 2: Wendler 5/3/1

**Session structure:**
- `liftsPerSession = 1` (default): each session trains one main lift, rotating **Squat → Bench → Deadlift → OHP → Squat…**
- **No skipping a main lift in 5/3/1** (no Skip lift button in this phase). The only alternative to finishing is leaving the whole workout unfinished (see 6.2). Rotation continues after the last lift actually performed, so an unfinished workout simply comes up again.
- `liftsPerSession = 2`: sessions alternate **A: Squat + Bench**, **B: Deadlift + OHP**.

**Each lift tracks its own position in the wave**, advancing one step each time that lift is trained. Missed calendar days never break anything.

**Block structure per lift:** Cycle 1 (weeks 1–3) → Cycle 2 (weeks 1–3) → 7th Week Protocol → next block. The 7th week **alternates**:
- **Odd blocks (1st, 3rd, 5th…): deload week**, in the style set in Settings (default Forever deload).
- **Even blocks (2nd, 4th…): TM test week.**

**Main sets** (% of training max; last set is AMRAP, "as many reps as possible with good form"):

| Wave week | Set 1 | Set 2 | Set 3 (AMRAP) | Minimum reps on set 3 |
|---|---|---|---|---|
| 1 ("5s") | 65% × 5 | 75% × 5 | 85% × 5+ | 5 |
| 2 ("3s") | 70% × 3 | 80% × 3 | 90% × 3+ | 3 |
| 3 ("5/3/1") | 75% × 5 | 85% × 3 | 95% × 1+ | 1 |

**Supplemental work** (after main sets; never on 7th week):
- **Minimalist:** none.
- **FSL (First Set Last):** 5 × 5 at that week's Set 1 weight.
- **BBB (Boring But Big):** 5 × 10 at `bbbPercent` of TM.

Template is switchable anytime from the workout screen ("Life mode") and from Settings. The switch applies from the next session.

**7th Week Protocol sets** (main sets only):

| Type | Sets |
|---|---|
| Forever deload (default deload style) | 70% × 5, 80% × 3–5 (target 3), 90% × 1, 100% × 1 |
| Light deload (alternative deload style) | 40% × 5, 50% × 5, 60% × 5 |
| TM test | 70% × 5, 80% × 5, 90% × 5, 100% × 3–5 (target 3, stop at 5) |

When a lift reaches a 7th week, its card shows which type is scheduled, with a small "Change" link offering the other two (e.g., swap a TM test for a Light deload on a week my joints ache). The override is saved as a decision. If a TM test is swapped out, the next block's 7th week becomes the TM test instead.

**Training max progression** (evaluated when a lift finishes wave week 3):
- All three AMRAP sets in the cycle hit their minimums → TM += **10 lb (Squat, Deadlift)** or **5 lb (Bench, OHP)**.
- **Never increase TM by more than that, no matter how many AMRAP reps I got.**
- Any AMRAP set below minimum → **hold TM** (retry the cycle at the same TM) and increment `missedCycles`.
- `missedCycles` reaches 2 consecutive → suggest reset: TM × 0.90, rounded down.
- A successful cycle resets `missedCycles` to 0.

**TM test result:**
- ≥ 3 reps at 100% TM → pass. Show "Your training max is honest."
- < 3 reps → suggest new TM = `roundToPlates(estimate1RM(TM, reps) × tmPercent, 'down')`.

**PRs:** On every AMRAP set, compute e1RM. If it beats that lift's best-ever e1RM, or beats my best reps at that exact weight, show a small "PR" badge on the set.

### 4.5 Warm-up sets (shown collapsed inside each expanded lift, optional to tap)

- **Linear phase:** if working weight ≤ bar: none. Otherwise bar × 5, then 55% × 3, then 75% × 2 of working weight, rounded nearest. Skip any warm-up ≤ bar or duplicating a previous one.
- **5/3/1 phase:** 40% × 5, 50% × 5, 60% × 3 of TM, rounded nearest. Skip any below bar.
- Warm-ups never affect completed / missed-reps status.

### 4.6 Rounding and plates

- All computed weights round to the rounding increment (5 lb, or 2.5 lb with microplates on). Use `'down'` for deloads, resets and TMs, and `'nearest'` for everything else (ties go down).
- Never suggest less than the bar weight. If a percentage computes below the bar, show the bar weight with the note "empty bar".
- Under every weight, show plates per side in small text, e.g. "per side: 45 + 10 + 2.5", using only plates owned.

### 4.7 Returning from a break

When a lift hasn't been trained in > 14 days, show an alert on its card. It suggests −10% (15–28 days) or −20% (> 28 days) on its working weight or TM, with Accept / Keep.

Settings also has **"Restart linear phase"**, for example after a pregnancy or long layoff. It asks for new starting weights (prefilled with 60% of my last working weights, rounded down) and keeps all history.

---

## 5. Alerts

Alerts appear as a banner **inside the relevant lift card** (and are summarized on the home screen). Every actionable alert has two buttons, **Accept** and **Try again next workout**, and my choice is saved as a `decision`. **Accept** → the next workout starts at the suggested weight. **Try again next workout** → the next workout repeats exactly the weights I just lifted (the alert returns if I miss again). Neither choice changes the past. Use plain, direct copy. Examples:

| Trigger | Copy |
|---|---|
| 1st or 2nd missed-reps session at a weight | "Missed reps at 150. Next time: retry 150 (attempt 2 of 3)." (info only, no buttons) |
| Stall → deload | "Third miss at 150. Dial down to 135 and climb back." |
| Stall → 3×5 | "Third stall on 5×5. Switch squat to 3×5 at 150?" |
| Linear complete (Bench, Deadlift, OHP, Row) | "Bench has hit the same wall twice. Linear progression is done for this lift. It'll hold steady until squat is done too." (For squat, the congratulations screen replaces this.) |
| Graduation | No alert. The automatic switch and congratulations screen replace it (4.2, 6.6). |
| 5/3/1 missed minimum | "Bench 3+ set: got 2. Hold your training max and repeat this cycle." |
| 5/3/1 reset | "Two cycles in a row short of minimums. Reset bench training max 130 → 115?" |
| TM test failed | "2 reps at your training max. Lower it to 160 so it stays honest?" |
| Break | "18 days since your last deadlift. Start at 205 instead of 225?" |

---

## 6. Screens and UI

### 6.1 Home

```
┌──────────────────────────────┐   whole screen is violet (lavender)
│                         [📅] │
│     EGO LIFTS (wide font)    │
│     ARE FOR IDIOTS           │
│                              │
│     ┌──────────────────┐     │   pale central bubble, generous side margins
│     │   Workout A      │     │   title = just the workout name
│     │ Squat 5×5     65 │     │
│     │ Bench 5×5     45 │     │
│     │ [ Start workout ]│     │
│     └──────────────────┘     │
│                              │
│  Phase: Linear   Settings    │   pinned to the bottom
│  Synced 2 min ago (tiny)     │   very small line at the very bottom
└──────────────────────────────┘
```

- **Top mantra (home and every workout page):** the text `Ego lifts are for idiots`, wrapping to **three centered lines** (`Ego lifts` / `are for` / `idiots`), set in a **wide, heavy** face (Archivo at its widest, low height-to-width ratio). It is the most prominent element on the screen and sits directly on the violet background (no separate header band).
- **Violet everywhere.** The whole app background is `lavender`; content lives in pale (`mist`) bubbles/cards on top of it. On Home, one narrow bubble sits in the vertical middle with generous side margins and holds the workout preview and the button; alerts go inside it under the button.
- **No "Next:" label.** The bubble title is simply the upcoming workout ("Workout A", "Workout B", or the 5/3/1 lift and week).
- **Export lives inside Settings**, not on Home.
- The footer (phase, Settings, sync status) is pinned to the bottom of the screen; the sync status is a very small line (~13 px, a deliberate exception to the 16 px minimum).
- If a draft session exists, the button reads **Resume workout**.
- **Calendar icon** in the top-right corner of Home (see 6.3): an outline calendar icon in `iron`, about 28 px, inside a 48 px tap target, with accessible label "Workout calendar". Home only; not on the workout page.

### 6.2 Workout page

- **Top:** the same mantra, same treatment.
- **Header:** workout name ("Workout B" or "5/3/1 · Squat · Week 2 of cycle 1") and date.
- **Lift cards, collapsed by default.** One line each: lift name, scheme, weight (big), plus an alert dot if there's an alert.
- **Tap a card to expand it.** Inside:
  - Alert banner (if any).
  - "Warm-up" row (collapsed, lighter style).
  - **Working weight**, large. Tap it to edit with a ± stepper using the rounding increment, or type a value. Editing it updates all not-yet-done work sets.
  - Plates per side, small.
  - **Set chips** in a row, each ≥ 56 px. An empty chip shows target reps.
    - **Tap once** = done at target reps (chip fills).
    - **Tap again** = reps − 1 (5 → 4 → 3 → 2 → 1 → 0), then back to empty.
    - **Long-press** = edit that single set's weight and reps.
    - **AMRAP chip:** tap opens a big number picker defaulting to the minimum reps.
  - **Each set has a complete button** under its chip: a green-circle-with-a-check icon (48 px target). Grey when the set isn't done; tap → it turns green, the set is logged at target reps, and the rest timer starts. Tap again to undo. Once done, tapping the chip steps reps down (5 → 4 → … → 0 → back to target).
  - **Warm-up sets** (4.5) are listed under a collapsed "Warm-up (N sets)" row, each with suggested weight × reps and its own complete button. Completing one starts the rest timer too.
  - **Rest timer:** a silent countdown bar pinned to the bottom of the screen, started by any complete tap. Wall-clock based (survives a locked screen). No buttons, no sound, no vibration: it only counts down, reads "Ready" at zero, and hides itself a few seconds later. Default rests: warm-up 60 s, work sets 180 s, supplemental 90 s (editable in Settings, phase 5).
  - Supplemental sets (FSL/BBB) as a second, slightly smaller chip row.
  - "Skip lift" text button (**linear phase only**).
- **Unfinished workouts.** A "Can't finish today" link under Finish workout leaves the workout unfinished (confirm first). If anything was logged, that date becomes a **yellow** day on the calendar; partial sets are kept on the record but never count toward progression, the CSV or the total. If nothing was logged, it just disappears. The next time I start, the same workout is planned again and I **redo it from the start** (a fresh workout, not a resume). When that redo is finished, its date is **green**; the old yellow day stays yellow. Closing the app without exiting resumes the workout, but a draft untouched for 12+ hours becomes unfinished automatically on next open. Home shows "Last workout was left unfinished. Starting it over from the top."
- **Finish workout** button at the bottom. If any work sets are untouched, ask: "Count untouched sets as missed reps, or skip those lifts?"
- **Bottom of every workout page, smaller:** `My muscles are A-OK, but I invest in bulletproof joints.`
- Haptic tick on set completion (`navigator.vibrate(10)` where supported).

### 6.3 Calendar (replaces a separate History screen)

- Tapping the calendar icon **expands a panel** directly under the top of Home, pushing the rest of the content down. Tapping the icon again (or a close control) collapses it.
- **Month grid** of the current month, with previous/next month arrows (swiping left/right also works). Week starts on the phone's locale default.
- **Days with a finished workout** are a **green circle** with a check; **days with a workout started but never finished** are a **yellow circle** with a dash. Green wins if a date has both. Colour is never the only signal (check vs dash, plus the accessible label "October 6, 1 workout" / "October 3, workout unfinished"). Original wording for finished days: filled `lavender` with a small `iron` dot; today has an `iron` outline. Fill is never the only signal: workout days also carry the dot, and each day cell has an accessible label like "October 6, 1 workout".
- **Tap a workout day** → opens that session in the same layout as the workout page, editable. If a day has more than one session, show a small list of them first.
- Tapping a day with no workout does nothing.
- **Directly beneath the calendar:** `Total workouts: X` in medium type (~20 px, weight 600, `ink`). X = all-time count of finished, non-deleted sessions.
- **No planned schedule.** The calendar only shows what I logged, on the day I logged it (the session's local date).
- Inside an opened past session: edit sets, or delete the session (asks for confirmation; soft delete). Edits trigger a state re-derive and a sync.
- First launch with no workouts: the panel shows the empty month and `Total workouts: 0`.

### 6.4 Settings

All settings from 4.1, plus: sync token entry, sync status + **Sync now**, manual phase switch (either direction), Restart linear phase, Export CSV, Download backup (JSON), Restore from backup (JSON), and "About the rules". "About the rules" is a plain-language summary of section 4 so I can remember why the app suggests what it does.

### 6.5 Onboarding (first launch only)

Two paths:
- **New start:** starting weights (prefilled per 4.2) → plates owned → sync token (optional, can skip) → done.
- **Restore:** enter sync token → full pull from server → done.

### 6.6 Congratulations screen (automatic 5/3/1 switch)

Shown once, right after Finish workout on the session that triggers graduation. Full screen, same mantra at the top. Plain, warm copy, for example:

> **Linear progression complete.**
> You've hit your first real strength wall, which means you're no longer a beginner. Starting next session, you're on 5/3/1.
>
> Your training maxes:
> Squat 175 · Bench 105 · Deadlift 215 · OHP 70
>
> [ Adjust training maxes ] (small text link)
> [ Done ] (primary button)

- "Adjust training maxes" opens the TMs as editable fields; changes are saved as decisions.
- "Done" returns to Home, which now shows the first 5/3/1 session.
- One orchestrated moment of motion is fine here (respect `prefers-reduced-motion`). No confetti clutter.

---

## 7. Visual design

### 7.1 Color tokens

Built around **#DBCEFF**. Every text/background pair must meet WCAG AA (≥ 4.5:1). Aim for AAA (≥ 7:1) on all primary text.

| Token | Hex | Use |
|---|---|---|
| `lavender` | #DBCEFF | Page background |
| `mist` | #F5F1FF | Cards and bubbles (the page background is `lavender`) |
| `ink` | #1E1433 | Primary text (≈ 11.7:1 on lavender) |
| `iron` | #3D2A7A | Buttons, completed set chips (white text ≈ 11.6:1; as text on lavender ≈ 7.9:1) |
| `ink-soft` | #4A3F66 | Secondary text (≈ 8.6:1 on mist, ≈ 6.5:1 on lavender) |
| `caution-bg` / `caution-ink` | #FFF1D6 / #8A4B00 | Alert banners (≈ 6:1) |

- Colour is never the only signal. Completed chips also show a check, missed sets show the actual number, and alerts have an icon.
- Respect `prefers-reduced-motion`. A dark theme is out of scope for v1.

### 7.2 Typography

- One family with real width range, e.g. **Archivo** (variable, self-hosted).
- **Mantra:** Archivo at its **widest** setting (wdth 125), ExtraBold, 36 px, uppercase, low height-to-width ratio. This is the one bold design moment; everything else stays quiet.
- **Weights:** 32–40 px, bold, tabular numerals.
- **Body and labels:** minimum 18 px, weight ≥ 500. Nothing on screen smaller than 16 px.
- **Bottom mantra:** 16–18 px, medium weight, `ink-soft`.
- Touch targets ≥ 48 px. Content left-aligned except the mantra (centered).

---

## 8. Export and backup

### 8.1 CSV (Export button)

- Generated **on the client** from local data (works offline).
- One row **per set**, finished sessions only, UTF-8 with BOM (so it opens cleanly in Excel/Sheets), RFC 4180 quoting.
- Filename: `bulletproof_export_YYYY-MM-DD.csv`.
- Delivery: use the Web Share API with a file (share to Drive, Gmail, etc.) when available; otherwise trigger a download.

Columns:

```
date, session_id, session_label, program_phase, lift, scheme,
set_number, set_type, target_weight_lb, target_reps,
actual_weight_lb, actual_reps, completed, is_amrap,
training_max_lb, cycle, wave_week, e1rm_lb, notes
```

- `program_phase`: `linear` | `531`
- `scheme`: `5x5` | `3x5` | `1x5` | `531` | `7th_tm_test` | `7th_deload_forever` | `7th_deload_light`
- `set_type`: `warmup` | `work` | `amrap` | `supplemental`
- Warm-ups are included only if I tapped them.

### 8.2 JSON backup and restore

Postgres sync is the primary backup. In addition, Settings offers a full JSON dump (settings, sessions, decisions, schema version) as a downloadable file, and a restore that asks before overwriting and validates before writing anything.

---

## 9. Edge cases to handle

- Lift logged with fewer or more sets than planned → evaluate only planned work sets. Extra sets are logged, not evaluated.
- Working weight edited **above** the suggestion and completed → next suggestion builds from the actual weight (rule 4.2).
- Percentages below the bar (e.g., early OHP deload) → bar weight with an "empty bar" note.
- Editing or deleting an old session → re-derive state. If this changes today's plan, show "Plan updated from your history edit".
- Switching layout or template mid-phase → applies from the next session, and history is untouched.
- Turning microplates on or off mid-phase → affects rounding and increments from the next session only.
- Two sessions on the same day → allowed.
- Sync conflict (same record edited on two devices) → last-write-wins by `updatedAt`.
- First launch with no data → onboarding. The calendar shows an empty month and `Total workouts: 0`.
- The finished session that triggers graduation is later edited or deleted so squat is no longer LINEAR COMPLETE → re-derive. If the switch no longer holds and no 5/3/1 session has been logged yet, revert to linear and show "Plan updated from your history edit". If 5/3/1 sessions already exist, keep 5/3/1 and don't revert silently.

---

## 10. Engine tests (Vitest), required before UI work

Write scenario tests that feed sessions into `deriveState` / `planNextSession` and assert results. At minimum:

1. 5×5 completed: squat 65 → 70 → 75.
2. Missed reps (5,5,5,4,4) at 150 → retry 150. Streak counting 1 → 2 → 3, third → deload to 135.
3. Deadlift +10 until first missed-reps session, then +5 forever.
4. Two deloads, then a third stall on 5×5 → "switch to 3×5" alert; accepting keeps the same weight with scheme 3×5.
5. Third stall on 3×5 → LINEAR COMPLETE. Next stall → holding-pattern deload.
6. User edits weight up to 160 (suggested 155), completes → next is 165.
7. Skipped lift → no state change. A completed squat and a missed-reps bench in the same session are evaluated independently.
8. Missed reps at different weights don't accumulate a streak.
9. Graduation: the session that makes squat LINEAR COMPLETE auto-creates a `phase_switch` decision, and `planNextSession` returns 5/3/1 Squat week 1 with TMs per 4.3. Bench, Deadlift and OHP all LINEAR COMPLETE while squat isn't → no switch (all three in holding pattern). Manual switch back to linear works.
10. TM calc: 180 × 5 at 85% → 175. At 90% → 185.
11. 5/3/1 week 1 with TM 100 → 65 / 75 / 85. FSL 5×5 @ 65. BBB 5×10 @ 50.
12. Cycle passes → TM +10 (squat), +5 (bench), even with AMRAP 15 reps.
13. One AMRAP below minimum → TM held. Two consecutive held cycles → reset suggestion −10%.
14. TM test 2 reps at TM 180 → suggested 160 (e1RM 192 × 0.85 = 163.2 → down to 160).
15. 7th week alternation: block 1 → deload (Forever by default; Light when setting changed), block 2 → TM test, block 3 → deload. Swapping a TM test for a deload moves the TM test to the next block.
16. Microplates off: 132.4 nearest → 130, no 2.5 lb increments ever suggested. Microplates on: 132.4 nearest → 132.5, and Bench/OHP use +2.5 after their first deload.
17. Break of 20 days → −10% suggestion. 35 days → −20%.
18. Deleting a past session re-derives correctly.
19. Rotation with `liftsPerSession = 1` and `= 2` produces the correct lift order and per-lift wave weeks.

**Server tests:**

20. Requests without the correct token → 401; `/api/health` works without a token.
21. `POST /api/sync` is idempotent, and an older `updatedAt` never overwrites a newer record.
22. Tombstones round-trip: a deleted session pulled onto a fresh client is excluded from state.
23. Migrations touch only the `bulletproof` schema.

---

## 11. Railway checklist (for `DEPLOY.md`)

1. Create a new service in the existing Railway project from the GitHub repo.
2. Set `DATABASE_URL` by referencing the existing Postgres service's private URL variable.
3. Generate a long random `SYNC_TOKEN` and set it as a variable.
4. Run migrations (creates schema `bulletproof` and its three tables; nothing else).
5. Generate a public domain for the service; confirm `/api/health` responds.
6. On the phone: open the URL, install to home screen, enter the sync token in onboarding.

---

## 12. Build phases

1. **Scaffold:** monorepo (`/client`, `/server`), theme tokens, fonts, both mantras, static Home and Workout screens with fake data. Show me screenshots.
2. **Engine:** pure TS + all engine tests in section 10 passing.
3. **Logging:** Dexie schema, draft autosave, tap-to-log chips, Finish workout, next-session plan from engine.
4. **Alerts and decisions:** banners, Accept / Keep, automatic graduation + congratulations screen, 7th-week alternation and "Change" link, template switcher.
5. **Calendar, Settings, Export:** calendar panel + total count, CSV, JSON backup/restore, Restart linear phase.
6. **Server and sync:** Fastify server, migrations (shown to me before running on Railway), sync endpoints, client sync + status line, server tests.
7. **PWA and deploy:** manifest, icons (simple: plate shape in `iron` on `lavender`), offline caching, Railway deploy, `DEPLOY.md`, `INSTALL.md`.

**Definition of done:** installs on a Samsung phone from the home-screen prompt, logs a full workout in airplane mode and syncs it once back online, restores onto a cleared browser using only the sync token, CSV opens correctly in Google Sheets, nothing about microplates is visible while the setting is off, and all tests pass.

---

## 13. Out of scope for v1 (ideas for later)

Rest-timer sound or alerts (the silent countdown itself is in v1), progress charts, bodyweight log, kg support, dark theme, push/scheduled notifications, joker sets, other 5/3/1 templates (5s PRO, BBS, etc.), multi-user accounts, an "ego check" prompt when I manually raise a weight well above the suggestion.

---

## 14. References (the source of the rules)

- StrongLifts 5×5 quick start: https://stronglifts.com/stronglifts-5x5/workout-program/
- StrongLifts increments: https://stronglifts.com/stronglifts-5x5/progress/
- 5/3/1 glossary (7th Week Protocol, training max): https://liftvault.com/resources/531-glossary/
- 5/3/1 for Beginners notes (TM %, deload options): https://liftvault.com/programs/strength/531-for-beginners/
- Jim Wendler, *5/3/1* (2nd ed.), *Beyond 5/3/1*, *5/3/1 Forever*: the primary sources
