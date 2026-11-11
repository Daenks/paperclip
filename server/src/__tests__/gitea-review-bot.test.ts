import { describe, expect, it } from "vitest";
import { classifyGiteaReviewEvent } from "../services/gitea/review-bot.js";

const pr = (extra: Record<string, unknown> = {}) => ({
  number: 7,
  title: "Add feature",
  html_url: "https://git.example.org/team/app/pulls/7",
  draft: false,
  head: { sha: "1bf1aa01cc6a492ca805dbd5f30b1d226ca4038b", ref: "feature" },
  base: { ref: "main" },
  ...extra,
});

const base = { repository: { full_name: "team/app" }, sender: { login: "alice" } };

describe("classifyGiteaReviewEvent", () => {
  it("reviews opened, reopened and synchronized pull requests", () => {
    for (const action of ["opened", "reopened", "synchronized"]) {
      const decision = classifyGiteaReviewEvent("pull_request", { ...base, action, number: 7, pull_request: pr() }, "paperclip-bot");
      expect(decision.review).toBe(true);
      if (decision.review) {
        expect(decision.variables).toMatchObject({ repository: "team/app", prNumber: "7", headSha: pr().head.sha, baseRef: "main" });
        expect(decision.idempotencyKey).toBe(`gitea-review:team/app#7@${pr().head.sha}`);
      }
    }
  });

  it("ignores closed, edited and draft pull requests", () => {
    expect(classifyGiteaReviewEvent("pull_request", { ...base, action: "closed", pull_request: pr() }, "bot").review).toBe(false);
    expect(classifyGiteaReviewEvent("pull_request", { ...base, action: "edited", pull_request: pr() }, "bot").review).toBe(false);
    expect(classifyGiteaReviewEvent("pull_request", { ...base, action: "opened", pull_request: pr({ draft: true }) }, "bot").review).toBe(false);
  });

  it("reviews pull request comments that mention the bot, and only those", () => {
    const comment = (body: string) => ({ ...base, action: "created", is_pull: true, issue: { number: 7 }, pull_request: pr(),
      comment: { id: 99, body } });
    const mentioned = classifyGiteaReviewEvent("issue_comment", comment("@paperclip-bot please re-review"), "paperclip-bot");
    expect(mentioned.review).toBe(true);
    if (mentioned.review) {
      expect(mentioned.idempotencyKey).toBe("gitea-review:team/app#7:comment:99");
      expect(mentioned.variables.commentBody).toBe("@paperclip-bot please re-review");
    }
    expect(classifyGiteaReviewEvent("issue_comment", comment("thanks @paperclip-botty"), "paperclip-bot").review).toBe(false);
    expect(classifyGiteaReviewEvent("issue_comment", comment("no mention"), "paperclip-bot").review).toBe(false);
    expect(classifyGiteaReviewEvent("issue_comment", { ...comment("@paperclip-bot"), is_pull: false }, "paperclip-bot").review).toBe(false);
  });

  it("never reacts to the bot's own events", () => {
    const decision = classifyGiteaReviewEvent("pull_request",
      { ...base, sender: { login: "Paperclip-Bot" }, action: "opened", pull_request: pr() }, "paperclip-bot");
    expect(decision).toEqual({ review: false, reason: "own_event" });
  });

  it("ignores other events", () => {
    expect(classifyGiteaReviewEvent("push", { ...base }, "bot").review).toBe(false);
    expect(classifyGiteaReviewEvent(null, { ...base }, "bot").review).toBe(false);
  });
});
