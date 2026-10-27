import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { IPDox, type IPDOXResponse } from "./index.js";
import { GeoAPIs } from "./utils/apis.js";
import { continentForCountry } from "./utils/continents.js";
import { ProviderBudget } from "./utils/provider-budget.js";

vi.mock("axios");
const mockedAxios = axios as unknown as { create: ReturnType<typeof vi.fn> };
let get: ReturnType<typeof vi.fn>;
const IP = "192.0.2.1";
const geo = () => ({
	ip: IP,
	country_code: "US",
	continent_code: "NA",
	latitude: "0",
	longitude: "0",
	organization_name: "Fixture ISP"
});
const query = () => ({
	ip: IP,
	location: {
		country_code: "ES",
		city: "Fixture",
		latitude: 0,
		longitude: -2,
		zipcode: "48000",
		timezone: "Europe/Madrid"
	},
	isp: { isp: "Fixture ISP" },
	risk: { is_vpn: false, is_tor: false, is_proxy: false, is_datacenter: true }
});
const hack = () => ({
	success: true,
	data: {
		ip: IP,
		location: {
			country: "AU",
			latitude: -27,
			longitude: 153,
			postal_code: "4000",
			timezone: "Australia/Brisbane"
		},
		network: { isp: "Fixture ISP" },
		privacy: { proxy: false, hosting: true }
	}
});
const free = () => ({
	ipVersion: 4,
	ipAddress: IP,
	countryCode: "US",
	cityName: "Fixture",
	continentCode: "NA",
	latitude: 0,
	longitude: 0,
	timeZones: ["UTC"]
});
type Internal = {
	providerBudget: ProviderBudget;
	providerCursor: number;
	fetchGeoJSDotIO(ip: string): Promise<IPDOXResponse>;
	fetchIPQueryDotIO(ip: string): Promise<IPDOXResponse>;
	fetchHackMyIPDotCom(ip: string): Promise<IPDOXResponse>;
	fetchFreeIPAPIDotCom(ip: string): Promise<IPDOXResponse>;
	fetchIPHyphenAPIDotCom(ip: string): Promise<IPDOXResponse>;
	shuffleProviders(providers: GeoAPIs[]): GeoAPIs[];
	waitWithJitter(): Promise<void>;
};
const internal = (client: InstanceType<typeof IPDox>) =>
	client as unknown as Internal;
function orderedClient(options = {}) {
	const client = new IPDox(options);
	internal(client).providerBudget = new ProviderBudget();
	vi.spyOn(internal(client), "shuffleProviders").mockImplementation(
		providers => providers
	);
	vi.spyOn(internal(client), "waitWithJitter").mockResolvedValue();
	return client;
}

