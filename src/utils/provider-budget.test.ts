import { describe, expect, it } from "vitest";
import { ProviderBudget } from "./provider-budget.js";
import { GeoAPIs } from "./apis.js";

const START = Date.UTC(2030, 0, 1);
const DAY = 86_400_000;

describe("provider budget", () => {
	it.each([
		[GeoAPIs.FREE_IP_API_DOT_COM, 1000],
		[GeoAPIs.HACK_MY_IP_DOT_COM, 1000],
		[GeoAPIs.GEOIP_VUIZ_DOT_NET, 600],
		[GeoAPIs.APIP_DOT_CC, 1000],
		[GeoAPIs.COUNTRY_DOT_IS, 100],
		[GeoAPIs.IP_ADDRESS_DETAILS_DOT_COM, 500]
	])("paces %s without bursts", (provider, interval) => {
		const budget = new ProviderBudget();
		expect(budget.reserve(provider, START)).toBe(true);
		expect(budget.reserve(provider, START)).toBe(false);
		expect(budget.reserve(provider, START + interval - 1)).toBe(false);
		expect(budget.reserve(provider, START + interval)).toBe(true);
	});

	it.each([
		[GeoAPIs.IP_ADDRESS_DETAILS_DOT_COM, 100],
		[GeoAPIs.NETWORK_TOOLS_DOT_DEV, 50]
	])(
		"caps %s daily attempts and resumes after UTC midnight",
		(provider, quota) => {
			const budget = new ProviderBudget();
			for (let i = 0; i < quota; i++)
				expect(budget.reserve(provider, START + i * 1000)).toBe(true);
			expect(budget.reserve(provider, START + quota * 1000)).toBe(false);
			expect(budget.reserve(provider, START + DAY - 1)).toBe(false);
			expect(budget.reserve(provider, START + DAY)).toBe(true);
		}
	);

	it("cannot shorten a cooldown with a later shorter failure", () => {
		const budget = new ProviderBudget();
		budget.defer(GeoAPIs.COUNTRY_DOT_IS, START + 120_000);
		budget.defer(GeoAPIs.COUNTRY_DOT_IS, START + 30_000);
		expect(budget.reserve(GeoAPIs.COUNTRY_DOT_IS, START + 119_999)).toBe(false);
		expect(budget.reserve(GeoAPIs.COUNTRY_DOT_IS, START + 120_000)).toBe(true);
	});

	it("uses next UTC day as conservative 429 fallback for daily providers", () => {
		const budget = new ProviderBudget();
		expect(
			budget.quotaRetryAt(GeoAPIs.NETWORK_TOOLS_DOT_DEV, START + 123)
		).toBe(START + DAY);
		expect(
			budget.quotaRetryAt(GeoAPIs.IP_ADDRESS_DETAILS_DOT_COM, START + 123)
		).toBe(START + DAY);
		expect(budget.quotaRetryAt(GeoAPIs.COUNTRY_DOT_IS, START + 123)).toBe(
			START + 60_123
		);
	});

	it("observed remaining quota can reduce but never increase budget", () => {
		const budget = new ProviderBudget();
		const provider = GeoAPIs.IP_ADDRESS_DETAILS_DOT_COM;
		budget.observeDailyRemaining(provider, "1", START);
		expect(budget.reserve(provider, START)).toBe(true);
		budget.observeDailyRemaining(provider, "99", START);
		expect(budget.reserve(provider, START + 1000)).toBe(false);
		expect(budget.reserve(provider, START + DAY)).toBe(true);
	});

	it.each([undefined, null, "", "bad", "-1", "101", {}, 1.5])(
		"ignores invalid quota metadata %j",
		remaining => {
			const budget = new ProviderBudget();
			budget.observeDailyRemaining(
				GeoAPIs.IP_ADDRESS_DETAILS_DOT_COM,
				remaining,
				START
			);
			expect(budget.reserve(GeoAPIs.IP_ADDRESS_DETAILS_DOT_COM, START)).toBe(
				true
			);
		}
	);
});
