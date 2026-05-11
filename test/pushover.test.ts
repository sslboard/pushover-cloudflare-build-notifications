import { describe, it, expect, vi } from "vitest";
import { buildPushoverMessage, sendPushoverNotification } from "../src/pushover";
import type { CloudflareEvent, PushoverMessage } from "../src/types";

// =============================================================================
// Test fixtures
// =============================================================================

const MOCK_ENV = {
	PUSHOVER_APP_TOKEN: "test-app-token-30chars-long-x",
	PUSHOVER_USER_KEY: "test-user-key-30chars-long-x",
};

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
// buildPushoverMessage — Success
// =============================================================================

describe("buildPushoverMessage — success", () => {
	it("builds a success message with correct title", () => {
		const event = makeEvent();
		const msg = buildPushoverMessage(event, MOCK_ENV);
		expect(msg.title).toBe("✅ Production Deploy — my-worker");
	});

	it("sets normal priority and cashregister sound", () => {
		const event = makeEvent();
		const msg = buildPushoverMessage(event, MOCK_ENV);
		expect(msg.priority).toBe(0);
		expect(msg.sound).toBe("cashregister");
	});

	it("includes branch, commit, message, author, and duration", () => {
		const event = makeEvent();
		const msg = buildPushoverMessage(event, MOCK_ENV);
		expect(msg.message).toContain("Branch: main");
		expect(msg.message).toContain("Commit: abc123d");
		expect(msg.message).toContain("Fix bug in authentication");
		expect(msg.message).toContain("Author: developer");
		expect(msg.message).toContain("Duration: 1m 16s");
	});

	it("includes dashboard URL", () => {
		const event = makeEvent();
		const msg = buildPushoverMessage(event, MOCK_ENV);
		expect(msg.url).toContain("dash.cloudflare.com");
		expect(msg.url_title).toBe("View Build");
	});

	it("labels preview deploys correctly", () => {
		const event = makeEvent({
			payload: {
				...makeEvent().payload,
				buildTriggerMetadata: {
					...makeEvent().payload.buildTriggerMetadata!,
					branch: "feature/auth",
				},
			},
		});
		const msg = buildPushoverMessage(event, MOCK_ENV);
		expect(msg.title).toBe("✅ Preview Deploy — my-worker");
	});
});

// =============================================================================
// buildPushoverMessage — Failure
// =============================================================================

describe("buildPushoverMessage — failure", () => {
	it("builds a failure message with correct title", () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.failed",
			payload: {
				...makeEvent().payload,
				buildOutcome: "failure",
				status: "failed",
			},
		});
		const msg = buildPushoverMessage(event, MOCK_ENV);
		expect(msg.title).toBe("❌ Build Failed — my-worker");
	});

	it("sets high priority and siren sound", () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.failed",
			payload: {
				...makeEvent().payload,
				buildOutcome: "failure",
				status: "failed",
			},
		});
		const msg = buildPushoverMessage(event, MOCK_ENV);
		expect(msg.priority).toBe(1);
		expect(msg.sound).toBe("siren");
	});

	it("includes trigger source", () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.failed",
			payload: {
				...makeEvent().payload,
				buildOutcome: "failure",
				status: "failed",
			},
		});
		const msg = buildPushoverMessage(event, MOCK_ENV);
		expect(msg.message).toContain("Triggered by: push_event");
	});

	it("includes View Build Logs URL title", () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.failed",
			payload: {
				...makeEvent().payload,
				buildOutcome: "failure",
				status: "failed",
			},
		});
		const msg = buildPushoverMessage(event, MOCK_ENV);
		expect(msg.url_title).toBe("View Build Logs");
	});
});

// =============================================================================
// buildPushoverMessage — Cancelled
// =============================================================================

describe("buildPushoverMessage — cancelled", () => {
	it("builds a cancelled message with correct title", () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.failed",
			payload: {
				...makeEvent().payload,
				buildOutcome: "canceled",
				status: "canceled",
			},
		});
		const msg = buildPushoverMessage(event, MOCK_ENV);
		expect(msg.title).toBe("⚠️ Build Cancelled — my-worker");
	});

	it("sets low priority and no sound", () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.failed",
			payload: {
				...makeEvent().payload,
				buildOutcome: "canceled",
				status: "canceled",
			},
		});
		const msg = buildPushoverMessage(event, MOCK_ENV);
		expect(msg.priority).toBe(-1);
		expect(msg.sound).toBeUndefined();
	});
});

// =============================================================================
// buildPushoverMessage — Fallback
// =============================================================================

describe("buildPushoverMessage — fallback", () => {
	it("handles unknown event types", () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.unknown",
			payload: { ...makeEvent().payload, buildOutcome: null, status: "unknown" },
		});
		const msg = buildPushoverMessage(event, MOCK_ENV);
		expect(msg.title).toContain("cf.workersBuilds.worker.build.unknown");
	});
});

// =============================================================================
// sendPushoverNotification
// =============================================================================

describe("sendPushoverNotification", () => {
	it("returns ok on success", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				json: () => Promise.resolve({ status: 1, request: "req-123" }),
			}),
		);

		const result = await sendPushoverNotification({
			token: "test",
			user: "test",
			title: "Test",
			message: "Hello",
		});

		expect(result.ok).toBe(true);
		expect(result.errors).toBeUndefined();
		vi.restoreAllMocks();
	});

	it("returns errors on failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				json: () =>
					Promise.resolve({
						status: 0,
						errors: ["invalid token"],
					}),
			}),
		);

		const result = await sendPushoverNotification({
			token: "bad",
			user: "test",
			title: "Test",
			message: "Hello",
		});

		expect(result.ok).toBe(false);
		expect(result.errors).toEqual(["invalid token"]);
		vi.restoreAllMocks();
	});

	it("posts to the correct endpoint", async () => {
		const fetchSpy = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({ status: 1 }),
		});
		vi.stubGlobal("fetch", fetchSpy);

		const message: PushoverMessage = {
			token: "t",
			user: "u",
			title: "T",
			message: "M",
		};

		await sendPushoverNotification(message);

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://api.pushover.net/1/messages.json",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(message),
			},
		);

		vi.restoreAllMocks();
	});
});
