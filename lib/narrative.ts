export interface NarrativeTemplate {
  lines: string[];
  choiceA: { label: string; result: string };
  choiceB: { label: string; result: string };
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── TRAVEL ────────────────────────────────────────

const OUTSIDE_IDS = new Set(['cvs', 'boulevard', 'terrace']);

// School hallways, classrooms, lockers — the Speyer vibe
const SCHOOL_TRAVEL: NarrativeTemplate[] = [
  {
    lines: [
      "The hallway stretches ahead.",
      "A locker slams somewhere behind you.",
      "You didn't see anyone.",
    ],
    choiceA: { label: "Keep moving", result: "Your shoes squeak on the linoleum. Too loud." },
    choiceB: { label: "Check the locker", result: "Closed. Locked. But warm to the touch." },
  },
  {
    lines: [
      "You pass a classroom.",
      "The door is open.",
      "Desks arranged in a circle. All facing inward.",
    ],
    choiceA: { label: "Don't go in", result: "You keep walking. The door clicks shut behind you." },
    choiceB: { label: "Look inside", result: "Empty. But the whiteboard says 'WE SEE YOU.'" },
  },
  {
    lines: [
      "A bulletin board catches your eye.",
      "Someone pinned a note.",
      "It just says your name.",
    ],
    choiceA: { label: "Tear it down", result: "You rip it off. Underneath is another one." },
    choiceB: { label: "Leave it", result: "You walk on. You feel it watching your back." },
  },
  {
    lines: [
      "The water fountain gurgles.",
      "On its own.",
      "The water runs red for a second. Then clear.",
    ],
    choiceA: { label: "Keep going", result: "You hear it gurgle again behind you." },
    choiceB: { label: "Look closer", result: "Clear water. Normal. Your reflection in it isn't." },
  },
  {
    lines: [
      "A pencil rolls off a desk nearby.",
      "Slowly. Against the slope.",
      "It points at you.",
    ],
    choiceA: { label: "Step over it", result: "It rolls to follow. Then stops." },
    choiceB: { label: "Pick it up", result: "Cold. Like it's been in a freezer." },
  },
  {
    lines: [
      "Chalk dust hangs in the air.",
      "You didn't see anyone writing.",
      "The board says 'DON'T TURN AROUND.'",
    ],
    choiceA: { label: "Don't turn around", result: "Smart. You keep walking. Faster." },
    choiceB: { label: "Turn around", result: "Nothing. The chalk dust settles. The board is blank now." },
  },
  {
    lines: [
      "A classroom door opens as you approach.",
      "No one inside.",
      "The smart board flickers on. Static.",
    ],
    choiceA: { label: "Go through", result: "The static stops the moment you enter." },
    choiceB: { label: "Find another way", result: "All the other doors are locked. Of course." },
  },
];

// Streets, sidewalks, storefronts — outside Speyer
const OUTSIDE_TRAVEL: NarrativeTemplate[] = [
  {
    lines: [
      "The sidewalk feels different out here.",
      "The city noise should be comforting.",
      "It isn't.",
    ],
    choiceA: { label: "Walk faster", result: "Your footsteps echo off the storefronts." },
    choiceB: { label: "Look around", result: "No one on the street. That's... unusual." },
  },
  {
    lines: [
      "The wind picks up.",
      "It carries something. A whisper?",
      "No. Just the wind. Probably.",
    ],
    choiceA: { label: "Ignore it", result: "The wind dies. The whisper doesn't." },
    choiceB: { label: "Listen", result: "Your name. It said your name. ...Did it?" },
  },
  {
    lines: [
      "A streetlight flickers as you pass.",
      "Then the next one.",
      "Then the next. Following you.",
    ],
    choiceA: { label: "Don't look up", result: "They steady behind you. Only the one ahead flickers." },
    choiceB: { label: "Stop and wait", result: "They all go dark. Then snap back on. You're not alone." },
  },
  {
    lines: [
      "The street is empty.",
      "No cars. No people.",
      "Just you and the feeling of being watched.",
    ],
    choiceA: { label: "Keep your head down", result: "You make it. Something was behind you. You're sure of it." },
    choiceB: { label: "Scan the windows", result: "A curtain moves. Third floor. No one there now." },
  },
  {
    lines: [
      "A shop door swings open as you walk by.",
      "The sign says CLOSED.",
      "Inside is dark.",
    ],
    choiceA: { label: "Keep walking", result: "The door closes on its own. The lock clicks." },
    choiceB: { label: "Peer inside", result: "Empty shelves. Except for a note: 'WRONG WAY.'" },
  },
];

// Work anywhere — shadows, footsteps, general creepy
const GENERIC_TRAVEL: NarrativeTemplate[] = [
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
      "It's darker than before.",
      "Did someone turn off the lights?",
      "You hear breathing. Not yours.",
    ],
    choiceA: { label: "Walk faster", result: "You quicken your pace. The breathing fades." },
    choiceB: { label: "Call out", result: "\"Hello?\" Your voice dies in the dark. No answer." },
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
      "A shadow slides across the wall.",
      "Yours is behind you.",
      "This one is ahead.",
    ],
    choiceA: { label: "Follow it", result: "It rounds the corner. Gone by the time you get there." },
    choiceB: { label: "Let it go", result: "It stops. Waits. Then continues on." },
  },
];

