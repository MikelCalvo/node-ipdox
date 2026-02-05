import { isIP } from "node:net";
import axios from "axios";
import { IPDOXRequest } from "./types/IPDOXRequest.js";
import { IPDOXResponse } from "./types/IPDOXResponse.js";
import { IPDOXConstructor } from "./types/IPDOXConstructor.js";
import { GeoAPIs } from "./utils/apis.js";
import { LRUCache } from "lru-cache";

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

class IPDox {
	private cache: LRUCache<string, IPDOXResponse>;
	private maxRetries: number;
	private requestTimeoutMs: number;
	private inFlight: Map<string, Promise<IPDOXResponse | undefined>>;

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
			default:
				throw new Error("Unsupported provider");
		}
	}

	private cacheResponse(ip: string, response: IPDOXResponse): void {
		this.cache.set(ip, response);
	}

	private async fetchIPHyphenAPIDotCom(ip: string): Promise<IPDOXResponse> {
		const requestURL = GeoAPIs.IP_HYPHEN_API_DOT_COM + ip + "?fields=24899583";
		const response = await axios.get(requestURL, {
			timeout: this.requestTimeoutMs
		});

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
		const response = await axios.get(requestURL, {
			timeout: this.requestTimeoutMs
		});

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
		const response = await axios.get(requestURL, {
			timeout: this.requestTimeoutMs
		});

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
		const response = await axios.get(requestURL, {
			timeout: this.requestTimeoutMs
		});

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
}

export default IPDox;
