/**
 * Happy DOM preload for browser API testing
 * Registers global DOM APIs (document, window, etc.) for use in tests
 *
 * Preserves Bun's native fetch to avoid CORS conflicts
 * Uses happy-dom's EventTarget for DOM events
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const bunFetch = globalThis.fetch;
GlobalRegistrator.register();
globalThis.fetch = bunFetch;
