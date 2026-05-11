import { describe, it, expect } from "vitest";
import {
	getBuildStatus,
	isProductionBranch,
	extractAuthorName,
	getCommitUrl,
	getDashboardUrl,
	calculateDuration,
	formatDuration,
} from "../src/helpers";
import type { CloudflareEvent } from "../src/types";

// =============================================================================
// Test fixtures
// =============================================================================

function makeEvent(overrides: Partial<CloudflareEvent> = {}): CloudflareEvent {
	return {
		type: "cf.workersBuilds.worker.build.succeeded",
		source: { type: "workersBuilds.worker", workerName: "my-worker" },
		payload: {
			buildUuid: "build-1234-5678-90ab",
			status: "success",
			buildOutcome: "success",
			createdAt: "2025-05-01T02:48:57.000Z",
			stoppedAt: "2025-05-01T02:50:13.000Z",
			buildTriggerMetadata: {
				buildTriggerSource: "push_event",
				branch: "main",
				commitHash: "abc123def456",
				commitMessage: "Fix bug in authentication",
				author: "developer@example.com",
				buildCommand: "npm run build",
				deployCommand: "wrangler deploy",
				rootDirectory: "/",
				repoName: "my-worker-repo",
				providerAccountName: "github-user",
				providerType: "github",
			},
		},
		metadata: {
			accountId: "acc-1234",
			eventSubscriptionId: "sub-5678",
			eventSchemaVersion: 1,
			eventTimestamp: "2025-05-01T02:48:57.000Z",
		},
		...overrides,
	};
}

// =============================================================================
// getBuildStatus
// =============================================================================

describe("getBuildStatus", () => {
	it("detects succeeded event", () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.succeeded",
			payload: { ...makeEvent().payload, buildOutcome: "success", status: "success" },
		});
		const status = getBuildStatus(event);
		expect(status).toEqual({ isSucceeded: true, isFailed: false, isCancelled: false });
	});

	it("detects failed event", () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.failed",
			payload: { ...makeEvent().payload, buildOutcome: "failure", status: "failed" },
		});
		const status = getBuildStatus(event);
		expect(status).toEqual({ isSucceeded: false, isFailed: true, isCancelled: false });
	});

	it("detects cancelled event (single L)", () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.failed",
			payload: { ...makeEvent().payload, buildOutcome: "canceled", status: "canceled" },
		});
		const status = getBuildStatus(event);
		expect(status).toEqual({ isSucceeded: false, isFailed: false, isCancelled: true });
	});

	it("detects cancelled event (double L)", () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.failed",
			payload: { ...makeEvent().payload, buildOutcome: "cancelled", status: "cancelled" },
		});
		const status = getBuildStatus(event);
		expect(status).toEqual({ isSucceeded: false, isFailed: false, isCancelled: true });
	});

	it("detects cancelled event via type", () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.canceled",
			payload: { ...makeEvent().payload, buildOutcome: "canceled", status: "canceled" },
		});
		const status = getBuildStatus(event);
		expect(status).toEqual({ isSucceeded: false, isFailed: false, isCancelled: true });
	});

	it("handles unknown event type", () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.started",
			payload: { ...makeEvent().payload, buildOutcome: null, status: "running" },
		});
		const status = getBuildStatus(event);
		expect(status).toEqual({ isSucceeded: false, isFailed: false, isCancelled: false });
	});
});

// =============================================================================
// isProductionBranch
// =============================================================================

describe("isProductionBranch", () => {
	it.each(["main", "master", "production", "prod", "Main", "MASTER"])(
		"returns true for %s",
		(branch) => {
			expect(isProductionBranch(branch)).toBe(true);
		},
	);

	it.each(["feature/auth", "staging", "dev", "release/v2"])(
		"returns false for %s",
		(branch) => {
			expect(isProductionBranch(branch)).toBe(false);
		},
	);

	it("returns true for undefined", () => {
		expect(isProductionBranch(undefined)).toBe(true);
	});
});

