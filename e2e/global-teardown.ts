import { execFileSync } from "node:child_process";
import path from "node:path";

export default function globalTeardown() {
  execFileSync("npx", ["tsx", "--conditions=react-server", path.join(__dirname, "teardown.ts")], {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
  });
}