beforeEach(() => {
	get = vi.fn();
	mockedAxios.create = vi.fn(() => ({ get }));
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("keyless provider adapters", () => {
	it("parses GeoJS string coordinates, keeps unknown city empty and caches by IP", async () => {
		get.mockResolvedValue({ data: geo() });
		const client = new IPDox();
		const result = await internal(client).fetchGeoJSDotIO(IP);
		expect(result).toMatchObject({
			ip: IP,
			country: "US",
			continent: "NA",
			city: "",
			latitude: 0,
			longitude: 0,
			isp: "Fixture ISP",
			source: "geojs.io"
		});
		expect(get).toHaveBeenCalledWith(
			`https://get.geojs.io/v1/ip/geo/${IP}.json`
		);
		expect(await client.doxIP({ ip: ` ${IP} ` })).toEqual(result);
		expect(get).toHaveBeenCalledTimes(1);
	});

	it("maps IPQuery nested location, risk flags and derived continent", async () => {
		get.mockResolvedValue({ data: query() });
		const result = await internal(new IPDox()).fetchIPQueryDotIO(IP);
		expect(result).toMatchObject({
			ip: IP,
			country: "ES",
			continent: "EU",
			latitude: 0,
			longitude: -2,
			proxy: false,
			isHosting: true,
			proxyInfo: { isVPN: false, isTOR: false, isProxy: false },
			zip: "48000",
			source: "ipquery.io"
		});
		expect(get).toHaveBeenCalledWith(`https://api.ipquery.io/${IP}`);
	});

	it("never fabricates missing security flags", async () => {
		const data: Record<string, unknown> = query();
		delete data.risk;
		get.mockResolvedValue({ data });
		const result = await internal(new IPDox()).fetchIPQueryDotIO(IP);
		expect(result.proxy).toBeUndefined();
		expect(result.proxyInfo).toBeUndefined();
		expect(result.isHosting).toBeUndefined();
	});

	it("does not coerce string risk flags or fill incomplete proxyInfo", async () => {
		get.mockResolvedValue({
			data: {
				...query(),
				risk: { is_vpn: false, is_proxy: "false", is_datacenter: "true" }
			}
		});
		const result = await internal(new IPDox()).fetchIPQueryDotIO(IP);
		expect(result.proxyInfo).toBeUndefined();
		expect(result.proxy).toBeUndefined();
		expect(result.isHosting).toBeUndefined();
	});

	it("maps the HackMyIP lookup envelope, not its self-IP schema", async () => {
		get.mockResolvedValue({ data: hack() });
		const result = await internal(new IPDox()).fetchHackMyIPDotCom(IP);
		expect(result).toMatchObject({
			country: "AU",
			continent: "OC",
			city: "",
			latitude: -27,
			longitude: 153,
			proxy: false,
			isHosting: true,
			source: "hackmyip.com"
		});
		expect(result.proxyInfo).toBeUndefined();
		expect(get).toHaveBeenCalledWith(
			`https://hackmyip.com/api/lookup?ip=${IP}`
		);
	});

	it("rejects an explicit HackMyIP error even with plausible data", async () => {
		get.mockResolvedValue({ data: { ...hack(), success: false } });
		await expect(
			internal(new IPDox()).fetchHackMyIPDotCom(IP)
		).rejects.toThrow();
	});

	it.each([
		"fetchGeoJSDotIO",
		"fetchIPQueryDotIO",
		"fetchHackMyIPDotCom"
	] as const)("rejects missing data in %s", async method => {
		get.mockResolvedValue({ data: {} });
		await expect(internal(new IPDox())[method](IP)).rejects.toThrow();
	});

	it.each([null, "", "12garbage", "Infinity", true, 91, -91])(
		"rejects invalid latitude %j and does not cache it",
		async latitude => {
			get
				.mockResolvedValueOnce({ data: { ...geo(), latitude } })
				.mockResolvedValueOnce({ data: geo() });
			const client = new IPDox();
			await expect(internal(client).fetchGeoJSDotIO(IP)).rejects.toThrow();
			expect((await internal(client).fetchGeoJSDotIO(IP)).latitude).toBe(0);
			expect(get).toHaveBeenCalledTimes(2);
		}
	);

	it.each([
		{ ip: "192.0.2.2" },
		{ ip: "" },
		{ country_code: "ZZ" },
		{ continent_code: "XX" },
		{ longitude: 181 },
		{ longitude: -181 }
	])("rejects invalid identity/geography %j", async change => {
		get.mockResolvedValue({ data: { ...geo(), ...change } });
		await expect(internal(new IPDox()).fetchGeoJSDotIO(IP)).rejects.toThrow();
	});

	it("accepts equivalent IPv6 forms and encodes the query address", async () => {
		const ip = "2001:db8::1";
		get.mockResolvedValue({
			data: { ...query(), ip: "2001:0db8:0000:0000:0000:0000:0000:0001" }
		});
		expect((await internal(new IPDox()).fetchIPQueryDotIO(ip)).country).toBe(
			"ES"
		);
		expect(get).toHaveBeenCalledWith(
			`https://api.ipquery.io/${encodeURIComponent(ip)}`
		);
	});

	it("uses FreeIPAPI's canonical anonymous endpoint", async () => {
		get.mockResolvedValue({ data: free() });
		expect((await internal(new IPDox()).fetchFreeIPAPIDotCom(IP)).source).toBe(
			"freeipapi.com"
		);
		expect(get).toHaveBeenCalledWith(
			`https://free.freeipapi.com/api/v1/json/${IP}`
		);
	});
});

describe("FreeIPAPI current schema", () => {
	it.each([
		["US", "NA"],
		["BR", "SA"]
	])("normalizes Americas for %s", async (countryCode, continent) => {
		get.mockResolvedValue({
			data: {
				...free(),
				countryCode,
				continentCode: "AM",
				asnOrganization: "Fixture ASN",
				isProxy: false
			}
		});
		const result = await internal(new IPDox()).fetchFreeIPAPIDotCom(IP);
		expect(result).toMatchObject({
			country: countryCode,
			continent,
			isp: "Fixture ASN",
			proxy: false
		});
	});
});

describe("provider selection and backoff", () => {
	it("only attempts ten HTTPS keyless providers once, even when all fail", async () => {
		get.mockRejectedValue(new Error("offline"));
		expect(
			await orderedClient({ maxRetries: 100 }).doxIP({ ip: IP })
		).toBeUndefined();
		const urls = get.mock.calls.map(([url]) => String(url));
		expect(urls).toHaveLength(10);
		expect(new Set(urls).size).toBe(10);
		for (const url of urls) {
			expect(url).toMatch(/^https:/);
			expect(url).not.toMatch(
				/ip-api\.com|ipwho\.is|ipapi\.co\/|ip-sonar\.com|[?&]key=/
			);
		}
	});

	it("does not dispatch paid Pro without a key, including a blank key", async () => {
		for (const ipApiKey of [undefined, "", "  "]) {
			get.mockClear();
			await expect(
				internal(new IPDox({ ipApiKey })).fetchIPHyphenAPIDotCom(IP)
			).rejects.toThrow();
			expect(get).not.toHaveBeenCalled();
		}
	});

	it("still enables Pro only with an explicit key", async () => {
		get.mockRejectedValue(new Error("offline"));
		await orderedClient({ ipApiKey: "fixture", maxRetries: 1 }).doxIP({
			ip: IP
		});
		expect(get.mock.calls[0][0]).toMatch(/^https:\/\/pro\.ip-api\.com\//);
	});

	it("falls through a failed primary provider to a valid new provider", async () => {
		get
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce({ data: query() });
		expect(
			(await orderedClient({ maxRetries: 2 }).doxIP({ ip: IP }))?.source
		).toBe("ipquery.io");
		expect(get).toHaveBeenCalledTimes(2);
	});

	it.each([0, 1, 2])("bounds network attempts to %i", async maxRetries => {
		get.mockRejectedValue(new Error("offline"));
		await orderedClient({ maxRetries }).doxIP({ ip: IP });
		expect(get).toHaveBeenCalledTimes(maxRetries);
	});

	it.each(["120", new Date(Date.UTC(2030, 0, 1, 0, 2)).toUTCString()])(
		"respects 429 Retry-After %s across lookups and recovers",
		async retryAfter => {
			vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2030, 0, 1));
			const client = orderedClient({ maxRetries: 1 });
			get.mockRejectedValueOnce({
				response: { status: 429, headers: { "retry-after": retryAfter } }
			});
			await client.doxIP({ ip: IP });
			get.mockResolvedValueOnce({ data: query() });
			expect((await client.doxIP({ ip: IP }))?.source).toBe("ipquery.io");
			vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2030, 0, 1, 0, 2, 1));
			internal(client).providerCursor = 0;
			get.mockResolvedValueOnce({
				data: { ...free(), ipAddress: "192.0.2.2" }
			});
			expect((await client.doxIP({ ip: "192.0.2.2" }))?.source).toBe(
				"freeipapi.com"
			);
		}
	);

	it("returns undefined without network when every provider is cooling down", async () => {
		get.mockRejectedValue(new Error("offline"));
		const client = orderedClient({ maxRetries: 10 });
		await client.doxIP({ ip: IP });
		expect(get).toHaveBeenCalledTimes(10);
		expect(await client.doxIP({ ip: "192.0.2.2" })).toBeUndefined();
		expect(get).toHaveBeenCalledTimes(10);
	});

	it("deduplicates concurrent lookups and serves the result from cache", async () => {
		let resolve!: (value: unknown) => void;
		get.mockImplementation(
			() =>
				new Promise(done => {
					resolve = done;
				})
		);
		const client = orderedClient();
		const first = client.doxIP({ ip: IP });
		const second = client.doxIP({ ip: IP });
		expect(get).toHaveBeenCalledTimes(1);
		resolve({ data: free() });
		expect(await first).toEqual(await second);
		expect(await client.doxIP({ ip: IP })).toEqual(await first);
		expect(get).toHaveBeenCalledTimes(1);
	});

	it("rejects HTTP errors at transport level", () => {
		new IPDox();
		const { validateStatus } = mockedAxios.create.mock.calls[0][0];
		expect(validateStatus(200)).toBe(true);
		for (const status of [301, 400, 403, 429, 500])
			expect(validateStatus(status)).toBe(false);
	});
});

