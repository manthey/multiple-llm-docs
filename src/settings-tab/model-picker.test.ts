import { expect, it, describe, beforeEach, jest } from '@jest/globals'
import { ModelPickerModal } from './model-picker'
import { LlmConnectionSettings, PluginSettings, defaultPluginSettings } from '../settings'
import { modelToConnectionCache } from '../connection-models'
import { fakeApp, resetCaptured } from './test-utils'

function connection(overrides: Partial<LlmConnectionSettings> = {}): LlmConnectionSettings {
	return {
		type: 'OpenAI',
		baseUrl: 'https://api.openai.com',
		apiKey: 'key',
		name: 'main',
		isDefault: true,
		...overrides,
	}
}

function fakePlugin(overrides: Partial<PluginSettings> = {}): any {
	const settings: PluginSettings = JSON.parse(JSON.stringify(defaultPluginSettings))
	Object.assign(settings, overrides)
	return { settings, saveSettings: jest.fn().mockResolvedValue(undefined), app: fakeApp() }
}

function makeModal(plugin: any, alternateConnections?: LlmConnectionSettings) {
	return new ModelPickerModal(plugin.app, plugin, alternateConnections)
}

// Prevent any network access during onOpen's model refresh.
jest.spyOn(require('../connection-models'), 'getAllAvailableModelsAndUpdateCache').mockResolvedValue(undefined)

describe('ModelPickerModal', () => {
	beforeEach(() => {
		resetCaptured()
		modelToConnectionCache.clear()
	})

	it('lists cached models for the configured connections, sorted and filtered', () => {
		modelToConnectionCache.set('gpt-4o', 'OpenAIhttps://api.openai.com')
		modelToConnectionCache.set('claude-3', 'OpenAIhttps://api.openai.com')
		const plugin = fakePlugin({ connections: [connection()], defaults: { ...defaultPluginSettings.defaults, model: 'claude-3' } })

		const modal = makeModal(plugin)
		// default model sorts first
		expect(modal.getSuggestions('')).toEqual([
			expect.objectContaining({ name: 'claude-3', isDefault: true }),
			expect.objectContaining({ name: 'gpt-4o', isDefault: false }),
		])
	})

	it('queries filter model names case-insensitively', () => {
		modelToConnectionCache.set('gpt-4o', 'OpenAIhttps://api.openai.com')
		modelToConnectionCache.set('llama3', 'OpenAIhttps://api.openai.com')
		const plugin = fakePlugin({ connections: [connection()] })

		const modal = makeModal(plugin)
		expect(modal.getSuggestions('GPT').map((model: any) => model.name)).toEqual(['gpt-4o'])
		expect(modal.getSuggestions('zzz')).toEqual([])
	})

	it('excludes embedding, tts, whisper, and dall-e models', () => {
		for (const name of ['dall-e-3', 'text-embedding-3-small', 'tts-1', 'whisper-1']) {
			modelToConnectionCache.set(name, 'OpenAIhttps://api.openai.com')
		}
		modelToConnectionCache.set('gpt-4o', 'OpenAIhttps://api.openai.com')
		const plugin = fakePlugin({ connections: [connection()] })

		const modal = makeModal(plugin)
		expect(modal.getSuggestions('').map((model: any) => model.name)).toEqual(['gpt-4o'])
	})

	it('ignores models cached against connections that are not configured', () => {
		modelToConnectionCache.set('gpt-4o', 'OpenAIhttps://api.openai.com')
		modelToConnectionCache.set('local-model', 'OpenAIhttp://localhost:11434')
		const plugin = fakePlugin({ connections: [connection()] })

		const modal = makeModal(plugin)
		expect(modal.getSuggestions('').map((model: any) => model.name)).toEqual(['gpt-4o'])
	})

	it('shows the current connection url as subtext', () => {
		modelToConnectionCache.set('gpt-4o', 'OpenAIhttps://api.openai.com')
		const plugin = fakePlugin({ connections: [connection()] })

		const modal = makeModal(plugin)
		expect(modal.getSuggestions('')[0].connectionUrl).toBe('api.openai.com')
	})

	it('pinned models sort first, and togglePinned persists the pin', async () => {
		modelToConnectionCache.set('a-model', 'OpenAIhttps://api.openai.com')
		modelToConnectionCache.set('b-model', 'OpenAIhttps://api.openai.com')
		const plugin = fakePlugin({
			connections: [connection()],
			defaults: { ...defaultPluginSettings.defaults, model: 'b-model' },
		})

		const modal = makeModal(plugin)
		// the default model sorts first
		expect(modal.getSuggestions('').map((model: any) => model.name)).toEqual(['b-model', 'a-model'])
		const aModel = modal.getSuggestions('').find((model: any) => model.name === 'a-model')

		await modal.togglePinned(aModel)
		expect(plugin.settings.pinnedModels['a-model']).toBe(true)
		expect(plugin.saveSettings).toHaveBeenCalled()
		// now pinned, a-model sorts first
		expect(modal.getSuggestions('').map((model: any) => model.name)).toEqual(['a-model', 'b-model'])

		// refreshModels rebuilt the model list; the refreshed object is pinned
		const refreshed = modal.getSuggestions('').find((model: any) => model.name === 'a-model')
		expect(refreshed.isPinned).toBe(true)
		await modal.togglePinned(refreshed)
		expect(plugin.settings.pinnedModels['a-model']).toBeUndefined()
	})

	it('empty state text explains that a connection is needed', () => {
		const plugin = fakePlugin()
		const modal = makeModal(plugin)
		expect(modal.emptyStateText).toContain('You need to add a connection first')
	})

	it('choosing a suggestion resolves openAndGetResult with the model name', async () => {
		modelToConnectionCache.set('gpt-4o', 'OpenAIhttps://api.openai.com')
		const plugin = fakePlugin({ connections: [connection()] })
		const modal = makeModal(plugin)

		const result = modal.openAndGetResult()
		modal.onChooseSuggestion({ name: 'gpt-4o' } as any, new MouseEvent('click'))
		await expect(result).resolves.toBe('gpt-4o')
	})

	it('closing the modal without choosing resolves with null', async () => {
		const plugin = fakePlugin()
		const modal = makeModal(plugin)

		const result = modal.openAndGetResult()
		await modal.onClose()
		await new Promise((resolve) => setTimeout(resolve, 0))
		await expect(result).resolves.toBeNull()
	})

	it('uses only the alternate connection when one is provided', () => {
		modelToConnectionCache.set('gpt-4o', 'OpenAIhttps://api.openai.com')
		modelToConnectionCache.set('local-model', 'OpenAIhttp://localhost:11434')
		const plugin = fakePlugin({ connections: [connection()] })

		const modal = makeModal(plugin, { type: 'OpenAI', baseUrl: 'http://localhost:11434', apiKey: '' })
		expect(modal.getSuggestions('').map((model: any) => model.name)).toEqual(['local-model'])
	})
})

