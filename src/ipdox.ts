import { isIP } from "node:net";
import axios, { type AxiosInstance } from "axios";
import { IPDOXRequest } from "./types/IPDOXRequest.js";
import { IPDOXResponse } from "./types/IPDOXResponse.js";
import { IPDOXConstructor } from "./types/IPDOXConstructor.js";
import { GeoAPIs } from "./utils/apis.js";
import { continentForCountry } from "./utils/continents.js";
import { LRUCache } from "lru-cache";
import { sharedProviderBudget } from "./utils/provider-budget.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_USER_AGENT = "node-ipdox";
const RETRY_BACKOFF_BASE_MS = 150;
const RETRY_BACKOFF_MAX_MS = 2000;
const FREE_PROVIDERS: GeoAPIs[] = [
	GeoAPIs.FREE_IP_API_DOT_COM,
	GeoAPIs.IP_QUERY_DOT_IO,
	GeoAPIs.GEO_JS_DOT_IO,
	GeoAPIs.HACK_MY_IP_DOT_COM,
	GeoAPIs.GEOIP_VUIZ_DOT_NET,
	GeoAPIs.APIP_DOT_CC,
	GeoAPIs.COUNTRY_DOT_IS,
	GeoAPIs.IP_INFO_DOT_COM,
	GeoAPIs.IP_ADDRESS_DETAILS_DOT_COM,
	GeoAPIs.NETWORK_TOOLS_DOT_DEV
];
const CONTINENTS = new Set(["AF", "AN", "AS", "EU", "NA", "OC", "SA"]);

class IPDox {
	private cache: LRUCache<string, IPDOXResponse>;
	private maxRetries: number;
	private requestTimeoutMs: number;
	private inFlight: Map<string, Promise<IPDOXResponse | undefined>>;
	private http: AxiosInstance;
	private ipApiKey?: string;
	private providerBudget = sharedProviderBudget;
	private providerOrder?: GeoAPIs[];
	private providerCursor = 0;

	/**
	 * @description Creates an instance of IPDox.
	 * @param {IPDOXConstructor} params
	 * @param {number} params.cacheMaxItems - The maximum number of items in the cache (default: 1000)
	 * @param {number} params.cacheMaxAge - The cache timeout in milliseconds (default: 43200000 (12 hours))
	 * @param {number} params.maxRetries - The maximum number of retries (default: 10)
	 */
	constructor(
		{
			cacheMaxItems = 1000,
			cacheMaxAge = 43200000,
			maxRetries = 10,
			requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
			ipApiKey
		}: IPDOXConstructor = {
			cacheMaxItems: 1000,
			cacheMaxAge: 43200000,
			maxRetries: 10,
			requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS
		}
	) {
		this.cache = new LRUCache<string, IPDOXResponse>({
			max: cacheMaxItems,
			ttl: cacheMaxAge,
			ttlAutopurge: true
		});
		this.maxRetries = maxRetries;
		this.requestTimeoutMs = requestTimeoutMs;
		this.inFlight = new Map();
		this.ipApiKey = typeof ipApiKey === "string" ? ipApiKey.trim() : undefined;
		this.http = axios.create({
			timeout: this.requestTimeoutMs,
			headers: {
				"User-Agent": DEFAULT_USER_AGENT
			},
			validateStatus: status => status >= 200 && status < 300
		});
	}

	/**
	 * @description Get information about an IP address
	 * @param {IPDOXRequest} params - Params of the request
	 * @param {string} params.ip - IP address
	 * @returns {Promise<IPDOXResponse | undefined>} - Promise of the response or undefined
	 * @memberof IPDox
	 */
	async doxIP({ ip }: IPDOXRequest): Promise<IPDOXResponse | undefined> {
		const normalizedIP = typeof ip === "string" ? ip.trim() : "";
		// Check that the ip is valid
		if (!normalizedIP || isIP(normalizedIP) === 0) {
			return undefined;
		}

		// Check if the IP is already in the cache
		const cachedResponse = this.cache.get(normalizedIP);
		if (cachedResponse) {
			return cachedResponse;
		}

		// Check if there's an ongoing request for the same IP
		const inFlight = this.inFlight.get(normalizedIP);
		if (inFlight) {
			return inFlight;
		}

		const task = this.fetchWithRetries(normalizedIP);
		this.inFlight.set(normalizedIP, task);
		task.finally(() => this.inFlight.delete(normalizedIP));

		return task;
	}

