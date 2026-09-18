// Wolf: the whole plan lives here. A private config.json in the data repo can be merged over it.
window.PLAN = {
  start: "2026-09-18",              // Day 1 (Austin)
  data: { owner: "viashaan", repo: "wolf-data" },

  // Daily habits. `core` names the ones the nightly message cares about most.
  // `days` = weekdays it applies (0 Sun .. 6 Sat); `from` = first plan day it applies.
  // `time` = the row records a clock time. `icon` = an authored SVG in app.js.
  habits: [
    { id: "wake",     label: "Up by 07:45",           icon: "sunrise",  time: true,  core: true, defaultTime: "07:45",
      why: "Two alarms, twenty minutes apart. Wake on the second." },
    { id: "water",    label: "Water first",           icon: "drop",
      why: "A big glass before anything else." },
    { id: "sun",      label: "Sunlight",              icon: "sun",      core: true,
      why: "10 to 20 minutes outside within an hour of waking. Holds the whole clock." },
    { id: "breakfast",label: "Breakfast",             icon: "egg",
      why: "You wake up hungry. Use it. Proper food, not a snack." },
    { id: "vits",     label: "Vitamins",              icon: "pill",
      why: "With breakfast." },
    { id: "coffee11", label: "No coffee before 10",   icon: "cup",
      why: "Cortisol has cycled by then, so it actually helps." },
    { id: "caff",     label: "Caffeine cutoff 14:00", icon: "cupoff",   core: true,
      why: "Anything after two degrades sleep even if you fall asleep fine." },
    { id: "nic",      label: "Nicotine cutoff 18:00", icon: "leafoff",
      why: "Roughly five hours clear of bed." },
    { id: "gym",      label: "Gym",                   icon: "dumbbell", from: 5, weekly: 3,
      why: "Aim for every second day, three a week. 17:30 to 19:00, then dinner. Week one: two sets, four reps shy of failure." },
    { id: "phone",    label: "Phone out of the bedroom", icon: "phoneoff",
      why: "On charge outside the room by 22:30. The one that decides bedtime." },
    { id: "brainrot", label: "Brainrot under 45 min", icon: "brain", minutes: true, limit: 45,
      why: "Instagram minutes from Screen Time. The brain runs on your 7-day average." },
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

  wolf:  { window: 7, prior: 0 },        // 7-day mean of daily completion; he starts at the bottom and trains him up
  brain: { window: 7, minutesForDead: 150 },

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
  missedPriority: ["bed", "sun", "caff", "wake", "nic", "gym", "phone", "brainrot", "coffee11", "breakfast", "water", "vits"],

  // Focus tab: what matters when. Plain day ranges, no names.
  focus: [
    { from: 1, to: 4, title: "Days 1 to 4", lines: [
      "No naps. The one rule that decides the month.",
      "Stay up until at least 22:30, then bed by 23:30.",
      "Bright light in the evening, outside at sunset. Skip the morning sun for now.",
      "No caffeine after 12:00. The 4pm slump is the trap.",
      "Eat on Austin time from the first meal.",
      "Walk, no gym yet. Join the closest decent gym."
    ]},
    { from: 5, to: 14, title: "Days 5 to 14", lines: [
      "10 to 20 minutes outside within an hour of waking. Every day. This holds everything.",
      "Phone on charge outside the bedroom at 22:30. Hot shower, then bed.",
      "Gym starts: two sessions this week, two sets, four reps shy of failure. Three a week after.",
      "Caffeine cutoff moves to 14:00.",
      "Check in every night before the phone goes away."
    ]},
    { from: 15, to: 9999, title: "Day 15 on", lines: [
      "This is where it usually slips. Watch the wake time, not the bedtime.",
      "Two wakes after 09:00 in a row: pull the next three bedtimes back by 30 minutes.",
      "One late night is fine. Two in a row is a pattern.",
      "Gym at three a week, loads climbing toward normal.",
      "Week 4: decide about coming off nicotine entirely."
    ]}
  ],

  // Ask tab: Claude, on the phone, answering from the plan + today's data. Key lives in Settings.
  ask: {
    model: "claude-opus-5",
    knowledgePath: "knowledge.md",      // in the private data repo, never in this public shell
    chips: [
      ["Coffee?",        "Can I have a coffee right now?"],
      ["Pouch?",         "Can I have a nicotine pouch right now?"],
      ["Nap?",           "I am tired. Can I nap?"],
      ["Sun",            "How much sun do I need and when, today?"],
      ["Gym today?",     "Am I training today? If so, which session and how hard?"],
      ["Eat",           "What should I eat next, and how much protein am I on track for?"],
      ["How am I doing", "How am I doing this week? Be honest. One thing to fix."],
      ["Tonight",        "What do I need to do between now and bed tonight?"]
    ]
  }
};
