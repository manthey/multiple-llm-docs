import { expect, it, describe, beforeEach, jest } from '@jest/globals'
import { SettingsTab } from './index'
import {
	capturedDropdowns,
	capturedToggles,
	click,
	fakePlugin,
	findButtonByLabel,
	findTextByPlaceholder,
	findTextByValue,
	resetCaptured,
} from './test-utils'
import { modelCacheUpdated } from '../registry'
import { DocOpenMethods } from '../settings'

jest.mock('./model-picker', () => ({
	ModelPickerModal: jest.fn().mockImplementation(() => ({
		openAndGetResult: jest.fn().mockResolvedValue('picked-model'),
	})),
}))

// Avoid loading the ESM-only MCP SDK through tool-servers.ts.
jest.mock('../mcp', () => ({
	McpManager: jest.fn(),
}))

function makeTab(plugin: any) {
	return new SettingsTab(plugin.app, plugin)
}

describe('SettingsTab', () => {
	beforeEach(() => {
		resetCaptured()
		jest.clearAllMocks()
	})

	it('display() renders all top-level settings', () => {
		const plugin = fakePlugin()
		const tab = makeTab(plugin)
		tab.display()

		const text = tab.containerEl.textContent!
		for (const name of [
			'LLM docs directory',
			'Create new documents in...',
			'Stay awake while completing',
			'All tools available by default',
			'Tool servers (MCP)',
			'Connections',
			'Defaults',
			'Default model',
			'Default system prompt',
			'Frontmatter parameters (llm_*)',
			'llm_temperature',
		]) {
			expect(text).toContain(name)
		}
	})

	it('changing the docs directory saves it', async () => {
		const plugin = fakePlugin()
		const tab = makeTab(plugin)
		tab.display()

		const docsDir = findTextByPlaceholder('path/to/directory')
		expect(docsDir.inputEl.value).toBe('LLM')
		await docsDir._onChange('NewDir')

		expect(plugin.settings.docsDir).toBe('NewDir')
		expect(plugin.saveSettings).toHaveBeenCalled()
	})

	it('changing the document open method saves it', async () => {
		const plugin = fakePlugin()
		const tab = makeTab(plugin)
		tab.display()

		const dropdown = capturedDropdowns()[0]
		expect(dropdown.getValue()).toBe(DocOpenMethods.tab)
		await dropdown._onChange(DocOpenMethods.window)

		expect(plugin.settings.defaults.docOpenMethod).toBe(DocOpenMethods.window)
		expect(plugin.saveSettings).toHaveBeenCalled()
	})

	it('toggling stay awake saves it', async () => {
		const plugin = fakePlugin()
		const tab = makeTab(plugin)
		tab.display()

		const toggle = capturedToggles()[0]
		expect(toggle.getValue()).toBe(false)
		await toggle._onChange(true)

		expect(plugin.settings.stayAwake).toBe(true)
		expect(plugin.saveSettings).toHaveBeenCalled()
	})

	it('toggling tools default to all saves it', async () => {
		const plugin = fakePlugin({ toolsDefaultToAll: true })
		const tab = makeTab(plugin)
		tab.display()

		const toggle = capturedToggles()[1]
		await toggle._onChange(false)

		expect(plugin.settings.toolsDefaultToAll).toBe(false)
		expect(plugin.saveSettings).toHaveBeenCalled()
	})

	it('changing the default model text saves it', async () => {
		const plugin = fakePlugin()
		const tab = makeTab(plugin)
		tab.display()

		const modelText = findTextByValue('gpt-4o')
		await modelText._onChange('new-model')

		expect(plugin.settings.defaults.model).toBe('new-model')
		expect(plugin.saveSettings).toHaveBeenCalled()
	})

	it('changing the default system prompt saves it', async () => {
		const plugin = fakePlugin()
		const tab = makeTab(plugin)
		tab.display()

		const prompt = findTextByPlaceholder('System prompt')
		await prompt._onChange('You are helpful')

		expect(plugin.settings.defaults.systemPrompt).toBe('You are helpful')
		expect(plugin.saveSettings).toHaveBeenCalled()
	})

	it('Select button opens the model picker and saves the chosen model', async () => {
		const plugin = fakePlugin()
		const tab = makeTab(plugin)
		tab.display()

		const displaySpy = jest.spyOn(tab, 'display')
		const selectButton = findButtonByLabel('Select')
		await click(selectButton.buttonEl)

		expect(plugin.settings.defaults.model).toBe('picked-model')
		expect(plugin.saveSettings).toHaveBeenCalled()
		// display() is re-invoked to refresh the text box
		expect(displaySpy).toHaveBeenCalled()
	})

	it('Select button does not save when the picker is dismissed', async () => {
		const { ModelPickerModal }: any = jest.requireMock('./model-picker')
		ModelPickerModal.mockImplementation(() => ({
			openAndGetResult: jest.fn().mockResolvedValue(null),
		}))
		const plugin = fakePlugin()
		const tab = makeTab(plugin)
		tab.display()

		const selectButton = findButtonByLabel('Select')
		await click(selectButton.buttonEl)

		expect(plugin.settings.defaults.model).toBe('gpt-4o')
		expect(plugin.saveSettings).not.toHaveBeenCalled()
	})

	it('modelCacheUpdated re-renders the tab, and hide() unsubscribes', () => {
		const plugin = fakePlugin()
		const tab = makeTab(plugin)
		const displaySpy = jest.spyOn(tab, 'display')

		modelCacheUpdated.emit()
		expect(displaySpy).toHaveBeenCalledTimes(1)

		tab.hide()
		modelCacheUpdated.emit()
		expect(displaySpy).toHaveBeenCalledTimes(1)
	})
})
