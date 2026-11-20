/** A new screen gets the next numeric label without reusing a named screen. */
export function nextScreenName(screens: readonly { name: string }[]) {
  const taken = new Set(
    screens.map((screen) => screen.name.trim().toLocaleLowerCase('en-US')),
  );
  let index = screens.length + 1;
  while (taken.has(`screen ${index}`)) index += 1;
  return `Screen ${index}`;
}
