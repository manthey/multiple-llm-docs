import { expect, it, describe, beforeEach, jest } from '@jest/globals'
import { ToolPickerModal } from './tool-picker'
import { McpToolServerSettings } from '../settings'
import { fakeApp, resetCaptured } from './test-utils'

jest.mock('../mcp', () => {
	const state = {
		connectError: null as Error | null,
		tools: [
			{ name: 'zeta', description: 'Z tool', inputSchema: {}, serverName: 'alpha' },
			{ name: 'beta', description: 'B tool', inputSchema: {}, serverName: 'alpha' },
			{ name: 'other', description: 'Other', inputSchema: {}, serverName: 'omega' },
		],
	}
	const McpManager: any = jest.fn().mockImplementation(function (this: any) {
		this.connect = jest.fn(async () => {
			if (state.connectError) throw state.connectError
		})
		this.getTools = jest.fn(() => state.tools)
		this.disconnect = jest.fn(async () => {})
	})
	McpManager.__state = state
	return { McpManager }
})

const { McpManager }: any = jest.requireMock('../mcp')

function lastManager(): any {
	return McpManager.mock.instances[McpManager.mock.instances.length - 1]
}

function server(name: string): McpToolServerSettings {
	return { name, type: 'http', url: 'http://localhost/mcp' }
}

async function openModal(currentFilters: string[] | null = null) {
	const modal = new ToolPickerModal(fakeApp(), [server('alpha'), server('omega')], currentFilters)
	const result = modal.openAndGetResult()
	await (modal as any)._onOpenDone
	return { modal, result }
}

describe('ToolPickerModal', () => {
	beforeEach(() => {
		resetCaptured()
		McpManager.__state.connectError = null
		document.body.innerHTML = ''
	})

	it('renders one section per server with a checkbox for the server and each tool', async () => {
		const { modal } = await openModal()

		const sections = modal.contentEl.querySelectorAll('details.llmdocs-tool-picker-section')
		expect(sections.length).toBe(2)
		const checkboxes = modal.contentEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
		// 2 servers + 3 tools
		expect(checkboxes.length).toBe(5)
	})

	it('sorts tools within a server section by name', async () => {
		const { modal } = await openModal()

		const firstSection = modal.contentEl.querySelector('details')!
		const labels = Array.from(firstSection.querySelectorAll('strong, span')).map((el) => el.textContent)
		expect(labels).toContain('beta')
		expect(labels.indexOf('beta')).toBeLessThan(labels.indexOf('zeta'))
	})

	it('apply resolves with the selected tool names', async () => {
		const { modal, result } = await openModal()

		const checkboxes = modal.contentEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
		// server checkbox for alpha (index 0) selects the whole server
		checkboxes[0].checked = true
		await checkboxes[0].onchange!(new Event('change'))

		const apply = Array.from(modal.contentEl.querySelectorAll('button')).find(
			(button) => button.textContent === 'Apply',
		)!
		await apply.onclick!(new Event('click'))

		await expect(result).resolves.toEqual(['alpha'])
	})

	it('checking an individual tool resolves with just that tool', async () => {
		const { modal, result } = await openModal()

		const checkboxes = modal.contentEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
		// index 1 is the first tool checkbox (beta) inside the alpha section
		checkboxes[1].checked = true
		await checkboxes[1].onchange!(new Event('change'))

		const apply = Array.from(modal.contentEl.querySelectorAll('button')).find(
			(button) => button.textContent === 'Apply',
		)!
		await apply.onclick!(new Event('click'))

		await expect(result).resolves.toEqual(['beta'])
	})

	it('preselects checkboxes matching the current filters', async () => {
		const { modal } = await openModal(['zeta'])

		const checkboxes = modal.contentEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
		const checked = Array.from(checkboxes).filter((checkbox) => checkbox.checked)
		// only the zeta tool checkbox is preselected
		expect(checked.length).toBe(1)

		// the section containing it is open
		const section = checked[0].closest('details')!
		expect(section.hasAttribute('open')).toBe(true)
	})

	it('cancel resolves with null', async () => {
		const { modal, result } = await openModal()

		const cancel = Array.from(modal.contentEl.querySelectorAll('button')).find(
			(button) => button.textContent === 'Cancel',
		)!
		await cancel.onclick!(new Event('click'))

		await expect(result).resolves.toBeNull()
	})

	it('shows an error message when connecting fails', async () => {
		McpManager.__state.connectError = new Error('no server')
		const modal = new ToolPickerModal(fakeApp(), [server('alpha')], null)
		const result = modal.openAndGetResult()
		await (modal as any)._onOpenDone

		expect(modal.contentEl.textContent).toContain('Failed to connect: Error: no server')
	})

	it('shows a message when no tools are available', async () => {
		McpManager.__state.tools = []
		const { modal, result } = await openModal()

		expect(modal.contentEl.textContent).toContain('No tools found.')
		// apply with no options yields an empty selection
		const apply = Array.from(modal.contentEl.querySelectorAll('button')).find(
			(button) => button.textContent === 'Apply',
		)!
		await apply.onclick!(new Event('click'))
		await expect(result).resolves.toEqual([])
	})
})
