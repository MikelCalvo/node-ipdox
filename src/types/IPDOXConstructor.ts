/**
 * Interface for the constructor
 *
 * @interface IPDOXConstructor
 * @property {number} cacheMaxItems The maximum number of items in the cache (default: 1000)
 * @property {number} cacheMaxAge The cache timeout in milliseconds (default: 43200000 (12 hours))
 * @property {number} maxRetries The maximum number of retries (default: 10)
 * @property {number} requestTimeoutMs Request timeout in milliseconds (default: 5000)
 */
export interface IPDOXConstructor {
	cacheMaxItems?: number;
	cacheMaxAge?: number;
	maxRetries?: number;
	requestTimeoutMs?: number;
}
