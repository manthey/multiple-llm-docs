import { expect, it, describe, beforeEach, jest } from '@jest/globals'
import { McpManager, McpTool } from './mcp'
import { McpToolServerSettings } from './settings'
import { Platform } from 'obsidian'

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => {
	const state = {
		instances: [] as any[],
		listToolsResults: [] as any[][],
		connectErrors: [] as (Error | null)[],
		callToolResult: { content: [{ type: 'text', text: 'result text' }], isError: false } as any,
	}
	const Client: any = jest.fn().mockImplementation(function (this: any) {
		const index = state.instances.length
		state.instances.push(this)
		this.connect = jest.fn(async () => {
			const error = state.connectErrors[index]
			if (error) throw error
		})
		this.listTools = jest.fn(async () => ({ tools: state.listToolsResults[index] ?? [] }))
		this.callTool = jest.fn(async () => state.callToolResult)
		this.close = jest.fn(async () => {})
	})
	Client.__state = state
	return { Client }
})

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
	StreamableHTTPClientTransport: jest.fn().mockImplementation(() => ({})),
}))

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
	StdioClientTransport: jest.fn().mockImplementation(() => ({})),
}))

const { Client }: any = jest.requireMock('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport }: any = jest.requireMock(
	'@modelcontextprotocol/sdk/client/streamableHttp.js',
)
const { StdioClientTransport }: any = jest.requireMock('@modelcontextprotocol/sdk/client/stdio.js')

function httpServer(name: string, overrides: Partial<McpToolServerSettings> = {}): McpToolServerSettings {
	return { name, type: 'http', url: `http://${name}:3000/mcp`, ...overrides }
}

function toolsFor(names: string[]): any[] {
	return names.map((name) => ({ name, description: `${name} description`, inputSchema: {} }))
}

async function connect(configs: McpToolServerSettings[]) {
	const manager = new McpManager()
	await manager.connect(configs)
	return manager
}

