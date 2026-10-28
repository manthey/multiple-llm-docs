import { expect, it, describe, beforeEach, jest } from '@jest/globals'
import { addToolServersSettings } from './tool-servers'
import { click, fakePlugin, findButtonByLabel, notices, resetCaptured } from './test-utils'
import { McpToolServerSettings } from '../settings'
import { Platform } from 'obsidian'

jest.mock('../mcp', () => {
	const state = { connectError: null as Error | null }
	const McpManager: any = jest.fn().mockImplementation(function (this: any) {
		this.connect = jest.fn(async () => {
			if (state.connectError) throw state.connectError
		})
		this.getTools = jest.fn(() => [
			{ name: 'tool_one', description: 'A tool', inputSchema: { type: 'object' }, serverName: 'srv' },
		])
		this.disconnect = jest.fn(async () => {})
	})
	McpManager.__state = state
	return { McpManager }
})

const { McpManager }: any = jest.requireMock('../mcp')

function lastManager(): any {
	return McpManager.mock.instances[McpManager.mock.instances.length - 1]
}

function httpServer(overrides: Partial<McpToolServerSettings> = {}): McpToolServerSettings {
	return { name: 'MyServer', type: 'http', url: 'http://localhost:3000/mcp', ...overrides }
}

function render(plugin: any) {
	const container = document.createElement('div')
	const redraw = jest.fn()
	addToolServersSettings(container, plugin, redraw)
	const groups = Array.from(container.querySelectorAll('.llmdocs-connection-group'))
	const group = (index: number) => groups[index] as HTMLElement
	const inputByPlaceholder = (groupEl: HTMLElement, placeholder: string) =>
		groupEl.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!
	return { container, redraw, group, inputByPlaceholder }
}

