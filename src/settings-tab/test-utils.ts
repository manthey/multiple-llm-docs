import { PluginSettings, defaultPluginSettings } from '../settings'

/**
 * Shared helpers for settings-tab tests. The obsidian API is mocked via
 * tests/obsidian-mock.js (see jest.config.js moduleNameMapper).
 */

export function fakeApp(): any {
	return {
		vault: {
			getAllFolders: () => [],
		},
	}
}

export function fakePlugin(overrides: Partial<PluginSettings> = {}): any {
	const settings: PluginSettings = JSON.parse(JSON.stringify(defaultPluginSettings))
	Object.assign(settings, overrides)
	return {
		settings,
		saveSettings: jest.fn().mockResolvedValue(undefined),
		app: fakeApp(),
	}
}

interface ObsidianMock {
	__captured: {
		settings: any[]
		texts: any[]
		toggles: any[]
		dropdowns: any[]
		buttons: any[]
		notices: string[]
	}
	resetCaptured: () => void
}

function obsidianMock(): ObsidianMock {
	return require('obsidian') as ObsidianMock
}

export function resetCaptured() {
	obsidianMock().resetCaptured()
}

export function capturedTexts(): any[] {
	return obsidianMock().__captured.texts
}

export function capturedToggles(): any[] {
	return obsidianMock().__captured.toggles
}

export function capturedDropdowns(): any[] {
	return obsidianMock().__captured.dropdowns
}

export function capturedButtons(): any[] {
	return obsidianMock().__captured.buttons
}

export function notices(): string[] {
	return obsidianMock().__captured.notices
}

export function findTextByPlaceholder(placeholder: string): any {
	return capturedTexts().find((text) => text.inputEl.placeholder === placeholder)
}

export function findTextByValue(value: string): any {
	return capturedTexts().find((text) => text.inputEl.value === value)
}

export function findButtonByLabel(label: string): any {
	return capturedButtons().find((button) => button.buttonEl.textContent === label)
}

/** Invoke the onclick handler of an element directly (awaiting async handlers). */
export async function click(el: HTMLElement) {
	await (el as any).onclick?.(new Event('click'))
}

/** Invoke the oninput handler of an element directly. */
export async function fireInput(el: HTMLInputElement) {
	await (el as any).oninput?.(new Event('input'))
}

/** Invoke the onchange handler of an element directly. */
export async function fireChange(el: HTMLElement) {
	await (el as any).onchange?.(new Event('change'))
}
