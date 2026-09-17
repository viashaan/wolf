// Wolf: the whole plan lives here. A private config.json in the data repo can be merged over it.
window.PLAN = {
  start: "2026-09-17",              // Day 1 (Austin)
  data: { owner: "viashaan", repo: "wolf-data" },

  // Daily habits. `core` names the ones the nightly message cares about most.
  // `days` = weekdays it applies (0 Sun .. 6 Sat); `from` = first plan day it applies.
  // `time` = the row records a clock time. `icon` = an authored SVG in app.js.
  habits: [
    { id: "wake",     label: "Up by 07:45",           icon: "sunrise",  time: true,  core: true, defaultTime: "07:45",
      why: "Two alarms, twenty minutes apart. Wake on the second." },
    { id: "sun",      label: "Sunlight",              icon: "sun",      core: true,
      why: "10 to 20 minutes outside within an hour of waking. Holds the whole clock." },
    { id: "water",    label: "Water first",           icon: "drop",
      why: "A big glass before anything else." },
    { id: "breakfast",label: "Breakfast",             icon: "egg",
      why: "You wake up hungry. Use it. Proper food, not a snack." },
    { id: "vits",     label: "Vitamins",              icon: "pill",
      why: "With breakfast." },
    { id: "coffee11", label: "No coffee before 11",   icon: "cup",
      why: "Cortisol has cycled by then, so it actually helps." },
    { id: "caff",     label: "Caffeine cutoff 14:00", icon: "cupoff",   core: true,
      why: "Anything after two degrades sleep even if you fall asleep fine." },
    { id: "nic",      label: "Nicotine cutoff 18:00", icon: "leafoff",
      why: "Roughly five hours clear of bed." },
    { id: "gym",      label: "Gym",                   icon: "dumbbell", days: [1, 3, 5], from: 5,
      why: "17:30 to 19:00, then dinner. Week one: two sets, four reps shy of failure." },
    { id: "phone",    label: "Phone out of the bedroom", icon: "phoneoff",
      why: "On charge outside the room by 22:30. The one that decides bedtime." },
    { id: "bed",      label: "Bed by 23:30",          icon: "moon",     time: true,  core: true, defaultTime: "23:30",
      why: "Room at 18 to 19C. Hot shower first." }
  ],

  // Streak: a night counts when you check in. Yesterday can still be closed until this hour today.
  graceUntilHour: 12,
  eveningFromHour: 20,
  // The day rolls over at 04:00, not midnight, so a late check-in belongs to the night it came from.
  dayRollHour: 4,
  // One missed night per seven is absorbed silently (a ring on the calendar), so a single slip never zeroes the streak.
  freezeEveryDays: 7,
  milestones: { 7: "One week. This is where most people fall off. You did not.", 14: "Two weeks. The clock is yours now.", 21: "Three weeks. It is a habit.", 30: "Thirty. The reset is done. Keep the wolf." },

  wolf:  { window: 7, prior: 0.5 },      // 7-day mean of daily completion; unseen days before day 1 count as 0.5
  brain: { window: 3, minutesForDead: 150 },

  // Wolf stage names, 1..10
  stages: ["Gone", "Down", "Rising", "Thin", "Normal", "Solid", "Strong", "Powerful", "Beast", "Apex"],
  brainStages: ["Puddle", "Melting", "Slumped", "Soft", "Normal", "Clear", "Sharp", "Lit", "Radiant", "God mode"],

  // Nightly message by completion. {missed} is the highest-priority habit you skipped.
  messages: {
    all:  ["All of it. Sleep well.", "Clean sweep. The wolf felt that.", "Every box. Now put the phone down."],
    most: ["Good day. Tomorrow: {missed}.", "Nearly. {missed} is the one to fix.", "Solid. {missed} tomorrow and it is a full day."],
    half: ["Half a day. Decent, but {missed} needs to happen.", "Middle of the road. Start with {missed}."],
    low:  ["That was shit. Sunlight first thing, then we go again.", "Rough one. Tomorrow starts at 07:45 with the sun."],
    comeback: ["Back. That is the whole game.", "One missed night is noise. Showing up again is the habit."]
  },
  missedPriority: ["bed", "sun", "caff", "wake", "nic", "gym", "phone", "coffee11", "breakfast", "water", "vits"]
};