describe('addToolServersSettings', () => {
	beforeEach(() => {
		resetCaptured()
		McpManager.__state.connectError = null
		jest.clearAllMocks()
	})

	it('renders an http server with name, url, and headers fields', () => {
		const plugin = fakePlugin({ toolServers: [httpServer({ headers: { Authorization: 'Bearer t' } })] })
		const { group, inputByPlaceholder } = render(plugin)

		expect(group(0)).toBeDefined()
		expect(inputByPlaceholder(group(0), 'Server name').value).toBe('MyServer')
		expect(inputByPlaceholder(group(0), 'URL (e.g. http://localhost:3000/mcp)').value).toBe(
			'http://localhost:3000/mcp',
		)
		expect(
			inputByPlaceholder(
				group(0),
				'Headers (Key:Value, comma-separated, e.g. Authorization:Bearer token123)',
			).value,
		).toBe('Authorization:Bearer t')
	})

	it('renders a stdio server with command, args, and env fields', () => {
		const plugin = fakePlugin({
			toolServers: [{ name: 'Local', type: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: { A: '1' } }],
		})
		const { group, inputByPlaceholder } = render(plugin)

		expect(inputByPlaceholder(group(0), 'Command (e.g. npx)').value).toBe('npx')
		expect(inputByPlaceholder(group(0), 'Arguments (space-separated)').value).toBe('-y pkg')
		expect(inputByPlaceholder(group(0), 'Environment (KEY=VALUE, space-separated)').value).toBe('A=1')
	})

	it('editing name, url saves changes', async () => {
		const plugin = fakePlugin({ toolServers: [httpServer()] })
		const { group, inputByPlaceholder } = render(plugin)

		const nameInput = group(0).querySelector<HTMLInputElement>('input[placeholder="Server name"]')!
		nameInput.value = 'Renamed'
		await nameInput.oninput!(new Event('input'))
		expect(plugin.settings.toolServers[0].name).toBe('Renamed')

		const url = inputByPlaceholder(group(0), 'URL (e.g. http://localhost:3000/mcp)')
		url.value = 'http://other:1234/mcp'
		await url.oninput!(new Event('input'))
		expect(plugin.settings.toolServers[0].url).toBe('http://other:1234/mcp')
		expect(plugin.saveSettings).toHaveBeenCalled()
	})

	it('parses headers input into a headers object, skipping invalid pairs', async () => {
		const plugin = fakePlugin({ toolServers: [httpServer()] })
		const { group, inputByPlaceholder } = render(plugin)

		const headers = inputByPlaceholder(
			group(0),
			'Headers (Key:Value, comma-separated, e.g. Authorization:Bearer token123)',
		)
		headers.value = 'Authorization:Bearer t1, not-a-pair, X-A: B2'
		await headers.oninput!(new Event('input'))

		expect(plugin.settings.toolServers[0].headers).toEqual({ Authorization: 'Bearer t1', 'X-A': 'B2' })
	})

	it('parses env input into an env object', async () => {
		const plugin = fakePlugin({
			toolServers: [{ name: 'Local', type: 'stdio', command: 'npx' }],
		})
		const { group, inputByPlaceholder } = render(plugin)

		const env = inputByPlaceholder(group(0), 'Environment (KEY=VALUE, space-separated)')
		env.value = 'KEY=value with  spaces B=2'
		await env.oninput!(new Event('input'))

		expect(plugin.settings.toolServers[0].env).toEqual({ KEY: 'value', B: '2' })
	})

	it('parses args input splitting on whitespace', async () => {
		const plugin = fakePlugin({
			toolServers: [{ name: 'Local', type: 'stdio', command: 'npx' }],
		})
		const { group, inputByPlaceholder } = render(plugin)

		const args = inputByPlaceholder(group(0), 'Arguments (space-separated)')
		args.value = '  -y   pkg  '
		await args.oninput!(new Event('input'))

		expect(plugin.settings.toolServers[0].args).toEqual(['-y', 'pkg'])
	})

	it('changing type saves and redraws', async () => {
		const plugin = fakePlugin({ toolServers: [httpServer()] })
		const { group, redraw } = render(plugin)

		const select = group(0).querySelector<HTMLSelectElement>('select')!
		select.value = 'stdio'
		await select.onchange!(new Event('change'))

		expect(plugin.settings.toolServers[0].type).toBe('stdio')
		expect(plugin.saveSettings).toHaveBeenCalled()
		expect(redraw).toHaveBeenCalled()
	})

	it('omits the stdio option on mobile', () => {
		const previous = Platform.isMobile
		Platform.isMobile = true
		try {
			const plugin = fakePlugin({ toolServers: [httpServer()] })
			const { group } = render(plugin)
			const options = Array.from(group(0).querySelectorAll('select option'))
			expect(options.map((option) => option.value)).toEqual(['http'])
		} finally {
			Platform.isMobile = previous
		}
	})

	it('Add tool server appends an http server, saves, and redraws', async () => {
		const plugin = fakePlugin()
		const { redraw } = render(plugin)

		const addButton = findButtonByLabel('Add tool server')
		await click(addButton.buttonEl)

		expect(plugin.settings.toolServers).toEqual([{ name: '', type: 'http', url: '' }])
		expect(plugin.saveSettings).toHaveBeenCalled()
		expect(redraw).toHaveBeenCalled()
	})

	it('Remove deletes the server, saves, and redraws', async () => {
		const plugin = fakePlugin({ toolServers: [httpServer(), httpServer({ name: 'Other' })] })
		const { group, redraw } = render(plugin)

		const remove = group(0).querySelector<HTMLButtonElement>('.llmdocs-connection-buttons button:nth-of-type(2)')!
		await click(remove)

		expect(plugin.settings.toolServers.length).toBe(1)
		expect(plugin.settings.toolServers[0].name).toBe('Other')
		expect(plugin.saveSettings).toHaveBeenCalled()
		expect(redraw).toHaveBeenCalled()
	})

	it('List tools connects, shows a ToolListModal, and disconnects', async () => {
		const plugin = fakePlugin({ toolServers: [httpServer()] })
		const { group } = render(plugin)

		const listButton = group(0).querySelector<HTMLButtonElement>(
			'.llmdocs-connection-buttons button:nth-of-type(1)',
		)!
		await click(listButton)

		const manager = lastManager()
		expect(manager.connect).toHaveBeenCalledWith([plugin.settings.toolServers[0]])
		expect(manager.disconnect).toHaveBeenCalled()
		// ToolListModal opened and rendered its table into the document
		expect(document.body.textContent).toContain('Tools from MyServer')
		expect(document.body.querySelectorAll('.llmdocs-tool-list-table tbody tr').length).toBe(1)
		expect(listButton.disabled).toBe(false)
		expect(listButton.textContent).toBe('List tools')
	})

	it('List tools shows a notice when connecting fails', async () => {
		McpManager.__state.connectError = new Error('boom')
		const plugin = fakePlugin({ toolServers: [httpServer()] })
		const { group } = render(plugin)

		const listButton = group(0).querySelector<HTMLButtonElement>(
			'.llmdocs-connection-buttons button:nth-of-type(1)',
		)!
		await click(listButton)

		expect(notices().some((notice) => notice.includes('Failed to connect to server: Error: boom'))).toBe(true)
		expect(listButton.textContent).toBe('List tools')
	})

	it('List all tools appears with multiple servers and connects to all of them', async () => {
		const plugin = fakePlugin({ toolServers: [httpServer(), httpServer({ name: 'Other' })] })
		const { redraw } = render(plugin)

		const listAll = findButtonByLabel('List all tools')
		expect(listAll).toBeDefined()
		await click(listAll.buttonEl)

		expect(lastManager().connect).toHaveBeenCalledWith(plugin.settings.toolServers)
		expect(document.body.textContent).toContain('All available tools')
	})

	it('List all tools button is absent with 0 or 1 servers', () => {
		const plugin = fakePlugin({ toolServers: [httpServer()] })
		render(plugin)
		expect(findButtonByLabel('List all tools')).toBeUndefined()

		const empty = fakePlugin()
		render(empty)
		expect(findButtonByLabel('List all tools')).toBeUndefined()
	})
})
