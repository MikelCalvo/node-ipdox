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

class IPDox {
	private cache: LRUCache<string, IPDOXResponse>;
	private maxRetries: number;
	private requestTimeoutMs: number;
	private inFlight: Map<string, Promise<IPDOXResponse | undefined>>;
	private http: AxiosInstance;

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
			requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
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
		const providers = Object.values(GeoAPIs) as GeoAPIs[];
		if (providers.length === 0 || this.maxRetries <= 0) {
			return undefined;
		}

		let attempts = 0;
		let order = this.shuffleProviders(providers);
		let index = 0;
		let lastProvider: GeoAPIs | undefined;

		while (attempts < this.maxRetries) {
			if (index >= order.length) {
				order = this.shuffleProviders(providers, lastProvider);
				index = 0;
			}

			const provider = order[index];
			index++;
			lastProvider = provider;

			try {
				return await this.fetchFromProvider(provider, ip);
			} catch {
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
		const requestURL = GeoAPIs.IP_HYPHEN_API_DOT_COM + ip + "?fields=24899583";
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

		const responseIP = this.parseString(data?.ip);
		const country = this.parseString(data?.countryCode);
		const city = this.parseString(data?.city);
		const continent = this.normalizeContinentCode(data?.continent);
		const latitude = this.parseNumber(data?.lat);
		const longitude = this.parseNumber(data?.lon);

		if (
			responseIP &&
			country &&
			city &&
			continent &&
			latitude !== undefined &&
			longitude !== undefined
		) {
			const zip = this.parseString(data?.zip);
			const isp = this.parseString(data?.isp);
			const timeZone = this.parseString(data?.timezone);

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

		const responseIP = this.parseString(data?.ip);
		const country = this.parseString(data?.CountryCode);
		const city = this.parseString(data?.City);
		const continent = this.parseString(data?.ContinentCode);
		const latitude = this.parseNumber(data?.Latitude);
		const longitude = this.parseNumber(data?.Longitude);

		if (
			responseIP &&
			country &&
			city &&
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

		const responseIP = this.parseString(data?.ip);
		const country = this.parseString(data?.country_code);
		const city = this.parseString(data?.city_name);
		const continent = this.parseString(data?.continent_code);
		const latitude = this.parseNumber(data?.latitude);
		const longitude = this.parseNumber(data?.longitude);

		if (
			responseIP &&
			country &&
			city &&
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
