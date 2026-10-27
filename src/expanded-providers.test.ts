import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { IPDox, type IPDOXResponse } from "./index.js";
import { GeoAPIs } from "./utils/apis.js";
import { ProviderBudget } from "./utils/provider-budget.js";
import type { LRUCache } from "lru-cache";

vi.mock("axios");
const mockedAxios = axios as unknown as { create: ReturnType<typeof vi.fn> };
let get: ReturnType<typeof vi.fn>;
const IP = "192.0.2.1";
const normalized = (ip = IP): IPDOXResponse => ({
	ip,
	country: "ES",
	city: "",
	continent: "EU",
	latitude: 0,
	longitude: 0,
	source: "fixture"
});
const fixtures = {
	fetchCountryDotIs: {
		ip: IP,
		country: "ES",
		city: null,
		continent: "EU",
		postal: null,
		location: { latitude: 0, longitude: -2, time_zone: "Europe/Madrid" },
		asn: { organization: "Fixture ASN" }
	},
	fetchIPInfoDotCom: {
		ip: IP,
		country: "ES",
		city: null,
		continent: "EU",
		latitude: 0,
		longitude: -2,
		postal: null,
		timezone: "Europe/Madrid",
		isp: "Fixture ISP",
		is_anycast: true,
		user_type: "hosting"
	},
	fetchIPAddressDetailsDotCom: {
		ip: IP,
		country_code: "ES",
		city: null,
		continent_code: "EU",
		latitude: 0,
		longitude: -2,
		postal: null,
		org: "Fixture ASN",
		timezone: "Europe/Madrid"
	},
	fetchNetworkToolsDotDev: {
		ip: IP,
		geo: {
			country: "Spain",
			countryCode: "ES",
			city: null,
			continentCode: "EU",
			lat: 0,
			lon: -2,
			zipcode: "48000"
		},
		asn: { org: "Fixture ASN" }
	}
};
type Method = keyof typeof fixtures;
type Internals = Record<Method, (ip: string) => Promise<IPDOXResponse>> & {
	cache: LRUCache<string, IPDOXResponse>;
	providerBudget: ProviderBudget;
	providerOrder?: GeoAPIs[];
	providerCursor: number;
	fetchFromProvider(provider: GeoAPIs, ip: string): Promise<IPDOXResponse>;
	shuffleProviders(providers: GeoAPIs[]): GeoAPIs[];
	waitWithJitter(): Promise<void>;
};
const seam = (client: InstanceType<typeof IPDox>) =>
	client as unknown as Internals;
function client() {
	const value = new IPDox();
	seam(value).providerBudget = new ProviderBudget();
	vi.spyOn(seam(value), "shuffleProviders").mockImplementation(
		providers => providers
	);
	vi.spyOn(seam(value), "waitWithJitter").mockResolvedValue();
	return value;
}
const cases = [
	[
		"fetchCountryDotIs",
		"country.is",
		`https://api.country.is/${IP}?fields=city,continent,postal,location,asn`
	],
	["fetchIPInfoDotCom", "ip-info.com", `https://ip-info.com/json?ip=${IP}`],
	[
		"fetchIPAddressDetailsDotCom",
		"ipaddressdetails.com",
		`https://www.ipaddressdetails.com/api/v1/ip/${IP}`
	],
	[
		"fetchNetworkToolsDotDev",
		"networktools.dev",
		`https://api.networktools.dev/v1/ip/location?ip=${IP}`
	]
] as const;
beforeEach(() => {
	get = vi.fn();
	mockedAxios.create = vi.fn(() => ({ get }));
});
afterEach(() => vi.restoreAllMocks());

describe("additional keyless adapters", () => {
	it.each(cases)(
		"normalizes %s without credentials or invented risk flags",
		async (method, source, url) => {
			get.mockResolvedValue({ data: fixtures[method] });
			const result = await seam(client())[method](IP);
			expect(result).toMatchObject({
				ip: IP,
				country: "ES",
				continent: "EU",
				city: "",
				latitude: 0,
				longitude: -2,
				source
			});
			expect(result.proxy).toBeUndefined();
			expect(result.isHosting).toBeUndefined();
			expect(result.proxyInfo).toBeUndefined();
			expect(get).toHaveBeenCalledWith(url);
		}
	);

	it.each(cases)(
		"rejects incomplete or wrong-IP payloads from %s",
		async method => {
			const value = client();
			for (const data of [{}, { ...fixtures[method], ip: "192.0.2.2" }]) {
				get.mockResolvedValueOnce({ data });
				await expect(seam(value)[method](IP)).rejects.toThrow();
				expect(seam(value).cache.has(IP)).toBe(false);
			}
		}
	);

	it.each(cases)(
		"encodes IPv6 for %s and validates equivalent forms",
		async (method, _source, url) => {
			const ip = "2001:db8::1";
			get.mockResolvedValue({
				data: { ...fixtures[method], ip: "2001:0db8:0:0:0:0:0:1" }
			});
			expect((await seam(client())[method](ip)).country).toBe("ES");
			expect(get).toHaveBeenCalledWith(url.replace(IP, encodeURIComponent(ip)));
		}
	);

	it("never caches IP Info despite valid data and does not infer hosting from user_type", async () => {
		get.mockResolvedValue({ data: fixtures.fetchIPInfoDotCom });
		const value = client();
		await seam(value).fetchIPInfoDotCom(IP);
		await seam(value).fetchIPInfoDotCom(IP);
		expect(get).toHaveBeenCalledTimes(2);
		expect(seam(value).cache.has(IP)).toBe(false);
	});

	it.each([
		"fetchCountryDotIs",
		"fetchIPAddressDetailsDotCom",
		"fetchNetworkToolsDotDev"
	] as const)(
		"caps %s cache to an hour without extending the configured TTL",
		async method => {
			get.mockResolvedValue({ data: fixtures[method] });
			for (const configured of [500, 43_200_000, 0]) {
				const value = new IPDox({ cacheMaxAge: configured });
				await seam(value)[method](IP);
				expect(seam(value).cache.getRemainingTTL(IP)).toBeLessThanOrEqual(
					configured > 0 ? Math.min(configured, 3_600_000) : 3_600_000
				);
				expect(seam(value).cache.getRemainingTTL(IP)).toBeGreaterThan(0);
			}
		}
	);

	it("reads IP Address Details remaining daily quota even on the last successful response", async () => {
		const value = client();
		get.mockResolvedValue({
			data: fixtures.fetchIPAddressDetailsDotCom,
			headers: { "x-ratelimit-remaining-day": "0" }
		});
		await seam(value).fetchIPAddressDetailsDotCom(IP);
		expect(
			seam(value).providerBudget.reserve(GeoAPIs.IP_ADDRESS_DETAILS_DOT_COM)
		).toBe(false);
	});

	it("supports NetworkTools documented ISO country shape but rejects a country name alone", async () => {
		get.mockResolvedValueOnce({
			data: { ip: IP, geo: { country: "ES", lat: 0, lon: 0 } }
		});
		expect((await seam(client()).fetchNetworkToolsDotDev(IP)).continent).toBe(
			"EU"
		);
		get.mockResolvedValueOnce({
			data: { ip: IP, geo: { country: "Spain", lat: 0, lon: 0 } }
		});
		await expect(seam(client()).fetchNetworkToolsDotDev(IP)).rejects.toThrow();
	});
});

