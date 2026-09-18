// Wolf: the whole plan lives here. A private config.json in the data repo can be merged over it.
window.PLAN = {
  start: "2026-09-19",              // Day 1 (Austin)
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

  wolf:  { window: 7, prior: 0.5 },      // 7-day mean of daily completion; unseen days before day 1 count as 0.5
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

  // Info tab. Short, scannable.
  info: [
    { title: "You are a wolf", lines: [
      "Evening chronotype, about 15% of people. Bed around midnight, groggy until late morning, sharpest in the afternoon, second wind at night.",
      "Waking at 12 or 2pm is not the chronotype. That was drift, alcohol, nicotine, no daylight, no training.",
      "The cheapest lever is daylight within an hour of waking. The strongest is a fixed wake time."
    ]},
    { title: "Your day, by energy", lines: [
      "07:45 up. 08:00 water and breakfast. 08:15 outside.",
      "09:00 to 11:00 plan, admin, loose thinking.",
      "11:00 first coffee. 11:00 to 13:00 busy work.",
      "14:00 to 18:00 peak. The hard creative work lives here. Caffeine cutoff at 14:00.",
      "16:00 to 18:00 calls and anything persuasive.",
      "17:30 gym. 19:30 dinner. 21:00 to 22:30 people, not projects.",
      "22:30 phone away, hot shower. 23:30 bed, room at 18 to 19C."
    ]},
    { title: "ENFP, and what it means here", lines: [
      "High on novelty, low on routine. Systems that need daily willpower get abandoned.",
      "Change the environment once instead: phone outside the bedroom, app deleted, gym within ten minutes.",
      "Frame things as experiments, not commitments. Celebrate follow-through. Never shame.",
      "The 9pm to 11pm surge is real. Spend it on people or rest, not a new project."
    ]},
    { title: "Sleep, the short version", lines: [
      "Alcohol kills REM even when it helps you fall asleep. That is why 8 hours has not felt like 8.",
      "Nicotine has a two-hour half-life and fragments sleep. 18:00 cutoff captures most of the benefit.",
      "Caffeine within 8 to 10 hours of bed degrades sleep quality even if you fall asleep fine.",
      "A hot shower before bed works because of the temperature drop when you get out.",
      "One missed night is noise. Showing up the next night is the habit."
    ]},
    { title: "Focus", lines: [
      "Protect 14:00 to 18:00. Put triage, renders and admin before lunch.",
      "One thing on the desk at a time. Write the next three tasks at 09:00, do the hardest at 14:00.",
      "Phone in another room while working. The feed is engineered to win every time it is in reach."
    ]}
  ]
};
