import { GeoAPIs } from "./apis.js";

type Limit = { intervalMs: number; daily?: number };
// Conservative published limits; unknown quotas still get a small burst guard.
const LIMITS: Record<GeoAPIs, Limit> = {
	[GeoAPIs.FREE_IP_API_DOT_COM]: { intervalMs: 1000 },
	[GeoAPIs.IP_QUERY_DOT_IO]: { intervalMs: 100 },
	[GeoAPIs.GEO_JS_DOT_IO]: { intervalMs: 100 },
	[GeoAPIs.HACK_MY_IP_DOT_COM]: { intervalMs: 1000 },
	[GeoAPIs.GEOIP_VUIZ_DOT_NET]: { intervalMs: 600 },
	[GeoAPIs.APIP_DOT_CC]: { intervalMs: 1000 },
	[GeoAPIs.COUNTRY_DOT_IS]: { intervalMs: 100 },
	[GeoAPIs.IP_INFO_DOT_COM]: { intervalMs: 100 },
	[GeoAPIs.IP_ADDRESS_DETAILS_DOT_COM]: { intervalMs: 500, daily: 100 },
	[GeoAPIs.NETWORK_TOOLS_DOT_DEV]: { intervalMs: 1000, daily: 50 },
	[GeoAPIs.IP_HYPHEN_API_DOT_COM]: { intervalMs: 100 }
};

type Usage = { nextAt: number; day: number; count: number };
const DAY_MS = 86_400_000;

// Synchronous reservation before HTTP dispatch avoids concurrent overspending.
// Shared by SDK instances in this module, not across processes or duplicate copies.
export class ProviderBudget {
	private usage = new Map<GeoAPIs, Usage>();

	reserve(provider: GeoAPIs, now = Date.now()): boolean {
		const limit = LIMITS[provider];
		const day = Math.floor(now / DAY_MS);
		const previous = this.usage.get(provider);
		const count = previous?.day === day ? previous.count : 0;
		if (
			(previous?.nextAt ?? 0) > now ||
			(limit.daily !== undefined && count >= limit.daily)
		)
			return false;
		this.usage.set(provider, {
			nextAt: now + limit.intervalMs,
			day,
			count: count + 1
		});
		return true;
	}

	quotaRetryAt(provider: GeoAPIs, now = Date.now()): number {
		return LIMITS[provider].daily === undefined
			? now + 60_000
			: (Math.floor(now / DAY_MS) + 1) * DAY_MS;
	}

	observeDailyRemaining(
		provider: GeoAPIs,
		remaining: unknown,
		now = Date.now()
	): void {
		const daily = LIMITS[provider].daily;
		if (
			daily === undefined ||
			!["string", "number"].includes(typeof remaining) ||
			!/^\d+$/.test(String(remaining))
		)
			return;
		const count = daily - Number(remaining);
		if (count < 0 || count > daily) return;
		const day = Math.floor(now / DAY_MS);
		const previous = this.usage.get(provider);
		this.usage.set(provider, {
			nextAt: previous?.nextAt ?? 0,
			day,
			count: Math.max(previous?.day === day ? previous.count : 0, count)
		});
	}

	defer(provider: GeoAPIs, until: number): void {
		const previous = this.usage.get(provider);
		this.usage.set(provider, {
			nextAt: Math.max(previous?.nextAt ?? 0, until),
			day: previous?.day ?? Math.floor(Date.now() / DAY_MS),
			count: previous?.count ?? 0
		});
	}
}

export const sharedProviderBudget = new ProviderBudget();
