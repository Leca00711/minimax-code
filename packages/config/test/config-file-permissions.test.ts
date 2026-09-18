import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConfig,
  getConfigPath,
  resetConfig,
  setLegacyByokProviderMigrationEnabled,
  setManagedPresetBaseUrlSyncEnabled,
} from "../src/config.js";
import { updateLocalByokConfig } from "../src/local-model-provider-write.js";
import { writeTuiStatusLineSetting } from "../src/tui-status-line-write.js";
import { setCuBackend } from "../src/cu-backend-io.js";
import { writePrivateConfigFileSync } from "../src/private-config-file.js";
import { migrateLegacyByokProvidersOnDisk } from "../src/byok-config.js";
import {
  updateLocalConfigFile,
  updateLocalByokConfig as updateLegacyByok,
} from "../../local-runtime/src/config/update.js";

const secret = "synthetic-config-permissions-key";
const document = `custom_provider:\n  example:\n    options:\n      apiKey: ${secret}\n    models: {}\n`;
let root: string;
let dataDir: string;
let configPath: string;

// Windows chmod does not express an owner-only ACL; these assertions are POSIX only.
describe.skipIf(process.platform === "win32")(
  "credential-bearing config permissions",
  () => {
    beforeEach(() => {
      root = fs.mkdtempSync(join(os.tmpdir(), "mcode-config-permissions-"));
      dataDir = join(root, "profile");
      fs.mkdirSync(dataDir);
      vi.spyOn(os, "homedir").mockReturnValue(root);
      vi.stubEnv("MINIMAX_DATA_DIR", dataDir);
      vi.stubEnv("__MAVIS_RUNTIME_MANAGED", "0");
      resetConfig();
      setLegacyByokProviderMigrationEnabled(false);
      setManagedPresetBaseUrlSyncEnabled(false);
      configPath = getConfigPath();
      expect(configPath).toBe(join(dataDir, "config.yaml"));
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      resetConfig();
      setLegacyByokProviderMigrationEnabled(true);
      setManagedPresetBaseUrlSyncEnabled(true);
      fs.rmSync(root, { recursive: true, force: true });
    });

    const writers = [
      [
        "BYOK",
        () =>
          updateLocalByokConfig((draft) => {
            draft.minimax_api = { apiKey: secret };
          }),
      ],
      [
        "legacy BYOK",
        () =>
          updateLegacyByok((draft) => {
            draft.minimax_api = { apiKey: secret };
          }),
      ],
      [
        "ordinary setting",
        () => updateLocalConfigFile({ permissionMode: "default" }),
      ],
      ["status line", () => writeTuiStatusLineSetting(dataDir, ["model"])],
      ["CU backend", () => setCuBackend("native")],
    ] as const;

    it.each(writers)("%s creates a private config", async (_name, write) => {
      await write();
      expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    });

    it.each(writers)(
      "%s repairs an existing public config and preserves credentials",
      async (_name, write) => {
        fs.writeFileSync(configPath, document);
        fs.chmodSync(configPath, 0o644);
        await write();
        expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
        expect(fs.readFileSync(configPath, "utf8")).toContain(secret);
      },
    );

    it.each(writers.slice(0, 4))(
      "%s keeps the old file and temporary credentials private on rename failure",
      async (_name, write) => {
        fs.writeFileSync(configPath, document);
        fs.chmodSync(configPath, 0o644);
        let temporaryMode: number | undefined;
        vi.spyOn(fs.promises, "rename").mockImplementation(async (source) => {
          temporaryMode = fs.statSync(source).mode & 0o777;
          throw new Error("synthetic rename failure");
        });
        await expect(write()).rejects.toThrow();
        expect(temporaryMode).toBe(0o600);
        expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
        expect(fs.readFileSync(configPath, "utf8")).toBe(document);
        expect(fs.readdirSync(dataDir)).toEqual(["config.yaml"]);
      },
    );

    it.each(writers.slice(0, 4))(
      "%s aborts before mutation if permissions cannot be restricted",
      async (_name, write) => {
        fs.writeFileSync(configPath, document);
        vi.spyOn(fs.promises, "chmod").mockRejectedValue(
          new Error("synthetic chmod failure"),
        );
        await expect(write()).rejects.toThrow();
        expect(fs.readFileSync(configPath, "utf8")).toBe(document);
        expect(fs.readdirSync(dataDir)).toEqual(["config.yaml"]);
      },
    );

    it("repairs an existing config when loaded without an edit", () => {
      fs.writeFileSync(configPath, document);
      fs.chmodSync(configPath, 0o644);
      getConfig();
      expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(configPath, "utf8")).toBe(document);
    });

    it("creates managed defaults privately", () => {
      vi.stubEnv("__MAVIS_RUNTIME_MANAGED", "1");
      getConfig();
      expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    });

    it("copies default-profile credentials into a private config", () => {
      const defaults = join(root, ".minimax");
      fs.mkdirSync(defaults);
      fs.writeFileSync(join(defaults, "config.yaml"), document, {
        mode: 0o644,
      });
      getConfig();
      expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(configPath, "utf8")).toBe(document);
    });

    it("repairs old migration backups even when migration is disabled", () => {
      fs.writeFileSync(configPath, document);
      const backup = join(dataDir, "config.yaml.bak.byok-legacy-provider.123");
      fs.writeFileSync(backup, document);
      fs.chmodSync(backup, 0o644);
      getConfig();
      expect(fs.statSync(backup).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(backup, "utf8")).toBe(document);
    });

    it("keeps a symlinked status-line config and its credentials private", async () => {
      const target = join(root, "linked.yaml");
      fs.writeFileSync(target, document);
      fs.chmodSync(target, 0o644);
      fs.symlinkSync(target, configPath);
      await writeTuiStatusLineSetting(dataDir, ["model"]);
      expect(fs.lstatSync(configPath).isSymbolicLink()).toBe(true);
      expect(fs.statSync(target).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(target, "utf8")).toContain(secret);
    });

    it("restricts synchronous copies before writing their first credential byte", () => {
      const write = fs.writeFileSync;
      const modes: number[] = [];
      vi.spyOn(fs, "writeFileSync").mockImplementation((file, ...args) => {
        if (typeof file === "number")
          modes.push(fs.fstatSync(file).mode & 0o777);
        return write(file, ...args);
      });
      writePrivateConfigFileSync(configPath, document);
      expect(modes).toEqual([0o600]);
    });

    it("does not truncate or write credentials when restriction fails", () => {
      fs.writeFileSync(configPath, "original");
      vi.spyOn(fs, "fchmodSync").mockImplementation(() => {
        throw new Error("synthetic permission failure");
      });
      expect(() => writePrivateConfigFileSync(configPath, document)).toThrow(
        "synthetic permission failure",
      );
      expect(fs.readFileSync(configPath, "utf8")).toBe("original");
    });

    it("creates a private migration backup and repairs the migrated config", () => {
      fs.writeFileSync(
        configPath,
        `provider:\n  legacy:\n    options:\n      apiKey: ${secret}\n      baseURL: https://example.invalid/v1\n    models: {}\n`,
      );
      fs.chmodSync(configPath, 0o644);
      const result = migrateLegacyByokProvidersOnDisk(configPath, {
        isManagedRuntime: () => true,
        shouldEnforceManagedProviderProtection: () => false,
        getManagedPreset: () => ({ provider: {}, defaultModel: "" }),
        isManagedPresetBaseUrl: () => false,
      });
      expect(result.migrated).toBe(true);
      for (const file of [configPath, result.backupPath!]) {
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        expect(fs.readFileSync(file, "utf8")).toContain(secret);
      }
    });
  },
);