	private shuffleProviders(
		providers: GeoAPIs[],
		avoidFirst?: GeoAPIs
	): GeoAPIs[] {
		const shuffled = [...providers];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}

		if (avoidFirst && shuffled.length > 1 && shuffled[0] === avoidFirst) {
			[shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
		}

		return shuffled;
	}

	private async fetchWithRetries(
		ip: string
	): Promise<IPDOXResponse | undefined> {
		if (this.maxRetries <= 0) {
			return undefined;
		}

		// Shuffle once, then rotate across every eligible provider, not just primaries.
		this.providerOrder ??= this.shuffleProviders(
			this.ipApiKey
				? [GeoAPIs.IP_HYPHEN_API_DOT_COM, ...FREE_PROVIDERS]
				: FREE_PROVIDERS
		);
		const order = this.providerOrder;
		const attempted = new Set<GeoAPIs>();
		let attempts = 0;
		while (attempts < this.maxRetries) {
			let provider: GeoAPIs | undefined;
			for (let checked = 0; checked < order.length; checked++) {
				const candidate = order[this.providerCursor];
				this.providerCursor = (this.providerCursor + 1) % order.length;
				if (attempted.has(candidate)) continue;
				attempted.add(candidate);
				if (this.providerBudget.reserve(candidate)) {
					provider = candidate;
					break;
				}
			}
			if (!provider) return undefined;
			try {
				return await this.fetchFromProvider(provider, ip);
			} catch (error) {
				this.noteProviderFailure(provider, error);
				attempts++;
				if (attempts < this.maxRetries && attempted.size < order.length) {
					await this.waitWithJitter(attempts);
				}
			}
		}

		return undefined;
	}

	private async fetchFromProvider(
		provider: GeoAPIs,
		ip: string
	): Promise<IPDOXResponse> {
		switch (provider) {
			case GeoAPIs.IP_HYPHEN_API_DOT_COM:
				return this.fetchIPHyphenAPIDotCom(ip);
			case GeoAPIs.FREE_IP_API_DOT_COM:
				return this.fetchFreeIPAPIDotCom(ip);
			case GeoAPIs.GEO_JS_DOT_IO:
				return this.fetchGeoJSDotIO(ip);
			case GeoAPIs.IP_QUERY_DOT_IO:
				return this.fetchIPQueryDotIO(ip);
			case GeoAPIs.HACK_MY_IP_DOT_COM:
				return this.fetchHackMyIPDotCom(ip);
			case GeoAPIs.GEOIP_VUIZ_DOT_NET:
				return this.fetchGeoIPVuizDotNet(ip);
			case GeoAPIs.APIP_DOT_CC:
				return this.fetchAPIPDotCC(ip);
			case GeoAPIs.COUNTRY_DOT_IS:
				return this.fetchCountryDotIs(ip);
			case GeoAPIs.IP_INFO_DOT_COM:
				return this.fetchIPInfoDotCom(ip);
			case GeoAPIs.IP_ADDRESS_DETAILS_DOT_COM:
				return this.fetchIPAddressDetailsDotCom(ip);
			case GeoAPIs.NETWORK_TOOLS_DOT_DEV:
				return this.fetchNetworkToolsDotDev(ip);
			default:
				throw new Error("Unsupported provider");
		}
	}

