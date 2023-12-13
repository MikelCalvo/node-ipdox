/**
 * Interface for the constructor
 *
 * @interface IPDOXConstructor
 * @property {number} cacheTimeout The cache timeout in milliseconds (default: 43200000 (12 hours))
 * @property {number} maxRetries The maximum number of retries (default: 10)
 */
export interface IPDOXConstructor {
	cacheTimeout?: number;
	maxRetries?: number;
}