describe('ModelPickerModal.renderSuggestion', () => {
	beforeEach(() => {
		resetCaptured()
	})

	it('renders the pin, title, and connection url subtext', async () => {
		modelToConnectionCache.set('gpt-4o', 'OpenAIhttps://api.openai.com')
		const plugin = fakePlugin({ connections: [connection()], pinnedModels: { 'gpt-4o': true } })
		const modal = makeModal(plugin)

		const el = document.createElement('div')
		modal.renderSuggestion(modal.getSuggestions('')[0], el)

		expect(el.querySelector('.llmdocs-suggest-item-title')!.textContent).toBe('gpt-4o')
		expect(el.querySelector('.llmdocs-suggest-item-subtext')!.textContent).toBe('api.openai.com')
		expect(el.querySelector('.llmdocs-suggest-item-pin')!.classList.contains('pinned')).toBe(true)
	})

	it('clicking the pin toggles the pin', async () => {
		modelToConnectionCache.set('gpt-4o', 'OpenAIhttps://api.openai.com')
		const plugin = fakePlugin({ connections: [connection()] })
		const modal = makeModal(plugin)

		const el = document.createElement('div')
		modal.renderSuggestion(modal.getSuggestions('')[0], el)
		const pin = el.querySelector('.llmdocs-suggest-item-pin') as HTMLElement

		await pin.onclick!(new MouseEvent('click', { bubbles: true }))

		expect(plugin.settings.pinnedModels['gpt-4o']).toBe(true)
	})
})