describe("failure cooldown edge cases", () => {
	it.each([undefined, "invalid", "-1", "0"])(
		"uses a safe 60-second fallback for Retry-After %s",
		async retryAfter => {
			const clock = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2030, 0, 1));
			const client = orderedClient({ maxRetries: 1 });
			get.mockRejectedValueOnce({
				response: { status: 429, headers: { "retry-after": retryAfter } }
			});
			await client.doxIP({ ip: IP });
			clock.mockReturnValue(Date.UTC(2030, 0, 1, 0, 0, 59));
			get.mockResolvedValueOnce({ data: query() });
			expect((await client.doxIP({ ip: IP }))?.source).toBe("ipquery.io");
			clock.mockReturnValue(Date.UTC(2030, 0, 1, 0, 1, 1));
			internal(client).providerCursor = 0;
			get.mockResolvedValueOnce({
				data: { ...free(), ipAddress: "192.0.2.2" }
			});
			expect((await client.doxIP({ ip: "192.0.2.2" }))?.source).toBe(
				"freeipapi.com"
			);
		}
	);

	it("recovers from a transient DNS failure after 30 seconds", async () => {
		const clock = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2030, 0, 1));
		const client = orderedClient({ maxRetries: 1 });
		get.mockRejectedValueOnce({ code: "ENOTFOUND" });
		await client.doxIP({ ip: IP });
		clock.mockReturnValue(Date.UTC(2030, 0, 1, 0, 0, 31));
		internal(client).providerCursor = 0;
		get.mockResolvedValueOnce({ data: free() });
		expect((await client.doxIP({ ip: IP }))?.source).toBe("freeipapi.com");
	});
});

describe("continent mapping", () => {
	it.each([
		["US", "NA"],
		["MX", "NA"],
		["BR", "SA"],
		["ES", "EU"],
		["JP", "AS"],
		["ZA", "AF"],
		["AU", "OC"],
		["AQ", "AN"],
		["XK", "EU"],
		["ZZ", undefined]
	])("maps %s to %s", (country, continent) => {
		expect(continentForCountry(country)).toBe(continent);
	});
});
