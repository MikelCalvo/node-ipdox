import { isIP } from "node:net";
import axios, { type AxiosInstance } from "axios";
import { IPDOXRequest } from "./types/IPDOXRequest.js";
import { IPDOXResponse } from "./types/IPDOXResponse.js";
import { IPDOXConstructor } from "./types/IPDOXConstructor.js";
import { GeoAPIs } from "./utils/apis.js";
import { LRUCache } from "lru-cache";

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_USER_AGENT = "node-ipdox";
const RETRY_BACKOFF_BASE_MS = 150;
const RETRY_BACKOFF_MAX_MS = 2000;
const PRIMARY_PROVIDERS: GeoAPIs[] = [
	GeoAPIs.IP_HYPHEN_API_DOT_COM,
	GeoAPIs.FREE_IP_API_DOT_COM,
	GeoAPIs.IPWHO_DOT_IS,
	GeoAPIs.IPAPI_DOT_CO
];
const FALLBACK_PROVIDERS: GeoAPIs[] = [
	GeoAPIs.GEOIP_VUIZ_DOT_NET,
	GeoAPIs.APIP_DOT_CC,
	GeoAPIs.IP_SONAR_DOT_COM
];

class IPDox {
	private cache: LRUCache<string, IPDOXResponse>;
	private maxRetries: number;
	private requestTimeoutMs: number;
	private inFlight: Map<string, Promise<IPDOXResponse | undefined>>;
	private http: AxiosInstance;
	private ipApiKey?: string;
	private unavailableProviders: Set<GeoAPIs>;

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
		this.unavailableProviders = new Set();
		this.http = axios.create({
			timeout: this.requestTimeoutMs,
			headers: {
				"User-Agent": DEFAULT_USER_AGENT
			},
			validateStatus: status => status >= 200 && status < 500
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

	private shuffleProviders(providers: GeoAPIs[], avoidFirst?: GeoAPIs): GeoAPIs[] {
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

		const primaryProviders = PRIMARY_PROVIDERS.filter(
			provider => !this.unavailableProviders.has(provider)
		);
		const fallbackProviders = FALLBACK_PROVIDERS.filter(
			provider => !this.unavailableProviders.has(provider)
		);
		const providers =
			primaryProviders.length > 0 || fallbackProviders.length > 0
				? { primary: primaryProviders, fallback: fallbackProviders }
				: {
						primary: (Object.values(GeoAPIs) as GeoAPIs[]).filter(
							provider => !this.unavailableProviders.has(provider)
						),
						fallback: []
					};

		let attempts = 0;
		let order = [
			...this.shuffleProviders(providers.primary),
			...this.shuffleProviders(providers.fallback)
		];
		let index = 0;

		if (order.length === 0) {
			return undefined;
		}

		while (attempts < this.maxRetries) {
			if (index >= order.length) {
				order = [
					...this.shuffleProviders(providers.primary),
					...this.shuffleProviders(providers.fallback)
				];
				index = 0;
				if (order.length === 0) {
					return undefined;
				}
			}

			const provider = order[index];
			index++;
			if (this.unavailableProviders.has(provider)) {
				attempts++;
				continue;
			}

			try {
				return await this.fetchFromProvider(provider, ip);
			} catch (error) {
				this.noteProviderFailure(provider, error);
				attempts++;
				if (attempts < this.maxRetries) {
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
			case GeoAPIs.IPWHO_DOT_IS:
				return this.fetchIPWhoDotIs(ip);
			case GeoAPIs.IPAPI_DOT_CO:
				return this.fetchIPAPIDotCo(ip);
			case GeoAPIs.GEOIP_VUIZ_DOT_NET:
				return this.fetchGeoIPVuizDotNet(ip);
			case GeoAPIs.APIP_DOT_CC:
				return this.fetchAPIPDotCC(ip);
			case GeoAPIs.IP_SONAR_DOT_COM:
				return this.fetchIPSonarDotCom(ip);
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
		if (provider === GeoAPIs.IPAPI_DOT_CO && this.isDnsError(error)) {
			this.unavailableProviders.add(provider);
		}
	}

	private isDnsError(error: unknown): boolean {
		if (!error || typeof error !== "object") {
			return false;
		}

		const maybeError = error as { code?: string; cause?: { code?: string } };
		const code = maybeError.code ?? maybeError.cause?.code;
		return code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA";
	}

	private parseNumber(value: unknown): number | undefined {
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}

		if (typeof value === "string") {
			const trimmed = value.trim();
			if (trimmed !== "") {
				const parsed = Number.parseFloat(trimmed);
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

	private cacheResponse(ip: string, response: IPDOXResponse): void {
		this.cache.set(ip, response);
	}

	private async fetchIPHyphenAPIDotCom(ip: string): Promise<IPDOXResponse> {
		const baseURL = this.ipApiKey
			? "https://pro.ip-api.com/json/"
			: GeoAPIs.IP_HYPHEN_API_DOT_COM;
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
		const requestURL = GeoAPIs.FREE_IP_API_DOT_COM + ip;
		const response = await this.http.get(requestURL);

		if (response.data.ipVersion === 4 || response.data.ipVersion === 6) {
			const zip =
				typeof response.data.zipCode === "string" &&
				response.data.zipCode !== ""
					? response.data.zipCode
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
				Array.isArray(response.data.timeZones) &&
				typeof response.data.timeZones[0] === "string"
					? response.data.timeZones[0]
					: undefined;
			const formattedResponse: IPDOXResponse = {
				ip: response.data.ipAddress,
				country: response.data.countryCode,
				city: response.data.cityName,
				continent: response.data.continentCode,
				latitude: response.data.latitude,
				longitude: response.data.longitude,
				zip,
				isp,
				proxy,
				isHosting,
				timeZone,
				source: "freeipapi.com"
			};

			this.cacheResponse(ip, formattedResponse);

			return Promise.resolve(formattedResponse);
		} else {
			return Promise.reject();
		}
	}

	private async fetchIPWhoDotIs(ip: string): Promise<IPDOXResponse> {
		const requestURL = GeoAPIs.IPWHO_DOT_IS + ip;
		const response = await this.http.get(requestURL);

		if (response.data.success) {
			const zip =
				typeof response.data.postal === "string" &&
				response.data.postal !== ""
					? response.data.postal
					: undefined;
			const isp =
				typeof response.data.connection?.isp === "string" &&
				response.data.connection.isp !== ""
					? response.data.connection.isp
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
				typeof response.data.timezone?.id === "string"
					? response.data.timezone.id
					: typeof response.data.timezone === "string"
						? response.data.timezone
						: undefined;
			const formattedResponse: IPDOXResponse = {
				ip: response.data.ip,
				country: response.data.country_code,
				city: response.data.city,
				continent: response.data.continent_code,
				latitude: response.data.latitude,
				longitude: response.data.longitude,
				zip,
				isp,
				proxy,
				isHosting,
				timeZone,
				source: "ipwho.is"
			};

			this.cacheResponse(ip, formattedResponse);

			return Promise.resolve(formattedResponse);
		} else {
			return Promise.reject();
		}
	}

	private async fetchIPAPIDotCo(ip: string): Promise<IPDOXResponse> {
		const requestURL = GeoAPIs.IPAPI_DOT_CO + ip + "/json";
		const response = await this.http.get(requestURL);

		if (response.data.ip) {
			const zip =
				typeof response.data.postal === "string" &&
				response.data.postal !== ""
					? response.data.postal
					: undefined;
			const isp =
				typeof response.data.org === "string" && response.data.org !== ""
					? response.data.org
					: undefined;
			const timeZone =
				typeof response.data.timezone === "string"
					? response.data.timezone
					: undefined;
			const formattedResponse: IPDOXResponse = {
				ip: response.data.ip,
				country: response.data.country_code,
				city: response.data.city,
				continent: response.data.continent_code,
				latitude: response.data.latitude,
				longitude: response.data.longitude,
				zip,
				isp,
				timeZone,
				source: "ipapi.co"
			};

			this.cacheResponse(ip, formattedResponse);

			return Promise.resolve(formattedResponse);
		} else {
			return Promise.reject();
		}
	}

	private async fetchGeoIPVuizDotNet(ip: string): Promise<IPDOXResponse> {
		const requestURL =
			GeoAPIs.GEOIP_VUIZ_DOT_NET + "?ip=" + encodeURIComponent(ip);
		const response = await this.http.get(requestURL);
		const data = response.data;

		const responseIP = this.parseString(data?.ip) ?? ip;
		const country = this.pickString(data?.country_code, data?.countryCode);
		const city = this.pickStringOrEmpty(
			data?.city,
			data?.region,
			data?.country,
			data?.country_name
		);
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
		const city = this.pickStringOrEmpty(
			data?.City,
			data?.RegionName,
			data?.CountryName
		);
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

	private async fetchIPSonarDotCom(ip: string): Promise<IPDOXResponse> {
		const requestURL = GeoAPIs.IP_SONAR_DOT_COM + encodeURIComponent(ip);
		const response = await this.http.get(requestURL);
		const data = response.data;

		const responseIP = this.parseString(data?.ip) ?? ip;
		const country = this.parseString(data?.country_code);
		const city = this.pickStringOrEmpty(
			data?.city_name,
			data?.region_name,
			data?.country_name
		);
		const continent = this.parseString(data?.continent_code);
		const latitude = this.parseNumber(data?.latitude);
		const longitude = this.parseNumber(data?.longitude);

		if (
			responseIP &&
			country &&
			continent &&
			latitude !== undefined &&
			longitude !== undefined
		) {
			const zip = this.parseString(data?.postal_code);
			const timeZone = this.parseString(data?.timezone);

			const formattedResponse: IPDOXResponse = {
				ip: responseIP,
				country,
				city,
				continent,
				latitude,
				longitude,
				zip,
				timeZone,
				source: "ip-sonar.com"
			};

			this.cacheResponse(ip, formattedResponse);

			return Promise.resolve(formattedResponse);
		}

		return Promise.reject();
	}
}

export default IPDox;
