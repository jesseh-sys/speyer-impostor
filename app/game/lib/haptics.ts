// Haptic feedback helpers — short vibrations for mobile devices
// Falls back silently on devices without vibration support

export const haptics = {
  light()   { navigator?.vibrate?.(15); },     // Button press
  medium()  { navigator?.vibrate?.(40); },     // Action confirmed
  heavy()   { navigator?.vibrate?.(100); },    // Kill / major event
  double()  { navigator?.vibrate?.([30, 50, 30]); },   // Kill attempt
  alarm()   { navigator?.vibrate?.([100, 50, 100, 50, 100]); }, // Meeting
  death()   { navigator?.vibrate?.([200, 100, 400]); },  // You died
  success() { navigator?.vibrate?.([20, 30, 20]); },     // Task complete
};
