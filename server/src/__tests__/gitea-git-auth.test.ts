import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  appendGitConfigEntries,
  buildGiteaGitAuth,
  giteaGitConfigArgs,
} from "../services/gitea/git-auth.js";
import {
  giteaHostFromSettings,
  giteaHostsFromEnv,
  matchGiteaHttpRemote,
  parseGiteaHost,
  parseGiteaRepositoryUrl,
} from "../services/gitea/hosts.js";
import { selectGiteaGrant } from "../services/gitea/credentials.js";

const run = promisify(execFile);

describe("Gitea hosts", () => {
  it("parses host entries and rejects anything that is not a bare origin", () => {
    expect(parseGiteaHost("gitea.example.com")?.origin).toBe("https://gitea.example.com");
    expect(parseGiteaHost("https://Gitea.Example.com:8443/")?.origin).toBe("https://gitea.example.com:8443");
    expect(parseGiteaHost("http://192.168.2.50:3000")?.origin).toBe("http://192.168.2.50:3000");
    expect(parseGiteaHost("https://user:pw@gitea.example.com")).toBeNull();
    expect(parseGiteaHost("https://gitea.example.com/sub")).toBeNull();
    expect(parseGiteaHost("https://gitea.example.com?x=1")).toBeNull();
    expect(parseGiteaHost("ssh://gitea.example.com")).toBeNull();
  });

  it("builds HTTPS hosts from connection settings", () => {
    expect(giteaHostFromSettings({ host: "git.example.org" })?.origin).toBe("https://git.example.org");
    expect(giteaHostFromSettings({ host: "git.example.org", port: "443" })?.origin).toBe("https://git.example.org");
    expect(giteaHostFromSettings({ host: "git.example.org", port: "3000" })?.origin).toBe("https://git.example.org:3000");
    expect(giteaHostFromSettings({ host: "https://git.example.org" })).toBeNull();
    expect(giteaHostFromSettings({ host: "git.example.org", port: "99999" })).toBeNull();
  });

  it("reads PAPERCLIP_GITEA_HOSTS and matches remotes by exact origin", () => {
    const hosts = giteaHostsFromEnv({ PAPERCLIP_GITEA_HOSTS: "git.example.org, http://10.0.0.5:3000 bad/host" });
    expect(hosts.map((host) => host.origin)).toEqual(["https://git.example.org", "http://10.0.0.5:3000"]);
    expect(matchGiteaHttpRemote("https://git.example.org/a/b.git", hosts)?.origin).toBe("https://git.example.org");
    expect(matchGiteaHttpRemote("http://git.example.org/a/b.git", hosts)).toBeNull();
    expect(matchGiteaHttpRemote("https://git.example.org:8443/a/b.git", hosts)).toBeNull();
    expect(matchGiteaHttpRemote("https://tok@git.example.org/a/b.git", hosts)).toBeNull();
    expect(matchGiteaHttpRemote("https://github.com/a/b.git", hosts)).toBeNull();
  });

  it("parses repository URLs on configured hosts only", () => {
    const hosts = giteaHostsFromEnv({ PAPERCLIP_GITEA_HOSTS: "git.example.org" });
    expect(parseGiteaRepositoryUrl("https://git.example.org/team/app.git", hosts)).toMatchObject({
      fullName: "team/app", cloneUrl: "https://git.example.org/team/app.git", webUrl: "https://git.example.org/team/app",
    });
    expect(parseGiteaRepositoryUrl("https://git.example.org/team/app/", hosts)?.fullName).toBe("team/app");
    expect(parseGiteaRepositoryUrl("https://git.example.org/team", hosts)).toBeNull();
    expect(parseGiteaRepositoryUrl("https://git.example.org/team/app/src/branch/main", hosts)).toBeNull();
    expect(parseGiteaRepositoryUrl("https://git.example.org/../app", hosts)).toBeNull();
    expect(parseGiteaRepositoryUrl("https://other.example.org/team/app", hosts)).toBeNull();
  });
});

