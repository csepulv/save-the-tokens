import { listProfiles, removeProfile, getProfilesRoot } from '../lib/profile-paths.js';

export async function profileList(_options, deps = {}) {
  const { log = console.log } = deps;
  const profiles = await listProfiles(deps);

  if (profiles.length === 0) {
    log(`No profiles in ${getProfilesRoot()}`);
    return;
  }

  log(`Profiles in ${getProfilesRoot()}:`);
  for (const profile of profiles) {
    log(`  ${profile.name}    ${profile.path}`);
  }
}

export async function profileRm(name, _options, deps = {}) {
  const { log = console.log, error = console.error, exit = process.exit } = deps;
  try {
    const removed = await removeProfile(name, deps);
    log(`Removed profile: ${removed}`);
  } catch (err) {
    if (err.code === 'PROFILE_NOT_FOUND') {
      error(err.message);
      exit(1);
      return;
    }
    if (/Invalid profile name/.test(err.message)) {
      error(err.message);
      exit(1);
      return;
    }
    throw err;
  }
}
