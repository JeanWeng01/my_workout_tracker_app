/** Plain-language summary of the program rules, so the app's suggestions make sense later. */
export function AboutRules() {
  return (
    <div className="rules">
      <h3>The big idea</h3>
      <p>The app tells you what to lift from what you actually lifted last time. Edit or delete any past workout and every future suggestion updates. Past workouts are never recalculated when you change a setting.</p>

      <h3>Phase 1: linear progression</h3>
      <p>Workouts alternate A, B, A, B no matter which day it is. Skipping a day changes nothing. Squat, bench, row and overhead press go up 5 lb after a completed session. Deadlift goes up 10 lb until the first session where you miss reps, then 5 lb.</p>
      <p><b>Completed</b> means every planned work set hit its target reps, judged lift by lift. <b>Missed reps</b> means you did the lift but fell short. There is no skipping a lift: a workout is done in whole or not at all.</p>
      <p>Miss reps three sessions in a row at the same weight and it&apos;s a stall. The ladder is: dial down 10% and climb back, twice. A third stall switches 5×5 to 3×5 at the same weight. A third stall at 3×5 means linear progression is done for that lift, and it holds steady, deloading 10% on later stalls. Deadlift is 1×5 and skips the 3×5 step. Rows follow the ladder but never decide when you move on.</p>
      <p>When squat finishes linear progression, the whole program moves to 5/3/1. Squat is trained every session at full volume, so it carries most of the recovery cost. When squat can no longer go up session to session, the program has outgrown linear progression.</p>

      <h3>Phase 2: 5/3/1</h3>
      <p>Your training max (TM) is about 85% of your best estimated one-rep max from recent sessions. Each lift runs a three-week wave: week 1 is 65/75/85% for 5, week 2 is 70/80/90% for 3, week 3 is 75/85/95% for 5/3/1. The last set of each week is AMRAP: as many good reps as you can.</p>
      <p>After week 3, if all three AMRAP sets hit their minimums, the TM goes up 10 lb (squat, deadlift) or 5 lb (bench, overhead press), never more, however many reps you got. If one fell short, the TM holds and you repeat the cycle. Two short cycles in a row suggest a 10% reset.</p>
      <p>After two cycles comes the 7th week. It alternates: a deload, then a TM test, then a deload. In the TM test, 3 or more reps at 100% means your max is honest. Fewer suggests a lower TM. You can swap a 7th week for another type, and a swapped-out test moves to the next block.</p>
      <p>Extra work after the main sets: none, FSL (5×5 at the week&apos;s first-set weight) or BBB (5×10 at half your TM). Switch whenever life gets busy. It applies from your next workout.</p>

      <h3>Warm-ups, plates, breaks</h3>
      <p>Warm-ups are suggestions only and never affect whether a lift counts as completed. Plates per side use only the plates you own. After more than 14 days away from a lift, the app suggests a lighter start (10% for 15 to 28 days, 20% beyond that). You can accept or keep your numbers.</p>

      <h3>Unfinished workouts</h3>
      <p>If you can&apos;t finish a workout, leave it unfinished. That date shows yellow on the calendar, nothing from it counts, and next time you redo the same workout from the start. A workout you leave open and don&apos;t finish within 12 hours resets the same way.</p>

      <h3>Shoulder rehab</h3>
      <p>While your shoulder recovers, Bench and Overhead Press are replaced by neutral-grip dumbbell versions: DB floor press and seated DB overhead press. They have their own history, and your barbell history is left alone. Each lift sits on one of three tracks: shoulder rehab, barbell linear, or 5/3/1, and you can move any lift between them in Settings.</p>
      <p>Rehab sets use reps before weight: 3 × 10, then 3 × 12, then 3 × 15 at the same dumbbells, then the next weight up at 3 × 10. A step happens only after a completed session with a green shoulder rating. Missed reps, an amber rating or no rating just hold: nothing counts as a stall and nothing is ever deloaded automatically. Dumbbell weights are per hand, and the ladders are yours to edit in Settings.</p>
      <p>Pace check: each weight takes at least 3 sessions of that exercise, and each press comes up every other workout. At 3 workouts a week the floor press ladder takes about 10 weeks at the fastest, and longer whenever you hold.</p>
      <p>When you reach the top weight at 3 × 15 with a green shoulder, the app asks whether you want to return to the barbell at a light weight. It never switches by itself, because this is an injury decision. &quot;Not yet&quot; asks again after 3 more sessions.</p>

      <h3>Shoulder check</h3>
      <p>Rate your shoulder 0 to 10 once per tracked lift per session. 0 to 2 is green (OK), 3 to 4 is amber (Caution) and 5 or more, or anything sharp or pinching, is red (Stop). You can change those cut-offs in Settings.</p>
      <p>On a barbell lift, amber holds the weight and doesn&apos;t count as a miss; red suggests dropping 10%. Red twice in a row suggests pausing the lift and getting it assessed. In 5/3/1, a red session in a cycle holds that lift&apos;s training max.</p>

      <h3>Shoulder warm-up and accessories</h3>
      <p>Band pull-aparts sit first in the first card&apos;s Warm-up row. Two shoulder exercises, side-lying external rotation and scaption, appear inside the last card once its main work is done. Each moves up the same way as the rehab presses, gated by your worst shoulder rating that session. Once both Bench and OHP are back on the barbell, they drop to 2 sets for maintenance.</p>
    </div>
  );
}
