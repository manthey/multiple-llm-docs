// Globals that the plugin code uses without importing them (they are provided
// by the Obsidian app environment at runtime).
globalThis.createFragment = (cb) => {
	const fragment = document.createDocumentFragment()
	if (cb) cb(fragment)
	return fragment
}

globalThis.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Guardrail: network access is disabled by default in tests. Tests that need
// it must install their own explicit fetch mock (e.g. open-ai tests mock
// global.fetch with canned responses).
globalThis.fetch = () => Promise.reject(new Error('Network calls are disabled in tests; mock fetch explicitly.'))

// jsdom does not provide text encoding/stream globals; take them from Node.
const util = require('util')
const { ReadableStream } = require('node:stream/web')
globalThis.TextEncoder = globalThis.TextEncoder ?? util.TextEncoder
globalThis.TextDecoder = globalThis.TextDecoder ?? util.TextDecoder
globalThis.ReadableStream = globalThis.ReadableStream ?? ReadableStream