// =============================================================================
// extractAuthorName
// =============================================================================

describe("extractAuthorName", () => {
	it("extracts name from email", () => {
		expect(extractAuthorName("john.doe@example.com")).toBe("john.doe");
	});

	it("returns plain name as-is", () => {
		expect(extractAuthorName("johndoe")).toBe("johndoe");
	});

	it("returns null for undefined", () => {
		expect(extractAuthorName(undefined)).toBe(null);
	});

	it("handles @-prefixed name", () => {
		expect(extractAuthorName("@username")).toBe("@username");
	});
});

// =============================================================================
// getCommitUrl
// =============================================================================

describe("getCommitUrl", () => {
	it("generates GitHub commit URL", () => {
		const event = makeEvent();
		expect(getCommitUrl(event)).toBe(
			"https://github.com/github-user/my-worker-repo/commit/abc123def456",
		);
	});

	it("generates GitLab commit URL", () => {
		const event = makeEvent({
			payload: {
				...makeEvent().payload,
				buildTriggerMetadata: {
					...makeEvent().payload.buildTriggerMetadata!,
					providerType: "gitlab",
				},
			},
		});
		expect(getCommitUrl(event)).toBe(
			"https://gitlab.com/github-user/my-worker-repo/-/commit/abc123def456",
		);
	});

	it("returns null for unknown provider", () => {
		const event = makeEvent({
			payload: {
				...makeEvent().payload,
				buildTriggerMetadata: {
					...makeEvent().payload.buildTriggerMetadata!,
					providerType: "bitbucket",
				},
			},
		});
		expect(getCommitUrl(event)).toBeNull();
	});

	it("returns null when metadata is missing", () => {
		const event = makeEvent({
			payload: { ...makeEvent().payload, buildTriggerMetadata: undefined },
		});
		expect(getCommitUrl(event)).toBeNull();
	});
});

// =============================================================================
// getDashboardUrl
// =============================================================================

describe("getDashboardUrl", () => {
	it("generates dashboard URL", () => {
		const event = makeEvent();
		expect(getDashboardUrl(event)).toBe(
			"https://dash.cloudflare.com/acc-1234/workers/services/view/my-worker/production/builds/build-1234-5678-90ab",
		);
	});

	it("returns null when accountId is missing", () => {
		const event = makeEvent({
			metadata: { ...makeEvent().metadata, accountId: "" },
		});
		expect(getDashboardUrl(event)).toBeNull();
	});

	it("returns null when buildUuid is missing", () => {
		const event = makeEvent({
			payload: { ...makeEvent().payload, buildUuid: "" },
		});
		expect(getDashboardUrl(event)).toBeNull();
	});
});

// =============================================================================
// calculateDuration
// =============================================================================

describe("calculateDuration", () => {
	it("calculates duration in seconds", () => {
		const event = makeEvent();
		// 02:48:57 → 02:50:13 = 76 seconds
		expect(calculateDuration(event)).toBe(76);
	});

	it("returns null when stoppedAt is missing", () => {
		const event = makeEvent({
			payload: { ...makeEvent().payload, stoppedAt: undefined },
		});
		expect(calculateDuration(event)).toBeNull();
	});

	it("returns null when createdAt is missing", () => {
		const event = makeEvent({
			payload: { ...makeEvent().payload, createdAt: "" },
		});
		expect(calculateDuration(event)).toBeNull();
	});
});

// =============================================================================
// formatDuration
// =============================================================================

describe("formatDuration", () => {
	it("formats seconds only", () => {
		expect(formatDuration(45)).toBe("45s");
	});

	it("formats minutes and seconds", () => {
		expect(formatDuration(76)).toBe("1m 16s");
	});

	it("formats hours, minutes and seconds", () => {
		expect(formatDuration(3600)).toBe("1h 0m 0s");
	});

	it("formats complex duration", () => {
		expect(formatDuration(3723)).toBe("1h 2m 3s");
	});
});
