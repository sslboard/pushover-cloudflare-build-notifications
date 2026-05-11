import { describe, it, expect, vi } from "vitest";
import worker from "../src/index";
import type { CloudflareEvent } from "../src/types";

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
			buildUuid: "build-1234",
			status: "success",
			buildOutcome: "success",
			createdAt: "2025-05-01T02:48:57.000Z",
			stoppedAt: "2025-05-01T02:50:13.000Z",
			buildTriggerMetadata: {
				buildTriggerSource: "push_event",
				branch: "main",
				commitHash: "abc123def456",
				commitMessage: "Fix bug",
				author: "dev@example.com",
				buildCommand: "npm run build",
				deployCommand: "wrangler deploy",
				rootDirectory: "/",
				repoName: "my-repo",
				providerAccountName: "user",
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

function makeMessage(event: CloudflareEvent) {
	return {
		body: event,
		ack: vi.fn(),
		retry: vi.fn(),
	};
}

// =============================================================================
// Queue consumer tests
// =============================================================================

describe("queue consumer", () => {
	it("acks all messages when secrets are missing", async () => {
		const events = [makeEvent()];
		const messages = events.map(makeMessage);
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		// @ts-expect-error — testing missing secrets
		await worker.queue?.({ messages }, { PUSHOVER_APP_TOKEN: "", PUSHOVER_USER_KEY: "" });

		expect(messages[0].ack).toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(
			"Missing secrets: set PUSHOVER_APP_TOKEN and PUSHOVER_USER_KEY",
		);

		consoleSpy.mockRestore();
	});

	it("acks all messages when secrets are undefined", async () => {
		const events = [makeEvent()];
		const messages = events.map(makeMessage);
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		// @ts-expect-error — testing missing secrets
		await worker.queue?.({ messages }, {});

		expect(messages[0].ack).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it("skips started events", async () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.started",
			payload: { ...makeEvent().payload, buildOutcome: null, status: "running" },
		});
		const messages = [makeMessage(event)];
		const fetchSpy = vi.fn();

		vi.stubGlobal("fetch", fetchSpy);
		// @ts-expect-error — simplified env for test
		await worker.queue?.({ messages }, MOCK_ENV);

		expect(messages[0].ack).toHaveBeenCalled();
		expect(fetchSpy).not.toHaveBeenCalled();
		vi.restoreAllMocks();
	});

	it("skips queued events", async () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.queued",
			payload: { ...makeEvent().payload, buildOutcome: null, status: "queued" },
		});
		const messages = [makeMessage(event)];
		const fetchSpy = vi.fn();

		vi.stubGlobal("fetch", fetchSpy);
		// @ts-expect-error — simplified env for test
		await worker.queue?.({ messages }, MOCK_ENV);

		expect(messages[0].ack).toHaveBeenCalled();
		expect(fetchSpy).not.toHaveBeenCalled();
		vi.restoreAllMocks();
	});

	it("sends notification for succeeded event", async () => {
		const event = makeEvent();
		const messages = [makeMessage(event)];

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ status: 1 }),
			}),
		);

		// @ts-expect-error — simplified env for test
		await worker.queue?.({ messages }, MOCK_ENV);

		expect(messages[0].ack).toHaveBeenCalled();
		expect(fetch).toHaveBeenCalledWith(
			"https://api.pushover.net/1/messages.json",
			expect.objectContaining({ method: "POST" }),
		);
		vi.restoreAllMocks();
	});

	it("sends notification for failed event", async () => {
		const event = makeEvent({
			type: "cf.workersBuilds.worker.build.failed",
			payload: { ...makeEvent().payload, buildOutcome: "failure", status: "failed" },
		});
		const messages = [makeMessage(event)];

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ status: 1 }),
			}),
		);

		// @ts-expect-error — simplified env for test
		await worker.queue?.({ messages }, MOCK_ENV);

		expect(messages[0].ack).toHaveBeenCalled();
		vi.restoreAllMocks();
	});

	it("acks invalid events gracefully", async () => {
		const messages = [{ body: { foo: "bar" }, ack: vi.fn(), retry: vi.fn() }];
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		// @ts-expect-error — testing malformed input
		await worker.queue?.({ messages }, MOCK_ENV);

		expect(messages[0].ack).toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(
			"Invalid event structure:",
			JSON.stringify({ foo: "bar" }),
		);
		consoleSpy.mockRestore();
	});

	it("retries and logs on Pushover API error", async () => {
		const event = makeEvent();
		const messages = [makeMessage(event)];
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve({ status: 0, errors: ["invalid token"] }),
			}),
		);

		// @ts-expect-error — simplified env for test
		await worker.queue?.({ messages }, MOCK_ENV);

		expect(messages[0].retry).toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(
			"Pushover API error:",
			"invalid token",
		);
		consoleSpy.mockRestore();
		vi.restoreAllMocks();
	});

	it("retries and logs on unexpected exception", async () => {
		const event = makeEvent();
		const messages = [makeMessage(event)];
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("Network error")),
		);

		// @ts-expect-error — simplified env for test
		await worker.queue?.({ messages }, MOCK_ENV);

		expect(messages[0].retry).toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(
			"Error processing message:",
			expect.any(Error),
		);
		consoleSpy.mockRestore();
		vi.restoreAllMocks();
	});

	it("processes a batch of mixed events", async () => {
		const events = [
			makeEvent({
				type: "cf.workersBuilds.worker.build.started",
				payload: { ...makeEvent().payload, buildOutcome: null, status: "running" },
			}),
			makeEvent(),
			makeEvent({
				type: "cf.workersBuilds.worker.build.failed",
				payload: { ...makeEvent().payload, buildOutcome: "failure", status: "failed" },
			}),
		];
		const messages = events.map(makeMessage);

		let callCount = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => {
					callCount++;
					return Promise.resolve({ status: 1 });
				},
			}),
		);

		// @ts-expect-error — simplified env for test
		await worker.queue?.({ messages }, MOCK_ENV);

		// Started event skipped, succeeded and failed sent
		expect(callCount).toBe(2);
		for (const msg of messages) {
			expect(msg.ack).toHaveBeenCalled();
		}
		vi.restoreAllMocks();
	});
});
