/**
 * Interface for the response
 *
 * @interface IPDOXResponse
 * @property {string} ip The IP address
 * @property {string} country The country (ISO 3166)
 * @property {string} city The city
 * @property {string} continent The continent (ISO 3166)
 * @property {number} latitude The latitude
 * @property {number} longitude The longitude
 * @property {string} zip The ZIP code
 * @property {string} isp The ISP (Internet Service Provider)
 * @property {boolean} proxy Is the IP address a proxy?
 * @property {boolean} isHosting Is the IP address a hosting provider?
 * @property {object} proxyInfo Information about the proxy
 * @property {boolean} proxyInfo.isVPN Is the IP address a VPN?
 * @property {boolean} proxyInfo.isTOR Is the IP address a TOR node?
 * @property {boolean} proxyInfo.isProxy Is the IP address a proxy?
 * @property {string} source The source of the data
 */
export interface IPDOXResponse {
	ip: string;
	country: string;
	city: string;
	continent: string;
	latitude: number;
	longitude: number;
	zip: string;
	isp: string;
	proxy?: boolean;
	isHosting?: boolean;
	proxyInfo?: {
		isVPN: boolean;
		isTOR: boolean;
		isProxy: boolean;
	};
	source: string;
}
