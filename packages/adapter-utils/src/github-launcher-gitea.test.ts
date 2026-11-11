import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { githubBrokerEnvironment, githubLauncherSource } from "./github-launcher.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function credentialFill(launcher: string, env: NodeJS.ProcessEnv, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(launcher, ["credential", "fill"], { env, timeout: 15_000 }, (error, stdout) =>
      error && !stdout ? reject(error) : resolve(stdout));
    child.stdin!.end(request);
  });
}

describe("managed git launcher with Gitea broker credentials", () => {
  it("applies the broker's Gitea helpers even when GitHub is absent, scoped to the Gitea host", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-gitea-launcher-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const managed = path.join(root, "managed");
    await mkdir(managed);
    const launcher = path.join(managed, "git");
    await writeFile(launcher, githubLauncherSource(), { mode: 0o700 });
    const helper = `!f() { ok=; proto=; while IFS= read -r l && [ -n "$l" ]; do case "$l" in 'host=git.example.org') ok=1;; 'protocol=https') proto=1;; esac; done; if [ "$1" = get ] && [ -n "$ok" ] && [ -n "$proto" ]; then printf 'username=%s\\npassword=%s\\n' 'bot' "$PAPERCLIP_GITEA_TOKEN_0"; fi; }; f`;
    const server = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        status: "absent",
        gitea: {
          configEntries: [["credential.https://git.example.org.helper", helper], ["core.sshCommand", "touch /tmp/pwned"]],
          env: { PAPERCLIP_GITEA_TOKEN_0: "gitea-secret", GH_TOKEN: "smuggled" },
        },
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address() as { port: number };
    const env = {
      ...githubBrokerEnvironment({ PAPERCLIP_GITEA_TOKEN_0: "inherited-host-token" }, {
        url: `http://127.0.0.1:${address.port}`, token: "capability",
      }),
      HOME: root, GH_CONFIG_DIR: path.join(root, "gh"),
      PATH: `${managed}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}/usr/bin${path.delimiter}/bin`,
    };
    const gitea = await credentialFill(launcher, env, "protocol=https\nhost=git.example.org\npath=team/app.git\n\n");
    expect(gitea).toContain("password=gitea-secret");
    expect(gitea).toContain("username=bot");
    const other = await credentialFill(launcher, env, "protocol=https\nhost=other.example.org\n\n").catch(() => "");
    expect(other).not.toContain("gitea-secret");
  });

  it("blanks inherited Gitea tokens in the broker environment", () => {
    const env = githubBrokerEnvironment({ PAPERCLIP_GITEA_TOKEN_0: "host", PAPERCLIP_GITEA_TOKEN_3: "host" }, { url: "", token: "" });
    expect(env.PAPERCLIP_GITEA_TOKEN_0).toBe("");
    expect(env.PAPERCLIP_GITEA_TOKEN_3).toBe("");
  });
});