describe('McpManager', () => {
	beforeEach(() => {
		Client.__state.instances.length = 0
		Client.__state.listToolsResults.length = 0
		Client.__state.connectErrors.length = 0
		Client.__state.callToolResult = { content: [{ type: 'text', text: 'result text' }], isError: false }
		jest.clearAllMocks()
		Platform.isMobile = false
	})

	it('connects to all http servers and collects their tools', async () => {
		Client.__state.listToolsResults = [toolsFor(['alpha', 'beta']), toolsFor(['gamma'])]

		const manager = await connect([httpServer('one'), httpServer('two')])
		expect(manager.getTools().map((tool) => `${tool.serverName}:${tool.name}`)).toEqual([
			'one:alpha',
			'one:beta',
			'two:gamma',
		])
		expect(manager.getTools()[0].description).toBe('alpha description')
	})

	it('passes configured headers to the http transport', async () => {
		await connect([httpServer('one', { headers: { Authorization: 'Bearer t' } })])
		const [url, options] = StreamableHTTPClientTransport.mock.calls[0]
		expect(url.href).toBe('http://one:3000/mcp')
		expect(options.requestInit.headers).toEqual({ Authorization: 'Bearer t' })
	})

	it('continues when one server fails to connect', async () => {
		Client.__state.listToolsResults = [toolsFor(['alpha']), toolsFor(['beta'])]
		Client.__state.connectErrors = [new Error('refused'), null]

		const manager = await connect([httpServer('bad'), httpServer('good')])
		expect(manager.getTools().map((tool) => tool.name)).toEqual(['beta'])
	})

	it('ignores servers that provide no tools', async () => {
		Client.__state.listToolsResults = [[]]

		const manager = await connect([httpServer('empty')])
		expect(manager.getTools()).toEqual([])
	})

	it('connects stdio servers with command, args, and env', async () => {
		Client.__state.listToolsResults = [toolsFor(['alpha'])]

		const manager = await connect([
			{ name: 'local', type: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: { KEY: 'value' } },
		])
		expect(manager.getTools().map((tool) => tool.name)).toEqual(['alpha'])
		const [options] = StdioClientTransport.mock.calls[0]
		expect(options).toEqual({ command: 'npx', args: ['-y', 'pkg'], env: { KEY: 'value' } })
	})

	it('skips stdio servers on mobile', async () => {
		Platform.isMobile = true
		Client.__state.listToolsResults = [toolsFor(['alpha'])]

		const manager = await connect([{ name: 'local', type: 'stdio', command: 'npx' }])
		expect(StdioClientTransport).not.toHaveBeenCalled()
		expect(manager.getTools()).toEqual([])
	})

	it('skips stdio servers when the transport is unavailable', async () => {
		Client.__state.listToolsResults = [toolsFor(['alpha'])]
		StdioClientTransport.mockImplementationOnce(() => {
			throw new Error('not available')
		})

		const manager = await connect([{ name: 'local', type: 'stdio', command: 'npx' }])
		expect(manager.getTools()).toEqual([])
	})

	describe('getTools filtering', () => {
		let manager: McpManager
		beforeEach(async () => {
			Client.__state.listToolsResults = [toolsFor(['alpha', 'beta']), toolsFor(['gamma'])]
			manager = await connect([httpServer('one'), httpServer('two')])
		})

		it('returns all tools with no filter', () => {
			expect(manager.getTools().length).toBe(3)
		})

		it('returns nothing for an empty filter list', () => {
			expect(manager.getTools([])).toEqual([])
		})

		it('filters by tool name', () => {
			expect(manager.getTools(['alpha', 'gamma']).map((tool) => tool.name)).toEqual(['alpha', 'gamma'])
		})

		it('filters by server name', () => {
			expect(manager.getTools(['two']).map((tool) => tool.name)).toEqual(['gamma'])
		})
	})

	describe('getOpenaiTools', () => {
		beforeEach(async () => {
			Client.__state.listToolsResults = [
				[
					{
						name: 'search',
						description: 'x'.repeat(300),
						inputSchema: {
							type: 'object',
							description: 'schema description',
							properties: { query: { type: 'string', description: 'y'.repeat(300) } },
							required: ['query'],
						},
					},
				],
			]
		})

		it('maps tools to openai function definitions within budget', async () => {
			const manager = await connect([httpServer('one')])
			const defs = manager.getOpenaiTools(undefined, 8192)

			expect(defs).toEqual([
				{
					type: 'function',
					function: {
						name: 'search',
						description: 'x'.repeat(300),
						parameters: {
							type: 'object',
							description: 'schema description',
							properties: { query: { type: 'string', description: 'y'.repeat(300) } },
							required: ['query'],
						},
						serverName: 'one',
					},
				},
			])
		})

		it('reduces definitions when they exceed the token budget', async () => {
			const manager = await connect([httpServer('one')])
			const defs = manager.getOpenaiTools(undefined, 10)

			expect(defs.length).toBe(1)
			const def = defs[0]
			// all reduction passes applied: description emptied, nested
			// descriptions stripped
			expect(def.function.description).toBe('')
			expect(def.function.parameters.description).toBeUndefined()
			expect((def.function.parameters as any).properties.query.description).toBeUndefined()
			// non-description schema keys are preserved
			expect(def.function.parameters.type).toBe('object')
			expect((def.function.parameters as any).required).toEqual(['query'])
		})
	})

	describe('callTool', () => {
		let manager: McpManager
		beforeEach(async () => {
			Client.__state.listToolsResults = [toolsFor(['alpha']), toolsFor(['gamma'])]
			manager = await connect([httpServer('one'), httpServer('two')])
		})

		it('routes to the server that owns the tool', async () => {
			const result = await manager.callTool({ name: 'gamma', arguments: { a: 1 } })

			expect(result).toEqual({
				content: 'result text',
				isError: false,
				name: 'gamma',
				serverName: 'two',
			})
			expect(Client.__state.instances[1].callTool).toHaveBeenCalledWith({ name: 'gamma', arguments: { a: 1 } })
			expect(Client.__state.instances[0].callTool).not.toHaveBeenCalled()
		})

		it('joins multiple text content parts', async () => {
			Client.__state.callToolResult = {
				content: [
					{ type: 'text', text: 'part one' },
					{ type: 'image', url: 'x' },
					{ type: 'text', text: 'part two' },
				],
			}
			const result = await manager.callTool({ name: 'alpha', arguments: {} })
			expect(result.content).toBe('part one\npart two')
		})

		it('propagates isError', async () => {
			Client.__state.callToolResult = { content: [{ type: 'text', text: 'boom' }], isError: true }
			const result = await manager.callTool({ name: 'alpha', arguments: {} })
			expect(result.isError).toBe(true)
		})

		it('returns an error result for unknown tools', async () => {
			const result = await manager.callTool({ name: 'nope', arguments: {} })
			expect(result.isError).toBe(true)
			expect(result.content).toContain('Tool "nope" not found')
		})
	})

	it('disconnect closes every client and clears the servers', async () => {
		Client.__state.listToolsResults = [toolsFor(['alpha']), toolsFor(['beta'])]
		const manager = await connect([httpServer('one'), httpServer('two')])

		await manager.disconnect()

		expect(Client.__state.instances.map((client: any) => client.close).every((close: any) => close.mock.calls.length === 1)).toBe(true)
		expect(manager.getTools()).toEqual([])
	})

	it('disconnect tolerates clients that fail to close', async () => {
		Client.__state.listToolsResults = [toolsFor(['alpha'])]
		const manager = await connect([httpServer('one')])
		Client.__state.instances[0].close.mockRejectedValue(new Error('already closed'))

		await expect(manager.disconnect()).resolves.toBeUndefined()
		expect(manager.getTools()).toEqual([])
	})
})
