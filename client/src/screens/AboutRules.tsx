/** Plain-language summary of the program rules, so the app's suggestions make sense later. */
export function AboutRules() {
  return (
    <div className="rules">
      <h3>The big idea</h3>
      <p>The app tells you what to lift from what you actually lifted last time. Edit or delete any past workout and every future suggestion updates. Past workouts are never recalculated when you change a setting.</p>

      <h3>Phase 1: linear progression</h3>
      <p>Workouts alternate A, B, A, B no matter which day it is. Skipping a day changes nothing. Squat, bench, row and overhead press go up 5 lb after a completed session. Deadlift goes up 10 lb until the first session where you miss reps, then 5 lb.</p>
      <p><b>Completed</b> means every planned work set hit its target reps, judged lift by lift. <b>Missed reps</b> means you did the lift but fell short. <b>Skipped</b> means you didn&apos;t do it, and that never counts against you.</p>
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
      <p>If you can&apos;t finish a workout, leave it unfinished. That date shows yellow on the calendar, nothing from it counts, and next time you redo the same workout from the start.</p>
    </div>
  );
}
