/**
 * Pushover API integration for build notifications.
 *
 * @see https://pushover.net/api
 */

import type { Env, CloudflareEvent, PushoverMessage, PushoverResponse } from "./types";
import {
	getBuildStatus,
	isProductionBranch,
	extractAuthorName,
	getDashboardUrl,
	calculateDuration,
	formatDuration,
} from "./helpers";

// =============================================================================
// PUSHOVER API ENDPOINT
// =============================================================================

const PUSHOVER_API_URL = "https://api.pushover.net/1/messages.json";

// =============================================================================
// MESSAGE BUILDERS
// =============================================================================

function buildSuccessMessage(event: CloudflareEvent, env: Env): PushoverMessage {
	const workerName = event.source?.workerName || "Worker";
	const meta = event.payload?.buildTriggerMetadata;
	const isProduction = isProductionBranch(meta?.branch);
	const deployType = isProduction ? "Production" : "Preview";
	const dashUrl = getDashboardUrl(event);
	const duration = calculateDuration(event);

	const lines: string[] = [];

	if (meta?.branch) lines.push(`Branch: ${meta.branch}`);
	if (meta?.commitHash) {
		const short = meta.commitHash.substring(0, 7);
		lines.push(`Commit: ${short}`);
	}
	if (meta?.commitMessage) lines.push(meta.commitMessage);

	const author = extractAuthorName(meta?.author);
	if (author) lines.push(`Author: ${author}`);

	if (duration !== null) lines.push(`Duration: ${formatDuration(duration)}`);

	return {
		token: env.PUSHOVER_APP_TOKEN,
		user: env.PUSHOVER_USER_KEY,
		title: `✅ ${deployType} Deploy — ${workerName}`,
		message: lines.join("\n"),
		priority: 0,
		sound: "cashregister",
		...(dashUrl && { url: dashUrl, url_title: "View Build" }),
	};
}

function buildFailureMessage(event: CloudflareEvent, env: Env): PushoverMessage {
	const workerName = event.source?.workerName || "Worker";
	const meta = event.payload?.buildTriggerMetadata;
	const dashUrl = getDashboardUrl(event);

	const lines: string[] = [];

	if (meta?.branch) lines.push(`Branch: ${meta.branch}`);
	if (meta?.commitHash) {
		const short = meta.commitHash.substring(0, 7);
		lines.push(`Commit: ${short}`);
	}
	if (meta?.commitMessage) lines.push(meta.commitMessage);

	const author = extractAuthorName(meta?.author);
	if (author) lines.push(`Author: ${author}`);

	if (meta?.buildTriggerSource) lines.push(`Triggered by: ${meta.buildTriggerSource}`);

	return {
		token: env.PUSHOVER_APP_TOKEN,
		user: env.PUSHOVER_USER_KEY,
		title: `❌ Build Failed — ${workerName}`,
		message: lines.join("\n"),
		priority: 1,
		sound: "siren",
		...(dashUrl && { url: dashUrl, url_title: "View Build Logs" }),
	};
}

function buildCancelledMessage(event: CloudflareEvent, env: Env): PushoverMessage {
	const workerName = event.source?.workerName || "Worker";
	const meta = event.payload?.buildTriggerMetadata;

	const lines: string[] = [];

	if (meta?.branch) lines.push(`Branch: ${meta.branch}`);
	if (meta?.commitHash) {
		const short = meta.commitHash.substring(0, 7);
		lines.push(`Commit: ${short}`);
	}
	if (meta?.commitMessage) lines.push(meta.commitMessage);

	const author = extractAuthorName(meta?.author);
	if (author) lines.push(`Author: ${author}`);

	return {
		token: env.PUSHOVER_APP_TOKEN,
		user: env.PUSHOVER_USER_KEY,
		title: `⚠️ Build Cancelled — ${workerName}`,
		message: lines.join("\n"),
		priority: -1,
	};
}

// =============================================================================
// MAIN EXPORTS
// =============================================================================

/**
 * Builds a Pushover message from a build event.
 */
export function buildPushoverMessage(event: CloudflareEvent, env: Env): PushoverMessage {
	const status = getBuildStatus(event);

	if (status.isSucceeded) return buildSuccessMessage(event, env);
	if (status.isFailed) return buildFailureMessage(event, env);
	if (status.isCancelled) return buildCancelledMessage(event, env);

	// Fallback for unknown event types
	const workerName = event.source?.workerName || "Worker";
	return {
		token: env.PUSHOVER_APP_TOKEN,
		user: env.PUSHOVER_USER_KEY,
		title: `📢 ${event.type || "Unknown event"}`,
		message: `Worker: ${workerName}`,
	};
}

/**
 * Sends a Pushover notification via the REST API.
 *
 * @see https://pushover.net/api
 */
export async function sendPushoverNotification(
	message: PushoverMessage,
): Promise<{ ok: boolean; errors?: string[] }> {
	const response = await fetch(PUSHOVER_API_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(message),
	});

	const data: PushoverResponse = await response.json();

	if (data.status !== 1) {
		return { ok: false, errors: data.errors };
	}

	return { ok: true };
}
