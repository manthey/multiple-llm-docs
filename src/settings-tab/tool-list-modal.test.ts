import { expect, it, describe, beforeEach } from '@jest/globals'
import { ToolListModal } from './tool-list-modal'
import { fakeApp } from './test-utils'
import { McpTool } from '../mcp'

function tool(overrides: Partial<McpTool> = {}): McpTool {
	return {
		name: 'search',
		description: 'Search the web',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'The query' },
				limit: { type: 'number' },
			},
			required: ['query'],
		},
		serverName: 'web',
		...overrides,
	}
}

describe('ToolListModal', () => {
	beforeEach(() => {
		document.body.innerHTML = ''
	})

	it('renders a table with one row per tool and parameter details', () => {
		const modal = new ToolListModal(fakeApp(), [tool()], 'Tools from web')
		modal.onOpen()

		const content = modal.contentEl
		expect(content.querySelector('h2')!.textContent).toBe('Tools from web')
		expect(content.textContent).toContain('1 tool available')
		const rows = content.querySelectorAll('.llmdocs-tool-list-table tbody tr')
		expect(rows.length).toBe(1)

		const row = rows[0]
		expect(row.textContent).toContain('search')
		expect(row.textContent).toContain('Search the web')
		expect(row.textContent).toContain('web')
		expect(row.textContent).toContain('query')
		expect(row.textContent).toContain('string, required')
		expect(row.textContent).toContain('The query')
		expect(row.textContent).toContain('limit')
	})

	it('marks optional parameters as not required', () => {
		const modal = new ToolListModal(fakeApp(), [tool()], 'Tools')
		modal.onOpen()
		const li = modal.contentEl.querySelectorAll('.llmdocs-tool-param-list li')[1]
		expect(li.textContent).toContain('limit (number)')
	})

	it('shows "(none)" for a tool without parameters', () => {
		const modal = new ToolListModal(fakeApp(), [tool({ inputSchema: {} })], 'Tools')
		modal.onOpen()
		expect(modal.contentEl.textContent).toContain('(none)')
	})

	it('falls back to server name when the tool has no description', () => {
		const modal = new ToolListModal(fakeApp(), [tool({ description: '' })], 'Tools')
		modal.onOpen()
		expect(modal.contentEl.textContent).toContain('(none)')
	})

	it('shows a message when no tools are found', () => {
		const modal = new ToolListModal(fakeApp(), [], 'No tools here')
		modal.onOpen()
		expect(modal.contentEl.textContent).toContain('No tools found.')
		expect(modal.contentEl.querySelector('table')).toBeNull()
	})

	it('pluralizes the tool count', () => {
		const modal = new ToolListModal(fakeApp(), [tool(), tool({ name: 'other' })], 'Tools')
		modal.onOpen()
		expect(modal.contentEl.textContent).toContain('2 tools available')
	})

	it('onClose empties the content', () => {
		const modal = new ToolListModal(fakeApp(), [tool()], 'Tools')
		modal.onOpen()
		modal.onClose()
		expect(modal.contentEl.children.length).toBe(0)
	})
})
