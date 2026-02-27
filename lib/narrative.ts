export interface NarrativeTemplate {
  lines: string[];
  choiceA: { label: string; result: string };
  choiceB: { label: string; result: string };
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── TRAVEL ────────────────────────────────────────
// All generic — no school-specific references (works for CVS, Boulevard, Terrace too)

const TRAVEL_NARRATIVES: NarrativeTemplate[] = [
  {
    lines: [
      "The path ahead is quiet.",
      "Your footsteps are the only sound.",
      "Then they're not.",
    ],
    choiceA: { label: "Keep moving", result: "You press on. Nothing follows. Probably." },
    choiceB: { label: "Pause and listen", result: "Silence. The kind that listens back." },
  },
  {
    lines: [
      "You round the corner.",
      "The air feels heavier here.",
      "A door behind you swings shut on its own.",
    ],
    choiceA: { label: "Ignore it", result: "You keep going. It clicks shut behind you." },
    choiceB: { label: "Look back", result: "Nothing there. But warm. Like someone just left." },
  },
  {
    lines: [
      "It's darker than before.",
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
      "You pass a window.",
      "Your reflection moves.",
      "Half a second too late.",
    ],
    choiceA: { label: "Don't look again", result: "You keep your eyes forward. Smart." },
    choiceB: { label: "Look closer", result: "Your reflection stares back. Then smiles. You didn't smile." },
  },
  {
    lines: [
      "The ground feels wrong underfoot.",
      "Like everything is shifting.",
      "Rearranging when you're not looking.",
    ],
    choiceA: { label: "Trust your sense of direction", result: "You press forward. Things settle. For now." },
    choiceB: { label: "Stop and get your bearings", result: "You pause. Everything looks normal. Almost." },
  },
  {
    lines: [
      "A pipe groans inside the wall.",
      "Then stops.",
      "Then groans again. Rhythmic. Like breathing.",
    ],
    choiceA: { label: "It's just pipes", result: "Sure. Pipes that breathe. Totally normal." },
    choiceB: { label: "Press your ear to the wall", result: "The groaning stops the moment you touch it." },
  },
  {
    lines: [
      "Footsteps behind you.",
      "Matching your pace exactly.",
      "You stop. They stop.",
    ],
    choiceA: { label: "Turn around", result: "Nothing. Empty. The footsteps don't return." },
    choiceB: { label: "Start walking again", result: "You walk. They follow. Then fade." },
  },
  {
    lines: [
      "Your phone screen glitches.",
      "For a second, it shows a message.",
      "\"BEHIND YOU.\"",
    ],
    choiceA: { label: "Don't turn around", result: "You keep walking. The screen returns to normal." },
    choiceB: { label: "Turn around", result: "Nothing there. Your phone is fine. It's fine." },
  },
  {
    lines: [
      "Something crunches under your shoe.",
      "Glass. From somewhere above.",
      "You look up. Everything's intact.",
    ],
    choiceA: { label: "Keep going", result: "Crunch. Crunch. Then solid ground again." },
    choiceB: { label: "Pick up a piece", result: "Cold to the touch. Colder than it should be." },
  },
  {
    lines: [
      "You smell something.",
      "Dust. Old paper.",
      "And something metallic. Like blood.",
    ],
    choiceA: { label: "Breathe through your mouth", result: "The smell fades. Your mouth tastes like copper." },
    choiceB: { label: "Follow the smell", result: "It leads nowhere. And everywhere." },
  },
  {
    lines: [
      "A shadow slides across the wall.",
      "Yours is behind you.",
      "This one is ahead.",
    ],
    choiceA: { label: "Follow it", result: "It rounds the corner. Gone by the time you get there." },
    choiceB: { label: "Let it go", result: "It stops. Waits. Then continues on." },
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
    lines: (title, desc) => [title + ".", desc, "As you work, you notice writing", "you've never seen before.", "'ALMOST OVER.'"],
    choiceA: { label: "Finish the task", result: "Done. When you look again, the writing is gone." },
    choiceB: { label: "Read more of the writing", result: "There's nothing else. Just those two words. Task complete." },
  },
  {
    lines: (title, desc) => [title + ".", desc, "Your shadow", "moves before you do."],
    choiceA: { label: "Don't think about it", result: "Done. Your shadow behaves itself now." },
    choiceB: { label: "Watch your shadow", result: "It's fine. It's fine. It's fine. Task complete." },
  },
  {
    lines: (title, desc) => [title + ".", desc, "Everything is normal.", "Completely normal.", "Too normal."],
    choiceA: { label: "Just do it", result: "Done. Nothing happened. That's what worries you." },
    choiceB: { label: "Scan the area first", result: "Empty. Quiet. You finish. Why are you relieved?" },
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
    lines: (name) => [`${name} is here.`, "Back turned. Unaware.", "No one else around.", "No witnesses."],
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

// ── BODY DISCOVERY ────────────────────────────────
// Auto-triggers when you walk into a room with a body

const DISCOVERY_NARRATIVES: {
  lines: (name: string) => string[];
  choiceA: { label: string; result: string };
  choiceB: { label: string; result: string };
}[] = [
  {
    lines: (name) => ["Wait.", "Something is wrong.", `${name} is on the ground.`, "Not moving."],
    choiceA: { label: "Report it", result: "You call for help. Everyone needs to see this." },
    choiceB: { label: "Back away", result: "You step back. You didn't see this. You didn't." },
  },
  {
    lines: (name) => ["You freeze.", "There, on the floor—", `${name}.`, "Oh god."],
    choiceA: { label: "Sound the alarm", result: "Your hands shake as you hit the button." },
    choiceB: { label: "Keep walking", result: "Don't look. Don't think. Keep walking." },
  },
  {
    lines: (name) => ["The air smells like iron.", "Then you see why.", `${name}. Still. Silent.`, "This is real."],
    choiceA: { label: "Call everyone here", result: "Your voice echoes. Footsteps come running." },
    choiceB: { label: "Slip away", result: "You were never here. Nobody saw you." },
  },
  {
    lines: (name) => ["You almost trip.", "Over something. Someone.", `${name}.`, "Cold.", "How long have they been here?"],
    choiceA: { label: "Report it now", result: "You shout. The word catches in your throat but comes out." },
    choiceB: { label: "Pretend you didn't see", result: "You step around them. Keep moving. Someone else will find them." },
  },
];

export function getDiscoveryNarrative(bodyName: string): NarrativeTemplate {
  const t = pickRandom(DISCOVERY_NARRATIVES);
  return {
    lines: t.lines(bodyName),
    choiceA: t.choiceA,
    choiceB: t.choiceB,
  };
}

// ── BODY REPORT (manual, after discovery) ─────────

const REPORT_NARRATIVES: {
  lines: (name: string) => string[];
  choiceA: { label: string; result: string };
  choiceB: { label: string; result: string };
}[] = [
  {
    lines: (name) => [`${name} is still here.`, "Still not moving.", "You have to say something.", "Don't you?"],
    choiceA: { label: "Sound the alarm", result: "You call everyone. This ends now." },
    choiceB: { label: "Not yet", result: "You turn away again. How long can you ignore this?" },
  },
  {
    lines: (name) => ["You look at the body again.", `${name}.`, "Someone did this.", "And they're still out there."],
    choiceA: { label: "Report it", result: "Your voice cracks as you call for help." },
    choiceB: { label: "Walk away", result: "You leave. The guilt follows." },
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
      "Something is wrong here.",
      "Everyone needs to talk. Now.",
    ],
    choiceA: { label: "Call the meeting", result: "The alarm echoes through every corridor." },
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
// All generic — work indoors, outdoors, CVS, anywhere

export const IDLE_FLAVOR = [
  "The lights flicker.",
  "A door slams somewhere distant.",
  "You hear footsteps. Then nothing.",
  "The PA crackles. Static. Silence.",
  "Something moved in your peripheral vision.",
  "A clock ticks. But not forward.",
  "A cold draft from nowhere.",
  "You smell something burning. Then it's gone.",
  "The ground vibrates. Once. Like a heartbeat.",
  "Your phone buzzes. No notification.",
  "A hum. Low. Constant. Then gone.",
  "Something small hits the ground nearby. You can't find it.",
  "The EXIT sign flickers. E-X-I-",
  "You feel eyes on you.",
  "A whisper. Too quiet to make out.",
  "A drain gurgles. Then silence.",
  "A shadow crosses the wall. Nothing cast it.",
  "The path behind you looks longer than before.",
  "Metal clicks somewhere. Open. Shut.",
  "The air pressure changes. Your ears pop.",
  "Something scratches behind the wall.",
  "Something shifts above you.",
  "A child's laugh echoes. From where?",
  "The temperature drops. Just for a second.",
];

export function getIdleFlavor(): string {
  return pickRandom(IDLE_FLAVOR);
}
