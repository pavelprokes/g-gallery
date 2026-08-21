import { execFileSync } from "node:child_process";
import path from "node:path";

/** Shells out to `seed.ts` under `tsx --conditions=react-server` rather than
 * importing it — see the comment at the top of that file for why. */
export default function globalSetup() {
  execFileSync("npx", ["tsx", "--conditions=react-server", path.join(__dirname, "seed.ts")], {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
  });
}
