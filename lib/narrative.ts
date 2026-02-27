export interface NarrativeTemplate {
  lines: string[];
  choiceA: { label: string; result: string };
  choiceB: { label: string; result: string };
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── TRAVEL ────────────────────────────────────────

const TRAVEL_NARRATIVES: NarrativeTemplate[] = [
  {
    lines: [
      "The hallway stretches ahead.",
      "Your footsteps echo off the tiles.",
      "The lights flicker once. Twice.",
    ],
    choiceA: { label: "Keep moving", result: "You press on. Nothing follows. Probably." },
    choiceB: { label: "Pause and listen", result: "Silence. The kind that listens back." },
  },
  {
    lines: [
      "You round the corner.",
      "The air feels heavier here.",
      "A locker door swings open on its own.",
    ],
    choiceA: { label: "Ignore it", result: "You walk past. The locker clicks shut behind you." },
    choiceB: { label: "Look inside", result: "Empty. But warm. Like someone was just here." },
  },
  {
    lines: [
      "The corridor is darker than before.",
      "Did someone turn off the lights?",
      "You hear breathing. Not yours.",
    ],
    choiceA: { label: "Walk faster", result: "You quicken your pace. The breathing fades." },
    choiceB: { label: "Call out", result: "\"Hello?\" Your voice dies in the dark. No answer." },
  },
  {
    lines: [
      "A door ahead creaks open.",
      "Slowly. No one is there.",
      "The hinges groan in the stillness.",
    ],
    choiceA: { label: "Go through", result: "You step through. It swings shut behind you." },
    choiceB: { label: "Find another way", result: "There is no other way. You go through anyway." },
  },
  {
    lines: [
      "You pass a bulletin board.",
      "Something catches your eye—",
      "A note: 'IT KNOWS.'",
    ],
    choiceA: { label: "Take the note", result: "You reach for it. It crumbles to dust in your fingers." },
    choiceB: { label: "Keep walking", result: "You look away. When you glance back, the note is gone." },
  },
  {
    lines: [
      "The floor tiles feel wrong underfoot.",
      "Like the school is shifting.",
      "Rearranging itself when you're not looking.",
    ],
    choiceA: { label: "Trust your sense of direction", result: "You press forward. The walls settle. For now." },
    choiceB: { label: "Stop and get your bearings", result: "You pause. Everything looks normal. Almost." },
  },
  {
    lines: [
      "A water fountain gurgles as you pass.",
      "You didn't press the button.",
      "It gurgles again. Louder.",
    ],
    choiceA: { label: "Don't look at it", result: "You keep your eyes forward. The gurgling stops." },
    choiceB: { label: "Glance at the water", result: "The water is dark. Almost black. Then it clears." },
  },
  {
    lines: [
      "Footsteps behind you.",
      "Matching your pace exactly.",
      "You stop. They stop.",
    ],
    choiceA: { label: "Turn around", result: "Nothing. An empty hallway. The footsteps don't return." },
    choiceB: { label: "Start walking again", result: "You walk. The footsteps follow. Then fade." },
  },
  {
    lines: [
      "The PA system crackles to life.",
      "Static. Then a voice, too quiet to understand.",
      "It says your name. You think.",
    ],
    choiceA: { label: "It's nothing. Move on.", result: "The PA cuts out. Just interference." },
    choiceB: { label: "Listen closer", result: "\"...don't trust...\" Click. Dead air." },
  },
  {
    lines: [
      "A classroom door is ajar.",
      "Inside, a chair is spinning.",
      "Slowly. On its own.",
    ],
    choiceA: { label: "Close the door", result: "You pull it shut. The spinning stops. You hope." },
    choiceB: { label: "Walk past quickly", result: "You hurry by. From inside: the creak of the chair stopping." },
  },
  {
    lines: [
      "Something crunches under your shoe.",
      "Glass. From one of the ceiling lights.",
      "You look up. The light is fine.",
    ],
    choiceA: { label: "Keep going", result: "Crunch. Crunch. Then tile again." },
    choiceB: { label: "Pick up a piece", result: "Cold to the touch. Colder than it should be." },
  },
  {
    lines: [
      "You smell something.",
      "Pencil shavings. Chalk dust.",
      "And something else. Something wrong.",
    ],
    choiceA: { label: "Breathe through your mouth", result: "The smell fades. Your mouth tastes like copper." },
    choiceB: { label: "Follow the smell", result: "It leads nowhere. And everywhere." },
  },
];

export function getTravelNarrative(destinationName: string): NarrativeTemplate {
  const base = pickRandom(TRAVEL_NARRATIVES);
  return {
    lines: [`You head toward ${destinationName}.`, ...base.lines],
    choiceA: base.choiceA,
    choiceB: base.choiceB,
  };
}

// ── TASKS ─────────────────────────────────────────

const TASK_NARRATIVES: {
  lines: (title: string, desc: string) => string[];
  choiceA: { label: string; result: string };
  choiceB: { label: string; result: string };
}[] = [
  {
    lines: (title, desc) => [title + ".", desc, "Simple enough.", "...right?"],
    choiceA: { label: "Focus and finish quickly", result: "Done. Your hands are trembling. Why?" },
    choiceB: { label: "Stay alert while working", result: "Done. You kept one eye on the door the whole time." },
  },
  {
    lines: (title, desc) => [title + ".", desc, "You've done this before.", "But today it feels different."],
    choiceA: { label: "Hurry through it", result: "Finished. You don't look back." },
    choiceB: { label: "Take your time", result: "Finished. Time moved strangely while you worked." },
  },
  {
    lines: (title, desc) => [title + ".", desc, "You start working.", "A sound behind you. Footsteps?"],
    choiceA: { label: "Ignore it and finish", result: "Done. The footsteps stopped. Or were never there." },
    choiceB: { label: "Check first, then finish", result: "No one there. You finish the task, nerves on edge." },
  },
  {
    lines: (title, desc) => [title + ".", desc, "Halfway through, the lights dim.", "Just for a second."],
    choiceA: { label: "Power through it", result: "Done. The lights return to normal. Mostly." },
    choiceB: { label: "Wait for the lights", result: "They come back. You finish. Something feels different." },
  },
  {
    lines: (title, desc) => [title + ".", desc, "As you work, you notice writing", "on the wall you've never seen before.", "'ALMOST OVER.'"],
    choiceA: { label: "Finish the task", result: "Done. When you look again, the writing is gone." },
    choiceB: { label: "Read more of the writing", result: "There's nothing else. Just those two words. Task complete." },
  },
  {
    lines: (title, desc) => [title + ".", desc, "Your shadow on the wall", "moves before you do."],
    choiceA: { label: "Don't think about it", result: "Done. Your shadow behaves itself now." },
    choiceB: { label: "Watch your shadow", result: "It's fine. It's fine. It's fine. Task complete." },
  },
  {
    lines: (title, desc) => [title + ".", desc, "Everything is normal.", "Completely normal.", "Too normal."],
    choiceA: { label: "Just do it", result: "Done. Nothing happened. That's what worries you." },
    choiceB: { label: "Scan the room first", result: "Empty. Quiet. You finish. Why are you relieved?" },
  },
  {
    lines: (title, desc) => [title + ".", desc, "Someone was here before you.", "You can tell.", "Things are slightly moved."],
    choiceA: { label: "Finish what they started", result: "Done. You wonder who was here. And why they left." },
    choiceB: { label: "Reset everything first", result: "You start over. Finish clean. But who was here?" },
  },
];

export function getTaskNarrative(taskTitle: string, taskDesc: string): NarrativeTemplate {
  const t = pickRandom(TASK_NARRATIVES);
  return {
    lines: t.lines(taskTitle, taskDesc),
    choiceA: t.choiceA,
    choiceB: t.choiceB,
  };
}

// ── KILLS ─────────────────────────────────────────

const KILL_NARRATIVES: {
  lines: (name: string) => string[];
  choiceA: { label: string; getResult: (name: string) => string };
  choiceB: { label: string; result: string };
}[] = [
  {
    lines: (name) => [`${name} is here.`, "Back turned. Unaware.", "The hallway behind you is empty.", "No witnesses."],
    choiceA: { label: "Now.", getResult: (n) => `It's over before ${n} knows what happened.` },
    choiceB: { label: "Not yet.", result: "You pull back into the shadows. Another time." },
  },
  {
    lines: (name) => [`${name} is alone.`, "Focused on something.", "They haven't noticed you.", "Your heart beats louder."],
    choiceA: { label: "Strike", getResult: (n) => `Quick. Clean. ${n} drops.` },
    choiceB: { label: "Walk away", result: "You leave quietly. The moment passes." },
  },
  {
    lines: (name) => ["The lights are dim.", `${name} is right there.`, "This is your chance.", "No one is coming."],
    choiceA: { label: "Do it", getResult: (n) => `${n} crumples. The lights flicker once, then steady.` },
    choiceB: { label: "Hesitate", result: "You can't. Not now. You turn away." },
  },
  {
    lines: (name) => [`You watch ${name} from the doorway.`, "They're humming something.", "Completely unguarded.", "The darkness feels hungry."],
    choiceA: { label: "Feed it", getResult: (n) => `${n} stops humming.` },
    choiceB: { label: "Resist", result: "Not this one. Not yet. You melt back." },
  },
  {
    lines: (name) => ["A voice in your head whispers.", `It says ${name}'s name.`, "Over and over.", "It wants you to act."],
    choiceA: { label: "Listen to it", getResult: (n) => `The voice goes quiet. ${n} goes quiet too.` },
    choiceB: { label: "Ignore it", result: "The voice fades. For now. It always comes back." },
  },
];

export function getKillNarrative(victimName: string): NarrativeTemplate {
  const t = pickRandom(KILL_NARRATIVES);
  return {
    lines: t.lines(victimName),
    choiceA: { label: t.choiceA.label, result: t.choiceA.getResult(victimName) },
    choiceB: { label: t.choiceB.label, result: t.choiceB.result },
  };
}

// ── BODY REPORT ───────────────────────────────────

const REPORT_NARRATIVES: {
  lines: (name: string) => string[];
  choiceA: { label: string; result: string };
  choiceB: { label: string; result: string };
}[] = [
  {
    lines: (name) => ["You see something on the ground.", "No. Someone.", `It's ${name}.`, "They're not moving."],
    choiceA: { label: "Sound the alarm", result: "You call everyone. This ends now." },
    choiceB: { label: "Back away quietly", result: "You saw nothing. Nothing at all. You leave." },
  },
  {
    lines: (name) => ["You almost trip over—", "Oh no.", `${name}.`, "Still. Cold.", "This is real."],
    choiceA: { label: "Report it", result: "Your voice cracks as you call for help." },
    choiceB: { label: "Pretend you didn't see", result: "You step around them. Keep walking. Don't think." },
  },
  {
    lines: (name) => ["Something is wrong here.", "The air smells like iron.", `Then you see ${name}.`, "On the floor.", "Not breathing."],
    choiceA: { label: "Tell everyone", result: "You shout. Footsteps come running." },
    choiceB: { label: "Walk away", result: "You turn your back. Someone else will find them." },
  },
];

export function getReportNarrative(bodyName: string): NarrativeTemplate {
  const t = pickRandom(REPORT_NARRATIVES);
  return {
    lines: t.lines(bodyName),
    choiceA: t.choiceA,
    choiceB: t.choiceB,
  };
}

// ── EMERGENCY MEETING ─────────────────────────────

const MEETING_NARRATIVES: NarrativeTemplate[] = [
  {
    lines: [
      "You reach for the emergency button.",
      "Are you sure about this?",
      "Once you press it, there's no going back.",
    ],
    choiceA: { label: "Press it", result: "BEEP. Everyone stops what they're doing." },
    choiceB: { label: "Step away", result: "Not yet. You need more proof." },
  },
  {
    lines: [
      "Enough.",
      "Something is wrong in this school.",
      "Everyone needs to talk. Now.",
    ],
    choiceA: { label: "Call the meeting", result: "The alarm echoes through every hallway." },
    choiceB: { label: "Wait a little longer", result: "You hesitate. Maybe you're imagining things." },
  },
  {
    lines: [
      "The emergency button glows red.",
      "You've been thinking about pressing it",
      "since this started.",
    ],
    choiceA: { label: "Do it", result: "SLAM. The meeting bell rings." },
    choiceB: { label: "Not now", result: "You pull your hand back. Soon." },
  },
];

export function getMeetingNarrative(): NarrativeTemplate {
  return pickRandom(MEETING_NARRATIVES);
}

// ── IDLE FLAVOR ───────────────────────────────────

export const IDLE_FLAVOR = [
  "The lights flicker.",
  "A door slams somewhere distant.",
  "You hear footsteps. Then nothing.",
  "The PA crackles. Static. Silence.",
  "Something moved in your peripheral vision.",
  "The clock ticks. But not forward.",
  "A cold draft. Every window is closed.",
  "You smell something burning. Then it's gone.",
  "The floor creaks above you. This is the top floor.",
  "Your phone buzzes. No notification.",
  "The ventilation hums a tune you almost recognize.",
  "A pencil rolls off a desk on its own.",
  "The EXIT sign flickers. E-X-I-",
  "You feel eyes on you.",
  "A whisper. Too quiet to make out.",
  "The water fountain turns on by itself.",
  "A shadow crosses the wall. Nothing cast it.",
  "The hallway behind you looks longer than before.",
  "A locker combination clicks. Open. Shut.",
  "The air pressure changes. Your ears pop.",
  "Something scratches inside the wall.",
  "The ceiling tiles shift. Settle. Shift again.",
  "A child's laugh echoes. School ended hours ago.",
  "The thermostat reads 33°F. You don't feel cold.",
];

export function getIdleFlavor(): string {
  return pickRandom(IDLE_FLAVOR);
}
