#!/usr/bin/env node
/**
 * Keeps only the screen profiles that are still in use, together with the
 * calibrations and sessions that belong to them.
 *
 * A screen profile is created by every calibration run, not once per console
 * screen, so superseded runs leave profiles behind. The application now prunes
 * them when a device moves to a new screen and when a screen is deleted; this
 * script performs the same cleanup once for an existing profile file.
 *
 * A profile is "in use" while a device binding, the workstation, an unfinished
 * calibration session, a teaching draft or a pending batch item references it
 * (see `referencedScreenIds` in the profile store).
 *
 * Defaults to a dry run. `--apply` writes a timestamped backup first and refuses
 * while the playground is listening on its port, because the running service
 * would overwrite the cleaned file on its next write.
 *
 * Usage:
 *   pnpm --filter @midscene/mg400-service profile:prune
 *   pnpm --filter @midscene/mg400-service profile:prune -- --apply
 *   node scripts/prune-profile.mjs [--file <profiles.json>] [--force]
 */
import { existsSync } from 'node:fs';
import { copyFile, readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ProfileStore,
  referencedScreenIds,
} from '@midscene/arm-kit/internal/runtime/profile-store';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const apply = args.includes('--apply');
const force = args.includes('--force');
const file = path.resolve(
  argValue(
    '--file',
    process.env.ARM_PROFILES_FILE ??
      path.join(
        here,
        '..',
        '.midscene',
        'arm-kit',
        'installations',
        'mg400',
        'profiles.json',
      ),
  ),
);

if (!existsSync(file)) {
  console.error(`Profile file not found: ${file}`);
  process.exit(1);
}

const serviceListening = await new Promise((resolve) => {
  const socket = net.connect({ port: 5173, host: '127.0.0.1' });
  const done = (value) => {
    socket.destroy();
    resolve(value);
  };
  socket.once('connect', () => done(true));
  socket.once('error', () => done(false));
  socket.setTimeout(500, () => done(false));
});

if (apply && serviceListening && !force) {
  console.error(
    'The playground is still listening on 5173. Stop it before --apply, or pass --force if you know it is not using this profile.',
  );
  process.exit(1);
}

const raw = await readFile(file, 'utf8');
const data = JSON.parse(raw);
const referenced = referencedScreenIds(data);
const referencedScreens = data.screens.filter((screen) =>
  referenced.has(screen.id),
);
const stale = data.screens.filter((screen) => !referenced.has(screen.id));
const staleIds = new Set(stale.map((screen) => screen.id));
const staleCalibrations = data.calibrations.filter((calibration) =>
  staleIds.has(calibration.screenProfileId),
);
const staleSessions = (data.sessions ?? []).filter((session) =>
  staleIds.has(session.screenProfileId),
);
const kept = {
  ...data,
  screens: data.screens.filter((screen) => !staleIds.has(screen.id)),
  calibrations: data.calibrations.filter(
    (calibration) => !staleIds.has(calibration.screenProfileId),
  ),
  sessions: (data.sessions ?? []).filter(
    (session) => !staleIds.has(session.screenProfileId),
  ),
};

console.log(`profile: ${file}`);
console.log(
  `in use: screens=${referencedScreens.length} devices=${data.devices?.length ?? 0} workstation=${data.workstation ? 1 : 0}`,
);
console.log(
  `remove: screens=${stale.length} calibrations=${staleCalibrations.length} sessions=${staleSessions.length}`,
);
console.log(
  `size: ${(JSON.stringify(data, null, 2).length / 1024).toFixed(0)} KB -> ${(JSON.stringify(kept, null, 2).length / 1024).toFixed(0)} KB`,
);
if (stale.length) {
  for (const screen of stale.slice(0, 5)) {
    const calibrations = staleCalibrations.filter(
      (calibration) => calibration.screenProfileId === screen.id,
    ).length;
    console.log(
      `  - ${screen.id.slice(0, 8)} ${screen.name} ${screen.pixelWidth}x${screen.pixelHeight} (${calibrations} calibrations)`,
    );
  }
  if (stale.length > 5) console.log(`  ... ${stale.length - 5} more`);
}

if (!apply) {
  console.log(
    'dry run: pass --apply to remove them (a timestamped backup is kept)',
  );
  process.exit(0);
}

const backup = `${file}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
await copyFile(file, backup);
// Load through the store so the cleanup uses the same rules as the service and
// writes the file atomically.
const store = new ProfileStore(file);
await store.load();
const removed = await store.pruneUnreferencedScreens();
console.log(
  `removed screens=${removed.screens} calibrations=${removed.calibrations} sessions=${removed.sessions}`,
);
console.log(`backup written to ${backup}`);
