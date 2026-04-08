#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IPDox } from "./index.js";

const pkg = JSON.parse(
	readFileSync(join(__dirname, "../package.json"), "utf8")
);
const VERSION: string = pkg.version;

const HELP = `
ipdox - IP geolocation lookup CLI

Usage:
  ipdox <ip>              Lookup geolocation data for an IP address
  ipdox --help, -h        Show this help message
  ipdox --version, -v     Show version number

Examples:
  ipdox 8.8.8.8           Lookup Google DNS
  ipdox 2001:4860:4860::8888   Lookup IPv6 address
  ipdox 1.1.1.1 | jq .country  Pipe to jq for filtering

Output:
  Returns JSON to stdout on success (exit code 0)
  Returns error message to stderr on failure (exit code 1)

Environment Variables:
  IPDOX_API_KEY           ip-api.com Pro API key for HTTPS support
  IPDOX_TIMEOUT           Request timeout in ms (default: 5000)
  IPDOX_RETRIES           Max retries (default: 10)
`;

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		console.log(HELP.trim());
		process.exit(args.length === 0 ? 1 : 0);
	}

	if (args.includes("--version") || args.includes("-v")) {
		console.log(VERSION);
		process.exit(0);
	}

	const ip = args[0];

	if (ip.startsWith("-")) {
		console.error(`Error: Unknown option "${ip}"`);
		console.error('Run "ipdox --help" for usage information.');
		process.exit(1);
	}

	const timeout = parseInt(process.env.IPDOX_TIMEOUT ?? "", 10);
	const retries = parseInt(process.env.IPDOX_RETRIES ?? "", 10);

	const ipdox = new IPDox({
		ipApiKey: process.env.IPDOX_API_KEY,
		requestTimeoutMs: Number.isNaN(timeout) ? undefined : timeout,
		maxRetries: Number.isNaN(retries) ? undefined : retries
	});

	try {
		const result = await ipdox.doxIP({ ip });

		if (!result) {
			console.error(`Error: Could not fetch geolocation data for "${ip}"`);
			console.error(
				"The IP address may be invalid or all providers are unavailable."
			);
			process.exit(1);
		}

		console.log(JSON.stringify(result, null, 2));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${message}`);
		process.exit(1);
	}
}

main();
