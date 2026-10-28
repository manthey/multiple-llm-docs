// Globals that the plugin code uses without importing them (they are provided
// by the Obsidian app environment at runtime).
globalThis.createFragment = (cb) => {
	const fragment = document.createDocumentFragment()
	if (cb) cb(fragment)
	return fragment
}

globalThis.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
