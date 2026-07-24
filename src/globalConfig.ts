import { homedir } from "node:os";
import path from "node:path";

/**
 * Shared fallback location for `.env`/`skills/`/`.core-agent/{hooks,cron}.json`
 * when none of them exist relative to the current working directory. Lets a
 * distributed binary placed on PATH and launched from an arbitrary directory
 * still find its config, instead of only working when launched from the one
 * folder it was first set up in. Mirrors the browser profile's existing
 * `~/.core-agent/browser` convention.
 */
export function globalConfigDir(): string {
  // Override escape hatch: lets tests point this at a disposable temp dir
  // instead of the real ~/.core-agent (whose contents vary machine to
  // machine and shouldn't leak into test behavior); also usable by anyone
  // who wants their global config somewhere other than the home directory.
  return process.env.CORE_AGENT_HOME ?? path.join(homedir(), ".core-agent");
}
