import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs", () => ({
  existsSync: vi.fn((p: any) => false),
  statSync: vi.fn(() => ({ isDirectory: () => true })),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import * as fs from "fs";
import * as path from "path";
import {
  findProjectRoot,
  resolveProjectRoot,
  getProjectConfigsPath,
  getProjectTargetPath,
  getProjectRcPath,
  loadProjectRc,
  saveProjectRc,
  ensureProjectDirs,
} from "./scope-resolver";

describe("scope-resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockImplementation((p: any) => false);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
    vi.mocked(fs.readFileSync).mockImplementation(() => "{}");
  });

  describe("findProjectRoot", () => {
    it("returns current dir when .opencode exists there", () => {
      vi.spyOn(process, "cwd").mockReturnValue("/repo");
      vi.mocked(fs.existsSync).mockReturnValue(true);

      expect(findProjectRoot()).toBe("/repo");
    });

    it("walks up to root when needed", () => {
    vi.spyOn(process, "cwd").mockReturnValue(path.normalize("/repo/packages/app"));
    // Only treat the repository root's .opencode as existing, not any nested .opencode
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (typeof p !== "string") return false;
      const normalized = path.normalize(p);
      return normalized === path.normalize("/repo/.opencode");
    });

      const result = findProjectRoot();
      expect(path.normalize(result)).toBe(path.normalize("/repo"));
    });

    it("returns null when not found", () => {
      vi.spyOn(process, "cwd").mockReturnValue(path.normalize("/repo/packages/app"));
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(findProjectRoot()).toBeNull();
    });
  });

  describe("resolveProjectRoot", () => {
    it("returns found project root", () => {
      vi.spyOn(process, "cwd").mockReturnValue(path.normalize("/repo/packages/app"));
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pStr = String(p);
        if (path.normalize(pStr).endsWith(path.normalize("/.opencode"))) return true;
        return false;
      });
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);

      const result = resolveProjectRoot();
      expect(path.normalize(result)).toContain(path.normalize("/repo"));
    });

    it("falls back to cwd when not found", () => {
      vi.spyOn(process, "cwd").mockReturnValue(path.normalize("/repo/packages/app"));
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = resolveProjectRoot();
      expect(path.normalize(result)).toBe(path.normalize("/repo/packages/app"));
    });
  });

  describe("path helpers", () => {
    it("returns expected paths", () => {
      const configsPath = getProjectConfigsPath("/p");
      const targetPath = getProjectTargetPath("/p");
      const rcPath = getProjectRcPath("/p");

      expect(configsPath).toContain(".opencode");
      expect(configsPath).toContain("omo-configs");
      expect(targetPath).toContain(".opencode");
      expect(targetPath).toContain("oh-my-openagent");
      expect(targetPath).toContain("jsonc");
      expect(rcPath).toContain(".opencode");
      expect(rcPath).toContain(".omorc");
    });
  });

  describe("loadProjectRc/saveProjectRc", () => {
    it("loadProjectRc returns null when missing", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(loadProjectRc("/p")).toBeNull();
    });

    it("loadProjectRc parses json", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("{\"activeProfileId\":\"a\"}");
      expect(loadProjectRc("/p")).toEqual({ activeProfileId: "a" });
    });

    it("saveProjectRc creates .opencode when missing", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pStr = String(p);
        return !pStr.endsWith(".opencode");
      });

      saveProjectRc("/p", { activeProfileId: "a" });

      const mkdirCall = vi.mocked(fs.mkdirSync).mock.calls.find((call: any) =>
        call[0] && String(call[0]).endsWith(".opencode")
      );
      expect(mkdirCall).toBeTruthy();
      expect(mkdirCall![1]).toEqual({ recursive: true });
    });
  });

  describe("ensureProjectDirs", () => {
    it("creates both .opencode and omo-configs when missing", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ensureProjectDirs("/p");

      const calls = vi.mocked(fs.mkdirSync).mock.calls;
      expect(calls.length).toBe(2);

      const hasOpencodeDir = calls.some((call: any) => call[0] && String(call[0]).endsWith(".opencode"));
      const hasConfigsDir = calls.some((call: any) => call[0] && String(call[0]).endsWith("omo-configs"));

      expect(hasOpencodeDir).toBe(true);
      expect(hasConfigsDir).toBe(true);
    });

    it("does not create when both exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      ensureProjectDirs("/p");

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });
});
