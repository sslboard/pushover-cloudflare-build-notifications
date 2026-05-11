/**
 * Helper functions for processing build events.
 */

import type { CloudflareEvent, BuildStatus } from "./types";

// =============================================================================
// BUILD STATUS
// =============================================================================

/**
 * Determines the build status from a Cloudflare event.
 * Handles both "canceled" and "cancelled" spellings.
 */
export function getBuildStatus(event: CloudflareEvent): BuildStatus {
	const buildOutcome = event.payload?.buildOutcome;
	const isCancelled =
		buildOutcome === "canceled" ||
		buildOutcome === "cancelled" ||
		event.type?.includes("canceled") ||
		event.type?.includes("cancelled");
	const isFailed = event.type?.includes("failed") && !isCancelled;
	const isSucceeded = event.type?.includes("succeeded");

	return { isSucceeded, isFailed, isCancelled };
}

// =============================================================================
// BRANCH DETECTION
// =============================================================================

const PRODUCTION_BRANCHES = ["main", "master", "production", "prod"];

/**
 * Determines if a branch is a production branch.
 * Returns true for main, master, production, prod (case-insensitive).
 * Returns true for undefined (defaults to production).
 */
export function isProductionBranch(branch: string | undefined): boolean {
	if (!branch) return true;
	return PRODUCTION_BRANCHES.includes(branch.toLowerCase());
}

// =============================================================================
// METADATA EXTRACTION
// =============================================================================

/**
 * Extracts the author name from an email address.
 * "john.doe@example.com" → "john.doe"
 * "johndoe" → "johndoe"
 */
export function extractAuthorName(author: string | undefined): string | null {
	if (!author) return null;
	if (author.includes("@")) {
		const name = author.split("@")[0];
		return name || author;
	}
	return author;
}

/**
 * Generates a commit URL for GitHub or GitLab.
 * Returns null for unsupported providers or missing metadata.
 */
export function getCommitUrl(event: CloudflareEvent): string | null {
	const meta = event.payload?.buildTriggerMetadata;
	if (!meta?.repoName || !meta?.commitHash || !meta?.providerAccountName) {
		return null;
	}

	if (meta.providerType === "github") {
		return `https://github.com/${meta.providerAccountName}/${meta.repoName}/commit/${meta.commitHash}`;
	}
	if (meta.providerType === "gitlab") {
		return `https://gitlab.com/${meta.providerAccountName}/${meta.repoName}/-/commit/${meta.commitHash}`;
	}
	return null;
}

/**
 * Generates a Cloudflare dashboard URL for a build.
 */
export function getDashboardUrl(event: CloudflareEvent): string | null {
	const accountId = event.metadata?.accountId;
	const buildUuid = event.payload?.buildUuid;
	const workerName =
		event.source?.workerName ||
		event.payload?.buildTriggerMetadata?.repoName ||
		"worker";

	if (!accountId || !buildUuid) return null;

	return `https://dash.cloudflare.com/${accountId}/workers/services/view/${workerName}/production/builds/${buildUuid}`;
}

// =============================================================================
// DURATION
// =============================================================================

/**
 * Calculates build duration in seconds from createdAt to stoppedAt.
 * Returns null if timestamps are missing or invalid.
 */
export function calculateDuration(event: CloudflareEvent): number | null {
	const created = event.payload?.createdAt;
	const stopped = event.payload?.stoppedAt;

	if (!created || !stopped) return null;

	const start = Date.parse(created);
	const end = Date.parse(stopped);

	if (isNaN(start) || isNaN(end)) return null;

	return Math.round((end - start) / 1000);
}

/**
 * Formats a duration in seconds as a human-readable string.
 * 76 → "1m 16s"
 * 3600 → "1h 0m 0s"
 */
export function formatDuration(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;

	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}