describe("balanced dispatch", () => {
	it("rotates all ten providers, including the former fallback group", async () => {
		let now = Date.UTC(2030, 0, 1);
		vi.spyOn(Date, "now").mockImplementation(() => now);
		const value = client();
		const dispatch = vi
			.spyOn(seam(value), "fetchFromProvider")
			.mockImplementation(async (_provider, ip) => normalized(ip));
		for (let i = 0; i < 20; i++) {
			await value.doxIP({ ip: `192.0.2.${i + 1}` });
			now += 1000;
		}
		const providers = dispatch.mock.calls.map(([provider]) => provider);
		expect(new Set(providers.slice(0, 10)).size).toBe(10);
		expect(providers.slice(10)).toEqual(providers.slice(0, 10));
		expect(seam(value).shuffleProviders).toHaveBeenCalledTimes(1);
	});

	it("reserves before awaiting, so concurrent clients share limits without overspending", async () => {
		const first = client();
		const second = client();
		const budget = new ProviderBudget();
		seam(first).providerBudget = budget;
		seam(second).providerBudget = budget;
		let release!: (response: IPDOXResponse) => void;
		const one = vi.spyOn(seam(first), "fetchFromProvider").mockImplementation(
			() =>
				new Promise(resolve => {
					release = resolve;
				})
		);
		const two = vi
			.spyOn(seam(second), "fetchFromProvider")
			.mockResolvedValue(normalized("192.0.2.2"));
		const pending = first.doxIP({ ip: IP });
		await second.doxIP({ ip: "192.0.2.2" });
		expect(one.mock.calls[0][0]).toBe(GeoAPIs.FREE_IP_API_DOT_COM);
		expect(two.mock.calls[0][0]).toBe(GeoAPIs.IP_QUERY_DOT_IO);
		release(normalized());
		await pending;
	});

	it("new instances share the module budget instead of resetting it", () => {
		expect(seam(new IPDox()).providerBudget).toBe(
			seam(new IPDox()).providerBudget
		);
	});

	it("shares a 429 cooldown across clients and skips the exhausted provider", async () => {
		const first = client();
		const second = client();
		seam(second).providerBudget = seam(first).providerBudget;
		seam(first).providerOrder = [GeoAPIs.COUNTRY_DOT_IS];
		seam(second).providerOrder = [
			GeoAPIs.COUNTRY_DOT_IS,
			GeoAPIs.IP_QUERY_DOT_IO
		];
		vi.spyOn(seam(first), "fetchFromProvider").mockRejectedValue({
			response: { status: 429, headers: { "retry-after": "3600" } }
		});
		await first.doxIP({ ip: IP });
		const dispatch = vi
			.spyOn(seam(second), "fetchFromProvider")
			.mockResolvedValue(normalized());
		await second.doxIP({ ip: IP });
		expect(dispatch.mock.calls[0][0]).toBe(GeoAPIs.IP_QUERY_DOT_IO);
	});

	it("does not spend quota or rotate on a cache hit", async () => {
		const value = client();
		seam(value).cache.set(IP, normalized());
		const reserve = vi.spyOn(seam(value).providerBudget, "reserve");
		expect(await value.doxIP({ ip: IP })).toEqual(normalized());
		expect(reserve).not.toHaveBeenCalled();
		expect(seam(value).providerCursor).toBe(0);
	});

	it("fails closed without HTTP when no budget is available", async () => {
		const value = client();
		vi.spyOn(seam(value).providerBudget, "reserve").mockReturnValue(false);
		expect(await value.doxIP({ ip: IP })).toBeUndefined();
		expect(get).not.toHaveBeenCalled();
	});
});
