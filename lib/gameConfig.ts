import { Location, Task } from '@/types/game';

export const PLAYER_ICONS = ['@', '#', '$', '&', '*', '+', '!', '?', '~', '^', '%', '='];

export const PLAYER_COLORS = [
  '#00ff41', // Green
  '#ffb000', // Amber
  '#00ffff', // Cyan
  '#ff0040', // Red
  '#ff00ff', // Magenta
  '#ffffff', // White
  '#ff6600', // Orange
  '#ffff00', // Yellow
];

export const LOCATIONS: Location[] = [
  {
    id: 'speyer', name: 'Speyer School',
    description: 'The front entrance of Speyer. Hallway lights flicker. A locker slams shut somewhere in the distance.',
    x: 50, y: 20, connectedTo: ['lobby', 'cafeteria', 'boulevard'],
  },
  {
    id: 'boulevard', name: 'The Boulevard',
    description: 'The Boulevard stretches ahead. A cold wind blows through despite all the doors being closed.',
    x: 30, y: 40, connectedTo: ['speyer', 'cvs'],
  },
  {
    id: 'meyers', name: "Ms. Meyers' Office",
    description: "Papers scattered across the desk. A coffee mug is still warm. No one has been here for hours.",
    x: 70, y: 30, connectedTo: ['speyer', 'suib'],
  },
  {
    id: 'cvs', name: 'CVS',
    description: 'Fluorescent lights hum overhead. The aisles feel narrower than usual. Something moved in aisle 3.',
    x: 20, y: 60, connectedTo: ['boulevard', 'terrace'],
  },
  {
    id: 'terrace', name: 'The Terrace',
    description: 'The sky is darker than it should be. Shadows pool in the corners. The air tastes like static.',
    x: 40, y: 70, connectedTo: ['cvs', 'cafeteria'],
  },
  {
    id: 'cafeteria', name: 'The Cafeteria',
    description: 'Empty lunch trays stacked neatly. You hear footsteps behind you. You turn around. No one is there.',
    x: 50, y: 50, connectedTo: ['speyer', 'terrace', 'music'],
  },
  {
    id: 'music', name: 'Music Room',
    description: 'A violin string snaps on its own. Sheet music flutters in a breeze from nowhere.',
    x: 60, y: 60, connectedTo: ['cafeteria', 'deard'],
  },
  {
    id: 'deard', name: "Mr. Deard's Room",
    description: "Chalk equations cover every inch of the board. You could swear one wasn't there a second ago.",
    x: 75, y: 70, connectedTo: ['music', 'mj'],
  },
  {
    id: 'lobby', name: 'Lobby Classroom',
    description: 'Desks arranged in a perfect circle. The clock on the wall is ticking backwards.',
    x: 40, y: 20, connectedTo: ['speyer', 'suib'],
  },
  {
    id: 'suib', name: "Ms. Suib's Office",
    description: "The plant on the windowsill turns to face you as you enter. Plants don't do that.",
    x: 60, y: 30, connectedTo: ['lobby', 'meyers', 'mj'],
  },
  {
    id: 'mj', name: "Ms. MJ's Office",
    description: 'The filing cabinet is open. Someone was here recently. The chair is still spinning slowly.',
    x: 80, y: 50, connectedTo: ['suib', 'deard'],
  },
  {
    id: 'secret', name: 'Room 404',
    description: 'This room shouldn\'t exist. The walls hum. A terminal glows in the corner. It knows your name.',
    x: 60, y: 80, connectedTo: ['music'],
  },
];

export const TASKS: Omit<Task, 'id'>[] = [
  { title: 'Buy snacks', location: 'cvs', description: 'The shelves seem to go on forever. Just grab something and go.', type: 'quick' },
  { title: 'Sketch something', location: 'music', description: 'Your pencil moves across the paper. The silence is deafening.', type: 'mini-game' },
  { title: 'Organize locker', location: 'lobby', description: 'Your combination feels wrong. It opens anyway.', type: 'quick' },
  { title: 'Check homework', location: 'deard', description: 'The assignments look normal. Except the one written in red.', type: 'quick' },
  { title: 'Return book', location: 'speyer', description: 'The book feels heavier than when you checked it out.', type: 'quick' },
  { title: 'Sharpen pencils', location: 'lobby', description: 'The sharpener grinds louder than it should.', type: 'mini-game' },
  { title: 'Fill water bottle', location: 'cafeteria', description: 'The water runs clear. Then cloudy. Then clear again.', type: 'quick' },
  { title: 'Check schedule', location: 'meyers', description: 'Your name is on the schedule. Twice.', type: 'quick' },
  { title: 'Clean whiteboard', location: 'deard', description: 'The eraser leaves faint traces of words you never wrote.', type: 'quick' },
  { title: 'Put away instruments', location: 'music', description: 'Each instrument hums faintly when you touch it.', type: 'quick' },
  { title: 'Set up lunch tray', location: 'cafeteria', description: 'The lunch line is empty. The food is already cold.', type: 'quick' },
  { title: 'Sign attendance', location: 'lobby', description: 'Everyone else signed. In the same handwriting.', type: 'quick' },
  { title: 'Water the plant', location: 'suib', description: 'It turns to face you. It was already facing you.', type: 'quick' },
  { title: 'Collect papers', location: 'mj', description: 'The papers are blank. Every single one.', type: 'quick' },
  { title: 'Hang on terrace', location: 'terrace', description: 'Take a breather. The air hums with electricity.', type: 'quick' },
];

export const SABOTAGES = [
  { id: 'fire-drill', name: 'Fire Drill!', description: 'Everyone must go to The Boulevard', duration: 30 },
  { id: 'lunch-backup', name: 'Lunch Line Backup', description: 'Cafeteria is blocked', duration: 45 },
  { id: 'internet-down', name: 'Internet Down', description: 'Can\'t complete digital tasks', duration: 40 },
  { id: 'pa-announcement', name: 'PA Announcement', description: 'Loud static disrupts everyone', duration: 15 },
  { id: 'lights-out', name: 'Lights Out', description: 'Reduced visibility', duration: 30 },
  { id: 'locked-doors', name: 'Doors Locked', description: 'Can\'t move between rooms', duration: 25 },
];

export const KILL_ANIMATIONS = [
  { id: 'viper', name: 'Viper', description: 'Poison attack' },
  { id: 'phantom', name: 'Phantom', description: 'Disappear into shadows' },
  { id: 'ninja', name: 'Ninja', description: 'Swift strike' },
  { id: 'freeze', name: 'Freeze', description: 'Frozen in place' },
  { id: 'zap', name: 'Zap', description: 'Electric shock' },
];

export const GAME_CONFIG = {
  MIN_PLAYERS: 3,
  MAX_PLAYERS: 15,
  DISCUSSION_TIME: 45,
  VOTING_TIME: 30,
  GAME_DURATION: 600,
  TASKS_PER_PLAYER: 5,
  KILL_COOLDOWN: 30,
  IMPOSTOR_RATIOS: {
    5: 1,
    8: 2,
    12: 3,
  },
};

export function getImpostorCount(playerCount: number): number {
  if (playerCount < 8) return 1;
  if (playerCount < 12) return 2;
  return 3;
}