describe("Gitea git auth", () => {
  const host = parseGiteaHost("https://git.example.org:8443")!;

  it("keeps tokens out of config values and argv", () => {
    const auth = buildGiteaGitAuth([{ host, token: "s3cret-token", login: "bot", source: "server_env", secretName: null }]);
    expect(auth.env).toEqual({ PAPERCLIP_GITEA_TOKEN_0: "s3cret-token" });
    expect(auth.entries).toHaveLength(1);
    expect(auth.entries[0]![0]).toBe("credential.https://git.example.org:8443.helper");
    expect(JSON.stringify(auth.entries)).not.toContain("s3cret-token");
    expect(giteaGitConfigArgs(auth.entries).join(" ")).not.toContain("s3cret-token");
  });

  it("appends after existing GIT_CONFIG entries", () => {
    const env = appendGitConfigEntries({ GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "a", GIT_CONFIG_VALUE_0: "1",
      GIT_CONFIG_KEY_1: "b", GIT_CONFIG_VALUE_1: "2" }, [["c", "3"]]);
    expect(env).toMatchObject({ GIT_CONFIG_COUNT: "3", GIT_CONFIG_KEY_2: "c", GIT_CONFIG_VALUE_2: "3", GIT_CONFIG_KEY_0: "a" });
    expect(appendGitConfigEntries({}, [["c", "3"]])).toMatchObject({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "c" });
  });

  async function fill(helper: string, input: string, token: string) {
    // Run the helper the way git does: `sh -c '<helper without !>' sh get` with the request on stdin.
    const child = execFile("sh", ["-c", `${helper.slice(1)} "$@"`, "sh", "get"], {
      env: { PATH: process.env.PATH ?? "", PAPERCLIP_GITEA_TOKEN_0: token },
    });
    child.stdin!.end(input);
    let out = "";
    child.stdout!.on("data", (chunk) => { out += chunk; });
    await new Promise((resolve) => child.on("close", resolve));
    return out;
  }

  it("answers only for the configured protocol and host:port", async () => {
    const [[, helper]] = buildGiteaGitAuth([{ host, token: "tok", login: "bot", source: "server_env", secretName: null }]).entries as [[string, string]];
    expect(await fill(helper, "protocol=https\nhost=git.example.org:8443\n\n", "tok")).toBe("username=bot\npassword=tok\n");
    expect(await fill(helper, "protocol=http\nhost=git.example.org:8443\n\n", "tok")).toBe("");
    expect(await fill(helper, "protocol=https\nhost=git.example.org\n\n", "tok")).toBe("");
    expect(await fill(helper, "protocol=https\nhost=evil.example\n\n", "tok")).toBe("");
  });

  it("falls back to a neutral username for unusual logins", async () => {
    const [[, helper]] = buildGiteaGitAuth([{ host, token: "tok", login: "bad name';", source: "server_env", secretName: null }]).entries as [[string, string]];
    expect(await fill(helper, "protocol=https\nhost=git.example.org:8443\n\n", "tok")).toBe("username=oauth2\npassword=tok\n");
  });

  it("is accepted by git credential fill", async () => {
    const auth = buildGiteaGitAuth([{ host, token: "tok-from-env", login: null, source: "server_env", secretName: null }]);
    const env = appendGitConfigEntries({
      PATH: process.env.PATH ?? "", HOME: "/nonexistent", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0", ...auth.env,
    }, auth.entries);
    const child = execFile("git", ["credential", "fill"], { env });
    child.stdin!.end("protocol=https\nhost=git.example.org:8443\npath=team/app.git\n\n");
    let out = "";
    child.stdout!.on("data", (chunk) => { out += chunk; });
    await new Promise((resolve) => child.on("close", resolve));
    expect(out).toContain("password=tok-from-env");
    await expect(run("git", ["--version"])).resolves.toBeTruthy();
  });
});

describe("Gitea grant selection", () => {
  const base = {
    companyId: "c", connectionId: "conn", status: "active", subjectUserId: null, subjectAgentId: null,
    credentialSecretRefs: [{ configPath: "credentials.authorization", secretId: "s" }],
  } as const;
  const grant = (id: string, kind: "agent" | "user" | "organization", extra: Record<string, unknown> = {}, createdAt = 1) =>
    ({ ...base, id, kind, createdAt: new Date(createdAt), ...extra }) as never;

  it("prefers the agent's grant, then the responsible user's, then the organization's", () => {
    const grants = [
      grant("org", "organization"),
      grant("user", "user", { subjectUserId: "u1" }),
      grant("agent", "agent", { subjectAgentId: "a1" }),
    ];
    expect(selectGiteaGrant(grants, { agentId: "a1", responsibleUserId: "u1" })?.id).toBe("agent");
    expect(selectGiteaGrant(grants, { agentId: "a2", responsibleUserId: "u1" })?.id).toBe("user");
    expect(selectGiteaGrant(grants, { agentId: "a2", responsibleUserId: "u2" })?.id).toBe("org");
  });

  it("ignores inactive grants and grants without a token", () => {
    const grants = [
      grant("revoked", "organization", { status: "revoked" }),
      grant("empty", "organization", { credentialSecretRefs: [] }),
    ];
    expect(selectGiteaGrant(grants, {})).toBeNull();
  });

  it("chooses the newest of several equal grants", () => {
    expect(selectGiteaGrant([grant("old", "organization", {}, 1), grant("new", "organization", {}, 2)], {})?.id).toBe("new");
  });
});
