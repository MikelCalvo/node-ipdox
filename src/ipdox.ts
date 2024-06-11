import axios from "axios";
import { IPDOXRequest } from "./types/IPDOXRequest";
import { IPDOXResponse } from "./types/IPDOXResponse";
import { IPDOXConstructor } from "./types/IPDOXConstructor";
import { GeoAPIs } from "./utils/apis";
import { LRUCache } from "lru-cache";

class IPDox {
	private cache: LRUCache<string, IPDOXResponse>;
	private maxRetries: number;

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
			maxRetries = 10
		}: IPDOXConstructor = {
			cacheMaxItems: 1000,
			cacheMaxAge: 43200000,
			maxRetries: 10
		}
	) {
		this.cache = new LRUCache<string, IPDOXResponse>({
			max: cacheMaxItems,
			ttl: cacheMaxAge
		});
		this.maxRetries = maxRetries;
	}

	/**
	 * @description Get information about an IP address
	 * @param {IPDOXRequest} params - Params of the request
	 * @param {string} params.ip - IP address
	 * @returns {Promise<IPDOXResponse | undefined>} - Promise of the response or undefined
	 * @memberof IPDox
	 */
	async doxIP({ ip }: IPDOXRequest): Promise<IPDOXResponse | undefined> {
		// Check that the ip is valid
		if (!ip || ip === "") {
			return undefined;
		}

		// Check if the IP is already in the cache
		if (this.cache.has(ip)) {
			const cachedResponse = this.cache.get(ip);

			if (cachedResponse) {
				return cachedResponse;
			}
		}

		// Select a random API
		let randomAPI = this.selectRandomAPI();
		let response: IPDOXResponse | null = null;
		let retries = 0;

		// Fetch data from the API
		while (!response && retries < this.maxRetries) {
			try {
				switch (randomAPI) {
					case GeoAPIs.IP_HYPHEN_API_DOT_COM:
						response = await this.fetchIPHyphenAPIDotCom(ip);
						break;
					case GeoAPIs.FREE_IP_API_DOT_COM:
						response = await this.fetchFreeIPAPIDotCom(ip);
						break;
					case GeoAPIs.IPWHO_DOT_IS:
						response = await this.fetchIPWhoDotIs(ip);
						break;
					case GeoAPIs.IPAPI_DOT_CO:
						response = await this.fetchIPAPIDotCo(ip);
						break;
				}
			} catch (error) {
				// If the promise is rejected, select another random API and try again
				randomAPI = this.selectRandomAPI();
				retries++;
			}
		}

		// If max retries reached and no response, return undefined
		if (retries === this.maxRetries && !response) {
			return undefined;
		}

		// Return the response
		return response ? response : undefined;
	}

	private selectRandomAPI(): GeoAPIs {
		// Get a random entry from the enum
		const randomEntry =
			Object.entries(GeoAPIs)[
				Math.floor(Math.random() * Object.entries(GeoAPIs).length)
			];

		// Return the random entry
		return randomEntry[1];
	}

	private cacheResponse(ip: string, response: IPDOXResponse): void {
		this.cache.set(ip, response);
	}

	private async fetchIPHyphenAPIDotCom(ip: string): Promise<IPDOXResponse> {
		const requestURL = GeoAPIs.IP_HYPHEN_API_DOT_COM + ip + "?fields=24899583";
		const response = await axios.get(requestURL);

		if (response.data.status === "success") {
			const formattedResponse: IPDOXResponse = {
				ip: response.data.query,
				country: response.data.countryCode,
				city: response.data.city,
				continent: response.data.continentCode,
				latitude: response.data.lat,
				longitude: response.data.lon,
				zip: response.data.zip,
				isp: response.data.isp,
				proxy: response.data.proxy,
				isHosting: response.data.hosting,
				timeZone: response.data.timezone,
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
		const response = await axios.get(requestURL);

		if (response.data.ipVersion === 4) {
			const formattedResponse: IPDOXResponse = {
				ip: response.data.ipAddress,
				country: response.data.countryCode,
				city: response.data.cityName,
				continent: response.data.continentCode,
				latitude: response.data.latitude,
				longitude: response.data.longitude,
				zip: response.data.zipCode,
				isp: response.data.isp,
				proxy: response.data.proxy,
				isHosting: response.data.hosting,
				timeZone: response.data.timeZones[0],
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
		const response = await axios.get(requestURL);

		if (response.data.success) {
			const formattedResponse: IPDOXResponse = {
				ip: response.data.ip,
				country: response.data.country_code,
				city: response.data.city,
				continent: response.data.continent_code,
				latitude: response.data.latitude,
				longitude: response.data.longitude,
				zip: response.data.postal,
				isp: response.data.connection.isp,
				proxy: false,
				isHosting: false,
				timeZone: response.data.timezone.id,
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
		const response = await axios.get(requestURL);

		if (response.data.ip) {
			const formattedResponse: IPDOXResponse = {
				ip: response.data.ip,
				country: response.data.country_code,
				city: response.data.city,
				continent: response.data.continent_code,
				latitude: response.data.latitude,
				longitude: response.data.longitude,
				zip: response.data.postal,
				isp: response.data.org,
				timeZone: response.data.timezone,
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
