import { expect, it, describe, beforeEach, jest } from '@jest/globals'
import { addConnectionsSettings } from './connections'
import {
	click,
	fireChange,
	fireInput,
	findButtonByLabel,
	notices,
	resetCaptured,
	fakePlugin,
} from './test-utils'
import { LlmConnectionSettings } from '../settings'
import * as connectionModels from '../connection-models'

function connection(overrides: Partial<LlmConnectionSettings> = {}): LlmConnectionSettings {
	return {
		type: 'OpenAI',
		baseUrl: 'https://api.openai.com',
		apiKey: 'key-1',
		...overrides,
	}
}

function render(plugin: any) {
	const container = document.createElement('div')
	const redraw = jest.fn()
	addConnectionsSettings(container, plugin, redraw)
	const groups = Array.from(container.querySelectorAll('.llmdocs-connection-group'))
	const group = (index: number) => groups[index] as HTMLElement
	return { container, redraw, group, groups }
}

describe('addConnectionsSettings', () => {
	beforeEach(() => {
		resetCaptured()
		jest.restoreAllMocks()
	})

	it('renders one group per connection with populated fields', () => {
		const plugin = fakePlugin({
			connections: [
				connection({ apiKey: 'k1', name: 'main', baseUrl: 'https://a' }),
				connection({ apiKey: 'k2', baseUrl: 'https://b', isDefault: true }),
			],
		})
		const { container, group } = render(plugin)

		expect(container.querySelectorAll('.llmdocs-connection-group').length).toBe(2)

		const apiKey = group(0).querySelector<HTMLInputElement>('.llmdocs-connection-apikey')!
		expect(apiKey.value).toBe('k1')

		const name = group(0).querySelector<HTMLInputElement>('.llmdocs-connection-name')!
		expect(name.value).toBe('main')

		const baseUrl = group(0).querySelector<HTMLInputElement>('.llmdocs-connection-baseurl')!
		expect(baseUrl.value).toBe('https://a')

		const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
		expect(radios.map((radio) => radio.checked)).toEqual([false, true])
	})

	it('Add connection appends a default connection, saves, and redraws', async () => {
		const plugin = fakePlugin()
		const { redraw } = render(plugin)

		const addButton = findButtonByLabel('Add connection')
		expect(addButton).toBeDefined()
		await click(addButton.buttonEl)

		expect(plugin.settings.connections.length).toBe(1)
		expect(plugin.settings.connections[0]).toEqual({
			baseUrl: 'https://api.openai.com',
			apiKey: '',
			type: 'OpenAI',
			isDefault: true,
		})
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1)
		expect(redraw).toHaveBeenCalledTimes(1)
	})

	it('editing api key, base url, name, and type saves the changes', async () => {
		const plugin = fakePlugin({ connections: [connection()] })
		const { group } = render(plugin)

		const apiKey = group(0).querySelector<HTMLInputElement>('.llmdocs-connection-apikey')!
		apiKey.value = 'new-key'
		await fireInput(apiKey)
		expect(plugin.settings.connections[0].apiKey).toBe('new-key')

		const baseUrl = group(0).querySelector<HTMLInputElement>('.llmdocs-connection-baseurl')!
		baseUrl.value = 'https://example.com'
		await fireInput(baseUrl)
		expect(plugin.settings.connections[0].baseUrl).toBe('https://example.com')

		const typeSelect = group(0).querySelector<HTMLSelectElement>('select')!
		typeSelect.value = 'OpenAI'
		await fireChange(typeSelect)
		expect(plugin.settings.connections[0].type).toBe('OpenAI')

		const name = group(0).querySelector<HTMLInputElement>('.llmdocs-connection-name')!
		name.value = '  spaced  '
		await fireInput(name)
		expect(plugin.settings.connections[0].name).toBe('spaced')
	})

	it('empty name clears the name', async () => {
		const plugin = fakePlugin({ connections: [connection({ name: 'main' })] })
		const { group } = render(plugin)

		const name = group(0).querySelector<HTMLInputElement>('.llmdocs-connection-name')!
		name.value = ''
		await fireInput(name)
		expect(plugin.settings.connections[0].name).toBeUndefined()
		expect(plugin.saveSettings).toHaveBeenCalled()
	})

	it('name containing a colon shows a notice and is not saved', async () => {
		const plugin = fakePlugin({ connections: [connection({ name: 'main' })] })
		const { group } = render(plugin)

		const name = group(0).querySelector<HTMLInputElement>('.llmdocs-connection-name')!
		name.value = 'bad:name'
		await fireInput(name)

		expect(plugin.settings.connections[0].name).toBe('main')
		expect(plugin.saveSettings).not.toHaveBeenCalled()
		expect(name.classList.contains('llmdocs-connection-name-invalid')).toBe(true)
		expect(notices()).toContain('Connection short names cannot contain a colon')
	})

	it('valid name clears the invalid marker', async () => {
		const plugin = fakePlugin({ connections: [connection()] })
		const { group } = render(plugin)

		const name = group(0).querySelector<HTMLInputElement>('.llmdocs-connection-name')!
		name.value = 'bad:name'
		await fireInput(name)
		expect(name.classList.contains('llmdocs-connection-name-invalid')).toBe(true)

		name.value = 'ok'
		await fireInput(name)
		expect(name.classList.contains('llmdocs-connection-name-invalid')).toBe(false)
	})

	it('choosing the default radio makes only that connection default', async () => {
		const plugin = fakePlugin({
			connections: [connection({ baseUrl: 'https://a', isDefault: true }), connection({ baseUrl: 'https://b' })],
		})
		const { container, redraw } = render(plugin)

		const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
		expect(radios[0].checked).toBe(true)

		radios[1].checked = true
		await fireChange(radios[1])

		expect(plugin.settings.connections.map((c: LlmConnectionSettings) => c.isDefault)).toEqual([
			false,
			true,
		])
		expect(plugin.saveSettings).toHaveBeenCalled()
		expect(redraw).toHaveBeenCalled()
	})

	it('Remove deletes the connection and reselects the default', async () => {
		const plugin = fakePlugin({
			connections: [connection({ baseUrl: 'https://a', isDefault: true }), connection({ baseUrl: 'https://b' })],
		})
		const { group, redraw } = render(plugin)

		const remove = group(0).querySelector<HTMLButtonElement>('.llmdocs-connection-buttons button:nth-of-type(2)')!
		await click(remove)

		expect(plugin.settings.connections.length).toBe(1)
		expect(plugin.settings.connections[0].baseUrl).toBe('https://b')
		expect(plugin.settings.connections[0].isDefault).toBe(true)
		expect(plugin.saveSettings).toHaveBeenCalled()
		expect(redraw).toHaveBeenCalled()
	})

	it('Test button reports success via notice and re-enables the button', async () => {
		const plugin = fakePlugin({ connections: [connection()] })
		const { group } = render(plugin)
		const fetchModels = jest
			.spyOn(connectionModels, 'getAvailableModelsAndUpdateCache')
			.mockResolvedValue(undefined)

		const testButton = group(0).querySelector<HTMLButtonElement>('.llmdocs-connection-buttons button')!
		await click(testButton)

		expect(fetchModels).toHaveBeenCalledWith(plugin.settings.connections[0])
		expect(notices()).toContain('Connection success!')
		expect(testButton.disabled).toBe(false)
	})

	it('Test button reports failures via notice and re-enables the button', async () => {
		const plugin = fakePlugin({ connections: [connection()] })
		const { group } = render(plugin)
		jest.spyOn(connectionModels, 'getAvailableModelsAndUpdateCache').mockRejectedValue(
			new Error('connection refused'),
		)

		const testButton = group(0).querySelector<HTMLButtonElement>('.llmdocs-connection-buttons button')!
		await click(testButton)

		expect(notices().some((notice) => notice.includes('connection refused'))).toBe(true)
		expect(testButton.disabled).toBe(false)
	})
})