export function getTravelNarrative(destinationName: string, destinationId?: string): NarrativeTemplate {
  const isOutside = destinationId ? OUTSIDE_IDS.has(destinationId) : false;
  const pool = isOutside
    ? [...OUTSIDE_TRAVEL, ...GENERIC_TRAVEL]
    : [...SCHOOL_TRAVEL, ...GENERIC_TRAVEL];
  const base = pickRandom(pool);
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

const SCHOOL_IDLE = [
  "A locker clicks open on its own.",
  "The PA crackles. Static. Silence.",
  "Chalk dust drifts past. No one is writing.",
  "A desk scrapes across the floor. No one is sitting there.",
  "The bell rings. But it's not time.",
  "Someone wrote something on the whiteboard. It wasn't there before.",
  "A pencil rolls off a desk. Slowly. Uphill.",
  "The smart board turns on. Shows your name. Then off.",
  "You hear a locker combination clicking. Spin. Spin. Click.",
  "A backpack sits in the hallway. It wasn't there a minute ago.",
  "The hallway lights flicker in sequence. Toward you.",
  "A classroom door drifts open. The room is dark inside.",
];

const OUTSIDE_IDLE = [
  "A car alarm goes off. Then stops mid-beep.",
  "The streetlight above you buzzes. Then pops.",
  "A plastic bag tumbles past. Against the wind.",
  "You hear a shopping cart rolling. No one is pushing it.",
  "The neon sign flickers. ON. OFF. ON.",
  "A pigeon watches you. It hasn't blinked.",
];

const GENERIC_IDLE = [
  "The lights flicker.",
  "A door slams somewhere distant.",
  "You hear footsteps. Then nothing.",
  "Something moved in your peripheral vision.",
  "A clock ticks. But not forward.",
  "A cold draft from nowhere.",
  "You smell something burning. Then it's gone.",
  "The ground vibrates. Once. Like a heartbeat.",
  "Your phone buzzes. No notification.",
  "A hum. Low. Constant. Then gone.",
  "The EXIT sign flickers. E-X-I-",
  "You feel eyes on you.",
  "A whisper. Too quiet to make out.",
  "A shadow crosses the wall. Nothing cast it.",
  "The air pressure changes. Your ears pop.",
  "Something scratches behind the wall.",
  "The temperature drops. Just for a second.",
];

export function getIdleFlavor(locationId?: string): string {
  const isOutside = locationId ? OUTSIDE_IDS.has(locationId) : false;
  const pool = isOutside
    ? [...OUTSIDE_IDLE, ...GENERIC_IDLE]
    : [...SCHOOL_IDLE, ...GENERIC_IDLE];
  return pickRandom(pool);
}
