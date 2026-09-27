// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { printCopyCommand, printList } from "./print-export";

describe("printList", () => {
  it("lists one line per photo, sorted by file name", () => {
    expect(
      printList([
        { fileName: "b.jpg", quantity: 5 },
        { fileName: "a.jpg", quantity: 1 },
      ]),
    ).toBe("a.jpg — 1 ks\nb.jpg — 5 ks");
  });
});

describe("printCopyCommand", () => {
  // The command is pasted into Terminal, so it is run here for real — in bash,
  // and in zsh too where it exists (macOS's default shell).
  const shells = ["bash", "zsh"].filter((shell) => {
    try {
      execFileSync(shell, ["-c", "true"]);
      return true;
    } catch {
      return false;
    }
  });

  for (const shell of shells) {
    it(`copies the chosen files into tisk/ with the copy count in the name (${shell})`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "print-export-"));
      for (const name of ["one.jpg", "five.jpg", "skip.jpg", "it's here.jpg"]) {
        fs.writeFileSync(path.join(dir, name), name);
      }
      const command = printCopyCommand([
        { fileName: "one.jpg", quantity: 1 },
        { fileName: "five.jpg", quantity: 5 },
        { fileName: "it's here.jpg", quantity: 2 },
        { fileName: "missing.jpg", quantity: 1 },
        // A guest-named file must not escape the folder or run anything.
        { fileName: "../../evil.jpg\nSEZNAM\ntouch pwned", quantity: 1 },
      ]);

      const out = execFileSync(shell, ["-c", command], { cwd: dir, encoding: "utf8" });

      expect(fs.readdirSync(path.join(dir, "tisk")).sort()).toEqual([
        "2x_it's here.jpg",
        "5x_five.jpg",
        "one.jpg",
      ]);
      expect(out).toContain("Chybí: missing.jpg");
      expect(fs.existsSync(path.join(dir, "pwned"))).toBe(false);
      fs.rmSync(dir, { recursive: true });
    });
  }
});
