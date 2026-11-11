import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGiteaHost } from "../services/gitea/hosts.js";
import { gitHubApiBase, gitHubCommitApiPath, giteaHostFor, registerGiteaHosts, resolveRawGitHubUrl } from "../services/github-fetch.js";

describe("GitHub fetch helpers on Gitea hosts", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps GitHub and GitHub Enterprise behavior for other hosts", () => {
    expect(gitHubApiBase("github.com")).toBe("https://api.github.com");
    expect(gitHubApiBase("ghe.example.com")).toBe("https://ghe.example.com/api/v3");
    expect(gitHubCommitApiPath("github.com", "o", "r", "main")).toBe("/repos/o/r/commits/main");
    expect(resolveRawGitHubUrl("github.com", "o", "r", "main", "a/SKILL.md")).toBe("https://raw.githubusercontent.com/o/r/main/a/SKILL.md");
  });

  it("uses Gitea's API base, commit path and raw routes for registered hosts", () => {
    registerGiteaHosts([parseGiteaHost("https://git.example.org:3443")!]);
    expect(giteaHostFor("GIT.example.org")?.origin).toBe("https://git.example.org:3443");
    expect(gitHubApiBase("git.example.org")).toBe("https://git.example.org:3443/api/v1");
    expect(gitHubCommitApiPath("git.example.org", "o", "r", "main")).toBe("/repos/o/r/git/commits/main");
    const sha = "5bdcaaacbfceac896a9ec72e03d003c56e13b5e6";
    expect(resolveRawGitHubUrl("git.example.org", "o", "r", sha, "/skills/a/SKILL.md"))
      .toBe(`https://git.example.org:3443/o/r/raw/commit/${sha}/skills/a/SKILL.md`);
    expect(resolveRawGitHubUrl("git.example.org", "o", "r", "main", "SKILL.md"))
      .toBe("https://git.example.org:3443/o/r/raw/main/SKILL.md");
  });
});
