// this is the service worker for PWA and browsers that support service workers, referenced by serviceWorker in svelte.config.js
/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

import { build, files, version } from '$service-worker';

// Create a unique cache name for both the deployment and this serviceworkers prefix
const CACHE = `SKSW-${version}`;

const filterStaticAssets = () => {
	return files.filter((filePath) => {
		// if (filePath.includes('_headers')) return false; // This file probably shouldn't exist in the files array when using cloudflare-adapter.
		return filePath;
	});
};

const ASSETS = [
	...build,
	...filterStaticAssets() // everything in `static`, that isnt filtered out.
];

sw.addEventListener('install', (event) => {
	// Create a new cache and add all files to it
	async function addFilesToCache() {
		const cache = await caches.open(CACHE);
		await cache.addAll(ASSETS); // Will fail in Chrome if any of the files 404.
	}

	event.waitUntil(addFilesToCache());
});

sw.addEventListener('activate', (event) => {
	console.log('activated worker');
	// Remove previous cached data from disk
	async function deleteOldCaches() {
		const cacheNames = await caches.keys();
		return Promise.all(
			cacheNames
				.filter((key) => key !== CACHE)
				.map((key) => {
					// Delete old caches beloning to us
					if (key.startsWith('SKSW')) {
						// Scope to this service worker
						console.log('deleting cache', key);
						caches.delete(key);
					}
				})
		);
	}
	// Enable preload async while activating would otherwise buffer the fetches until finished
	async function enableNavigationPreload() {
		if (sw.registration?.navigationPreload) {
			await sw.registration.navigationPreload.enable();
		}
		return Promise.resolve();
	}

	event.waitUntil(Promise.all([enableNavigationPreload(), deleteOldCaches()]));
});

sw.addEventListener('fetch', (event) => {
	// ignore POST requests etc
	if (event.request.method !== 'GET') return;

	async function respond() {
		const url = new URL(event.request.url);
		const cache = await caches.open(CACHE);

		// `build`/`files` can always be served from the cache (if cache isnt in the process of being deleted by new version of worker)
		if (ASSETS.includes(url.pathname)) {
			const response = await cache.match(url.pathname);

			if (response) {
				return response;
			}
		}

		// for everything else, try the network first, but
		// fall back to the cache if we're offline
		try {
			// Try preloaded response, if its there
			const preloadResponse = await event?.preloadResponse;
			if (preloadResponse) return preloadResponse;

			const response = await fetch(event.request);

			// if we're offline, fetch can return a value that is not a Response
			// instead of throwing - and we can't pass this non-Response to respondWith
			if (!(response instanceof Response)) {
				throw new Error('invalid response from fetch');
			}

			if (response.status === 200) {
				//  cache.put(event.request, response.clone());
			}

			return response;
		} catch (err) {
			const response = await cache.match(event.request);

			if (response) {
				return response;
			}
			// if there's no cache, then just error out
			// as there is nothing we can do to respond to this request
			throw err;
		}
	}

	event.respondWith(respond());
});
