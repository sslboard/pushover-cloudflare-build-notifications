/**
 * Type definitions for Workers Builds events and related structures.
 *
 * Run `npx wrangler types` to generate worker-configuration.d.ts with the
 * Env type that includes your queue bindings. The Env interface below is
 * used by the Pushover client and helper modules.
 */

// =============================================================================
// ENVIRONMENT
// =============================================================================

export interface Env {
	PUSHOVER_APP_TOKEN: string;
	PUSHOVER_USER_KEY: string;
}

// =============================================================================
// CLOUDFLARE BUILD EVENTS
// =============================================================================

export interface CloudflareEvent {
	type: string;
	source: {
		type: string;
		workerName?: string;
	};
	payload: {
		buildUuid: string;
		status: string;
		buildOutcome: "success" | "failure" | "canceled" | "cancelled" | null;
		createdAt: string;
		initializingAt?: string;
		runningAt?: string;
		stoppedAt?: string;
		buildTriggerMetadata?: BuildTriggerMetadata;
	};
	metadata: {
		accountId: string;
		eventSubscriptionId: string;
		eventSchemaVersion: number;
		eventTimestamp: string;
	};
}

export interface BuildTriggerMetadata {
	buildTriggerSource: string;
	branch: string;
	commitHash: string;
	commitMessage: string;
	author: string;
	buildCommand: string;
	deployCommand: string;
	rootDirectory: string;
	repoName: string;
	providerAccountName: string;
	providerType: string;
}

// =============================================================================
// BUILD STATUS
// =============================================================================

export interface BuildStatus {
	isSucceeded: boolean;
	isFailed: boolean;
	isCancelled: boolean;
}

// =============================================================================
// PUSHOVER
// =============================================================================

export interface PushoverMessage {
	token: string;
	user: string;
	title: string;
	message: string;
	priority?: number;
	sound?: string;
	url?: string;
	url_title?: string;
}

export interface PushoverResponse {
	status: number;
	errors?: string[];
	request?: string;
}
