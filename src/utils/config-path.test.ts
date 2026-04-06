import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("os", () => ({
  platform: vi.fn(),
  homedir: vi.fn(),
}));

import * as fs from "fs";
import * as os from "os";
import { dirname, join } from "path";
import { ensureConfigDir, findExistingConfigPath, getConfigTargetDir, getConfigTargetPath } from "./config-path";

describe("config-path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.USERPROFILE;
    delete process.env.APPDATA;
    delete process.env.XDG_CONFIG_HOME;
  });

  describe("Windows", () => {
    beforeEach(() => {
      vi.mocked(os.platform).mockReturnValue("win32" as any);
    });

    it("findExistingConfigPath prefers preferred jsonc", () => {
      process.env.USERPROFILE = "C:/Users/test";
      process.env.APPDATA = "C:/Users/test/AppData/Roaming";

      const preferredJsonc = join(process.env.USERPROFILE, ".config", "opencode", "oh-my-openagent.jsonc");
      const preferredJson = join(process.env.USERPROFILE, ".config", "opencode", "oh-my-openagent.json");

      vi.mocked(fs.existsSync).mockImplementation((p) => p === preferredJsonc || p === preferredJson);

      expect(findExistingConfigPath()).toEqual({ path: preferredJsonc, exists: true });
    });

    it("findExistingConfigPath falls back to APPDATA", () => {
      process.env.USERPROFILE = "C:/Users/test";
      process.env.APPDATA = "C:/Users/test/AppData/Roaming";

      const fallbackJson = join(process.env.APPDATA, "opencode", "oh-my-opencode.json");
      vi.mocked(fs.existsSync).mockImplementation((p) => p === fallbackJson);

      expect(findExistingConfigPath()).toEqual({ path: fallbackJson, exists: true });
    });

    it("getConfigTargetDir uses existing config directory", () => {
      process.env.USERPROFILE = "C:/Users/test";
      process.env.APPDATA = "C:/Users/test/AppData/Roaming";

      const fallbackJson = join(process.env.APPDATA, "opencode", "oh-my-opencode.json");
      vi.mocked(fs.existsSync).mockImplementation((p) => p === fallbackJson);

      expect(getConfigTargetDir()).toEqual({ dir: dirname(fallbackJson), isPreferred: false });
    });

    it("getConfigTargetPath prefers preferred path when it exists", () => {
      process.env.USERPROFILE = "C:/Users/test";
      process.env.APPDATA = "C:/Users/test/AppData/Roaming";

      const preferredPath = join(process.env.USERPROFILE, ".config", "opencode", "oh-my-openagent.json");
      vi.mocked(fs.existsSync).mockImplementation((p) => p === preferredPath);

      expect(getConfigTargetPath()).toEqual({ path: preferredPath, isPreferred: true });
    });
  });

  describe("Unix", () => {
    beforeEach(() => {
      vi.mocked(os.platform).mockReturnValue("linux" as any);
      vi.mocked(os.homedir).mockReturnValue("/home/test");
    });

    it("findExistingConfigPath uses XDG_CONFIG_HOME when set", () => {
      process.env.XDG_CONFIG_HOME = "/xdg";
      const jsoncPath = join("/xdg", "opencode", "oh-my-openagent.jsonc");
      vi.mocked(fs.existsSync).mockImplementation((p) => p === jsoncPath);

      expect(findExistingConfigPath()).toEqual({ path: jsoncPath, exists: true });
    });
  });

  describe("ensureConfigDir", () => {
    it("creates directory when missing", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ensureConfigDir("/test/path/oh-my-opencode.json");

      expect(fs.mkdirSync).toHaveBeenCalledWith("/test/path", { recursive: true });
    });

    it("does nothing when directory exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      ensureConfigDir("/test/path/oh-my-opencode.json");

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });
});