	private async waitWithJitter(attempt: number): Promise<void> {
		const baseDelay = Math.min(
			RETRY_BACKOFF_MAX_MS,
			RETRY_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1)
		);
		const jitter = Math.random() * baseDelay;
		await new Promise(resolve => setTimeout(resolve, jitter));
	}

	private noteProviderFailure(provider: GeoAPIs, error: unknown): void {
		const failure = error as
			| {
					code?: string;
					response?: { status?: number; headers?: Record<string, unknown> };
			  }
			| undefined;
		let until = Date.now() + 30_000;
		if (failure?.response?.status === 429) {
			const retryAfter = failure.response.headers?.["retry-after"];
			const value =
				typeof retryAfter === "string" || typeof retryAfter === "number"
					? String(retryAfter).trim()
					: "";
			const seconds =
				value !== "" && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
			const deadline = Number.isFinite(seconds)
				? Date.now() + seconds * 1000
				: Date.parse(value);
			until =
				Number.isFinite(deadline) && deadline > Date.now()
					? deadline
					: this.providerBudget.quotaRetryAt(provider);
		}
		this.providerBudget.defer(provider, until);
	}

	private parseNumber(value: unknown): number | undefined {
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}

		if (typeof value === "string") {
			const trimmed = value.trim();
			if (trimmed !== "") {
				const parsed = Number(trimmed);
				if (Number.isFinite(parsed)) {
					return parsed;
				}
			}
		}

		return undefined;
	}

	private parseString(value: unknown): string | undefined {
		if (typeof value === "string") {
			const trimmed = value.trim();
			return trimmed === "" ? undefined : trimmed;
		}

		return undefined;
	}

	private pickString(...values: unknown[]): string | undefined {
		for (const value of values) {
			const parsed = this.parseString(value);
			if (parsed) {
				return parsed;
			}
		}

		return undefined;
	}

	private pickStringOrEmpty(...values: unknown[]): string {
		return this.pickString(...values) ?? "";
	}

	private normalizeContinentCode(continentName: unknown): string | undefined {
		const name = this.parseString(continentName)?.toLowerCase();
		if (!name) {
			return undefined;
		}

		switch (name) {
			case "north america":
				return "NA";
			case "south america":
				return "SA";
			case "europe":
				return "EU";
			case "africa":
				return "AF";
			case "asia":
				return "AS";
			case "oceania":
				return "OC";
			case "antarctica":
				return "AN";
			default:
				return undefined;
		}
	}

	private cacheResponse(
		ip: string,
		response: IPDOXResponse,
		cacheTtlMs?: number
	): void {
		const canonicalIP = (value: string): string | undefined => {
			const family = typeof value === "string" ? isIP(value) : 0;
			return family === 6
				? new URL(`http://[${value}]/`).hostname
				: family === 4
					? value
					: undefined;
		};
		if (
			!canonicalIP(response.ip) ||
			canonicalIP(response.ip) !== canonicalIP(ip) ||
			!continentForCountry(response.country) ||
			!CONTINENTS.has(response.continent) ||
			typeof response.city !== "string" ||
			!Number.isFinite(response.latitude) ||
			Math.abs(response.latitude) > 90 ||
			!Number.isFinite(response.longitude) ||
			Math.abs(response.longitude) > 180
		)
			throw new Error("Invalid geolocation response");
		// IP Info explicitly sends no-store. Other new providers cap cache lifetime.
		if (cacheTtlMs === 0) return;
		this.cache.set(
			ip,
			response,
			cacheTtlMs === undefined
				? undefined
				: {
						ttl:
							this.cache.ttl > 0
								? Math.min(this.cache.ttl, cacheTtlMs)
								: cacheTtlMs
					}
		);
	}

	private async fetchIPHyphenAPIDotCom(ip: string): Promise<IPDOXResponse> {
		if (!this.ipApiKey)
			throw new Error("ip-api.com Pro requires an explicit key");
		const baseURL = GeoAPIs.IP_HYPHEN_API_DOT_COM;
		const requestURL =
			baseURL +
			ip +
			"?fields=24899583" +
			(this.ipApiKey ? `&key=${encodeURIComponent(this.ipApiKey)}` : "");
		const response = await this.http.get(requestURL);

		if (response.data.status === "success") {
			const zip =
				typeof response.data.zip === "string" && response.data.zip !== ""
					? response.data.zip
					: undefined;
			const isp =
				typeof response.data.isp === "string" && response.data.isp !== ""
					? response.data.isp
					: undefined;
			const proxy =
				typeof response.data.proxy === "boolean"
					? response.data.proxy
					: undefined;
			const isHosting =
				typeof response.data.hosting === "boolean"
					? response.data.hosting
					: undefined;
			const timeZone =
				typeof response.data.timezone === "string"
					? response.data.timezone
					: undefined;
			const formattedResponse: IPDOXResponse = {
				ip: response.data.query,
				country: response.data.countryCode,
				city: response.data.city,
				continent: response.data.continentCode,
				latitude: response.data.lat,
				longitude: response.data.lon,
				zip,
				isp,
				proxy,
				isHosting,
				timeZone,
				source: "ip-api.com"
			};

			this.cacheResponse(ip, formattedResponse);

			return Promise.resolve(formattedResponse);
		} else {
			return Promise.reject();
		}
	}

	private async fetchFreeIPAPIDotCom(ip: string): Promise<IPDOXResponse> {
		const { data } = await this.http.get(
			GeoAPIs.FREE_IP_API_DOT_COM + encodeURIComponent(ip)
		);
		if (data?.ipVersion !== 4 && data?.ipVersion !== 6) {
			throw new Error("FreeIPAPI lookup failed");
		}
		const country = this.pickStringOrEmpty(data.countryCode);
		const response: IPDOXResponse = {
			ip: this.pickStringOrEmpty(data.ipAddress),
			country,
			city: this.pickStringOrEmpty(data.cityName),
			// FreeIPAPI uses AM for the Americas; the public contract uses NA/SA.
			continent: CONTINENTS.has(data.continentCode)
				? data.continentCode
				: (continentForCountry(country) ?? ""),
			latitude: this.parseNumber(data.latitude) ?? NaN,
			longitude: this.parseNumber(data.longitude) ?? NaN,
			zip: this.parseString(data.zipCode),
			isp: this.pickString(data.isp, data.asnOrganization),
			proxy: typeof data.isProxy === "boolean" ? data.isProxy : undefined,
			isHosting: typeof data.hosting === "boolean" ? data.hosting : undefined,
			timeZone: Array.isArray(data.timeZones)
				? this.parseString(data.timeZones[0])
				: undefined,
			source: "freeipapi.com"
		};
		this.cacheResponse(ip, response);
		return response;
	}

	private async fetchCountryDotIs(ip: string): Promise<IPDOXResponse> {
		const { data } = await this.http.get(
			GeoAPIs.COUNTRY_DOT_IS +
				encodeURIComponent(ip) +
				"?fields=city,continent,postal,location,asn"
		);
		const country = this.pickStringOrEmpty(data?.country);
		const response: IPDOXResponse = {
			ip: this.pickStringOrEmpty(data?.ip),
			country,
			city: this.pickStringOrEmpty(data?.city),
			continent:
				this.parseString(data?.continent) ?? continentForCountry(country) ?? "",
			latitude: this.parseNumber(data?.location?.latitude) ?? NaN,
			longitude: this.parseNumber(data?.location?.longitude) ?? NaN,
			zip: this.parseString(data?.postal),
			isp: this.parseString(data?.asn?.organization),
			timeZone: this.parseString(data?.location?.time_zone),
			source: "country.is"
		};
		this.cacheResponse(ip, response, 3_600_000);
		return response;
	}

	private async fetchIPInfoDotCom(ip: string): Promise<IPDOXResponse> {
		const { data } = await this.http.get(
			GeoAPIs.IP_INFO_DOT_COM + "?ip=" + encodeURIComponent(ip)
		);
		const country = this.pickStringOrEmpty(data?.country);
		const response: IPDOXResponse = {
			ip: this.pickStringOrEmpty(data?.ip),
			country,
			city: this.pickStringOrEmpty(data?.city),
			continent:
				this.parseString(data?.continent) ?? continentForCountry(country) ?? "",
			latitude: this.parseNumber(data?.latitude) ?? NaN,
			longitude: this.parseNumber(data?.longitude) ?? NaN,
			zip: this.parseString(data?.postal),
			isp: this.pickString(data?.isp, data?.org),
			timeZone: this.parseString(data?.timezone),
			source: "ip-info.com"
		};
		// no-store: validate but never retain this provider's response in LRU.
		this.cacheResponse(ip, response, 0);
		return response;
	}

	private async fetchIPAddressDetailsDotCom(
		ip: string
	): Promise<IPDOXResponse> {
		const { data, headers } = await this.http.get(
			GeoAPIs.IP_ADDRESS_DETAILS_DOT_COM + encodeURIComponent(ip)
		);
		this.providerBudget.observeDailyRemaining(
			GeoAPIs.IP_ADDRESS_DETAILS_DOT_COM,
			headers?.["x-ratelimit-remaining-day"]
		);
		const country = this.pickStringOrEmpty(data?.country_code);
		const response: IPDOXResponse = {
			ip: this.pickStringOrEmpty(data?.ip),
			country,
			city: this.pickStringOrEmpty(data?.city),
			continent:
				this.parseString(data?.continent_code) ??
				continentForCountry(country) ??
				"",
			latitude: this.parseNumber(data?.latitude) ?? NaN,
			longitude: this.parseNumber(data?.longitude) ?? NaN,
			zip: this.parseString(data?.postal),
			isp: this.parseString(data?.org),
			timeZone: this.parseString(data?.timezone),
			source: "ipaddressdetails.com"
		};
		this.cacheResponse(ip, response, 3_600_000);
		return response;
	}

	private async fetchNetworkToolsDotDev(ip: string): Promise<IPDOXResponse> {
		const { data } = await this.http.get(
			GeoAPIs.NETWORK_TOOLS_DOT_DEV + "?ip=" + encodeURIComponent(ip)
		);
		// Live schema includes countryCode; docs also show country as an ISO code.
		const country =
			this.pickString(data?.geo?.countryCode, data?.geo?.country) ?? "";
		const response: IPDOXResponse = {
			ip: this.pickStringOrEmpty(data?.ip),
			country,
			city: this.pickStringOrEmpty(data?.geo?.city),
			continent:
				this.parseString(data?.geo?.continentCode) ??
				continentForCountry(country) ??
				"",
			latitude: this.parseNumber(data?.geo?.lat) ?? NaN,
			longitude: this.parseNumber(data?.geo?.lon) ?? NaN,
			zip: this.parseString(data?.geo?.zipcode),
			isp: this.parseString(data?.asn?.org),
			source: "networktools.dev"
		};
		this.cacheResponse(ip, response, 3_600_000);
		return response;
	}

	private async fetchGeoJSDotIO(ip: string): Promise<IPDOXResponse> {
		const { data } = await this.http.get(
			GeoAPIs.GEO_JS_DOT_IO + encodeURIComponent(ip) + ".json"
		);
		const country = this.pickStringOrEmpty(data?.country_code);
		const response: IPDOXResponse = {
			ip: this.pickStringOrEmpty(data?.ip),
			country,
			city: this.pickStringOrEmpty(data?.city),
			continent:
				this.parseString(data?.continent_code) ??
				continentForCountry(country) ??
				"",
			latitude: this.parseNumber(data?.latitude) ?? NaN,
			longitude: this.parseNumber(data?.longitude) ?? NaN,
			isp: this.parseString(data?.organization_name),
			timeZone: this.parseString(data?.timezone),
			source: "geojs.io"
		};
		this.cacheResponse(ip, response);
		return response;
	}

	private async fetchIPQueryDotIO(ip: string): Promise<IPDOXResponse> {
		const { data } = await this.http.get(
			GeoAPIs.IP_QUERY_DOT_IO + encodeURIComponent(ip)
		);
		const country = this.pickStringOrEmpty(data?.location?.country_code);
		const risk = data?.risk;
		const response: IPDOXResponse = {
			ip: this.pickStringOrEmpty(data?.ip),
			country,
			city: this.pickStringOrEmpty(data?.location?.city),
			continent: continentForCountry(country) ?? "",
			latitude: this.parseNumber(data?.location?.latitude) ?? NaN,
			longitude: this.parseNumber(data?.location?.longitude) ?? NaN,
			zip: this.parseString(data?.location?.zipcode),
			isp: this.pickString(data?.isp?.isp, data?.isp?.org),
			timeZone: this.parseString(data?.location?.timezone),
			proxy: typeof risk?.is_proxy === "boolean" ? risk.is_proxy : undefined,
			isHosting:
				typeof risk?.is_datacenter === "boolean"
					? risk.is_datacenter
					: undefined,
			proxyInfo:
				typeof risk?.is_vpn === "boolean" &&
				typeof risk?.is_tor === "boolean" &&
				typeof risk?.is_proxy === "boolean"
					? { isVPN: risk.is_vpn, isTOR: risk.is_tor, isProxy: risk.is_proxy }
					: undefined,
			source: "ipquery.io"
		};
		this.cacheResponse(ip, response);
		return response;
	}

	private async fetchHackMyIPDotCom(ip: string): Promise<IPDOXResponse> {
		const { data: envelope } = await this.http.get(
			GeoAPIs.HACK_MY_IP_DOT_COM + "?ip=" + encodeURIComponent(ip)
		);
		if (envelope?.success !== true) throw new Error("HackMyIP lookup failed");
		const data = envelope.data;
		const country = this.pickStringOrEmpty(data?.location?.country);
		const response: IPDOXResponse = {
			ip: this.pickStringOrEmpty(data?.ip),
			country,
			city: this.pickStringOrEmpty(data?.location?.city),
			continent: continentForCountry(country) ?? "",
			latitude: this.parseNumber(data?.location?.latitude) ?? NaN,
			longitude: this.parseNumber(data?.location?.longitude) ?? NaN,
			zip: this.parseString(data?.location?.postal_code),
			isp: this.pickString(data?.network?.isp, data?.network?.org),
			timeZone: this.parseString(data?.location?.timezone),
			proxy:
				typeof data?.privacy?.proxy === "boolean"
					? data.privacy.proxy
					: undefined,
			isHosting:
				typeof data?.privacy?.hosting === "boolean"
					? data.privacy.hosting
					: undefined,
			source: "hackmyip.com"
		};
		this.cacheResponse(ip, response);
		return response;
	}

	private async fetchGeoIPVuizDotNet(ip: string): Promise<IPDOXResponse> {
		const requestURL =
			GeoAPIs.GEOIP_VUIZ_DOT_NET + "?ip=" + encodeURIComponent(ip);
		const response = await this.http.get(requestURL);
		const data = response.data;

		const responseIP = this.parseString(data?.ip) ?? ip;
		const country = this.pickString(data?.country_code, data?.countryCode);
		const city = this.pickStringOrEmpty(data?.city);
		const continent =
			this.pickString(data?.continent_code, data?.continentCode) ??
			this.normalizeContinentCode(data?.continent);
		const latitude = this.parseNumber(data?.latitude ?? data?.lat);
		const longitude = this.parseNumber(data?.longitude ?? data?.lon);

		if (
			responseIP &&
			country &&
			continent &&
			latitude !== undefined &&
			longitude !== undefined
		) {
			const zip = this.pickString(data?.postal_code, data?.zip);
			const isp = this.pickString(
				data?.isp,
				data?.organization,
				data?.asn_organization
			);
			const timeZone = this.pickString(data?.timezone);

			const formattedResponse: IPDOXResponse = {
				ip: responseIP,
				country,
				city,
				continent,
				latitude,
				longitude,
				zip,
				isp,
				timeZone,
				source: "geoip.vuiz.net"
			};

			this.cacheResponse(ip, formattedResponse);

			return Promise.resolve(formattedResponse);
		}

		return Promise.reject();
	}

	private async fetchAPIPDotCC(ip: string): Promise<IPDOXResponse> {
		const requestURL = GeoAPIs.APIP_DOT_CC + encodeURIComponent(ip);
		const response = await this.http.get(requestURL);
		const data = response.data;

		if (data?.status && data.status !== "success") {
			return Promise.reject();
		}

		const responseIP = this.parseString(data?.ip) ?? ip;
		const country = this.parseString(data?.CountryCode);
		const city = this.pickStringOrEmpty(data?.City);
		const continent =
			this.parseString(data?.ContinentCode) ??
			this.normalizeContinentCode(data?.ContinentName);
		const latitude = this.parseNumber(data?.Latitude);
		const longitude = this.parseNumber(data?.Longitude);

		if (
			responseIP &&
			country &&
			continent &&
			latitude !== undefined &&
			longitude !== undefined
		) {
			const zip = this.parseString(data?.Postal);
			const isp =
				this.parseString(data?.org) ||
				this.parseString(data?.Org) ||
				this.parseString(data?.ISP);
			const timeZone = this.parseString(data?.TimeZone);

			const formattedResponse: IPDOXResponse = {
				ip: responseIP,
				country,
				city,
				continent,
				latitude,
				longitude,
				zip,
				isp,
				timeZone,
				source: "apip.cc"
			};

			this.cacheResponse(ip, formattedResponse);

			return Promise.resolve(formattedResponse);
		}

		return Promise.reject();
	}
}

export default IPDox;
