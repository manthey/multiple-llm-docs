import { expect, it, describe, beforeEach, jest } from '@jest/globals'
import { LlmDoc } from './llm-doc'
import { DefaultsSettings, DocOpenMethods, LlmConnectionSettings, McpToolServerSettings } from './settings'
import { OpenaiBasicMessage } from './open-ai'
import { TFile } from 'obsidian'

jest.mock('./open-ai', () => {
	const actual = jest.requireActual('./open-ai')
	const { SimpleEventEmitter } = jest.requireActual('./utils')
	const state = { behaviors: [] as any[], instances: [] as any[] }
	class FakeStream extends SimpleEventEmitter {
		entireContent = ''
		toolCalls: any[] = []
		constructor(
			public settings: any,
			public model: string,
			public messages: any[],
			public llmParams?: any,
			public tools?: any,
		) {
			super()
			state.instances.push(this)
		}
		result() {
			return new Promise<string>((resolve, reject) => {
				this.on('error', (error: any) => reject(error))
				this.on('end', () => resolve(this.entireContent))
				const behavior = state.behaviors.shift() ?? { content: '' }
				if (behavior.error) {
					this.emit('error', behavior.error)
					return
				}
				this.entireContent = behavior.content
				this.toolCalls = behavior.toolCalls ?? []
				queueMicrotask(() => {
					this.emit('data', behavior.content)
					this.emit('end')
				})
			})
		}
		stop() {}
	}
	;(FakeStream as any).__state = state
	return { ...actual, OpenaiChatCompletionStream: FakeStream }
})

jest.mock('./mcp', () => {
	const state = { callToolResults: [] as any[], connectError: null as Error | null }
	const McpManager: any = jest.fn().mockImplementation(function (this: any) {
		this.connect = jest.fn(async () => {
			if (state.connectError) throw state.connectError
		})
		this.getOpenaiTools = jest.fn(() => [])
		this.callTool = jest.fn(async (request: any) => {
			return (
				state.callToolResults.shift() ?? { content: '', isError: false, name: request.name }
			)
		})
		this.disconnect = jest.fn(async () => {})
	})
	McpManager.__state = state
	return { McpManager }
})

const { OpenaiChatCompletionStream }: any = jest.requireMock('./open-ai')
const { McpManager }: any = jest.requireMock('./mcp')

const streamState = () => OpenaiChatCompletionStream.__state as {
	behaviors: any[]
	instances: any[]
}
const mcpState = () => McpManager.__state as { callToolResults: any[]; connectError: Error | null }
function lastManager(): any {
	return McpManager.mock.instances[McpManager.mock.instances.length - 1]
}

const defaults: DefaultsSettings = {
	model: 'gpt-4o',
	systemPrompt: '',
	docOpenMethod: DocOpenMethods.tab,
}

const connections: LlmConnectionSettings[] = [
	{ type: 'OpenAI', baseUrl: 'https://default', apiKey: 'def-key', name: 'main', isDefault: true },
]

function fakeApp() {
	const app = {
		vault: {
			read: jest.fn(async (file: any) => file.content),
			create: jest.fn(async (path: string, content: string) => {
				const file: any = { path, content, fm: {} }
				return file
			}),
			append: jest.fn(async (file: any, text: string) => {
				file.content += text
			}),
		},
		fileManager: {
			processFrontMatter: jest.fn(async (file: any, fn: any) => {
				if (!file.fm) file.fm = {}
				fn(file.fm)
			}),
		},
		metadataCache: { getFirstLinkpathDest: () => null },
	}
	return app as any
}

function fakeEditor() {
	return { setCursor: jest.fn(), lastLine: () => 5 } as any
}

function fakeFile(content: string): TFile {
	return { content, fm: {} } as unknown as TFile
}

const toolServers: McpToolServerSettings[] = [{ name: 'srv', type: 'http', url: 'http://localhost/mcp' }]

async function completeDoc(app: any, file: TFile, editor = fakeEditor()) {
	const doc = await LlmDoc.fromFile(app, file, defaults)
	await doc.complete(connections, editor, [])
	return doc
}

describe('LlmDoc.fromFile', () => {
	beforeEach(() => {
		streamState().behaviors.length = 0
		streamState().instances.length = 0
		mcpState().callToolResults.length = 0
	})

	it('parses frontmatter into properties', async () => {
		const app = fakeApp()
		const file = fakeFile(
			[
				'---',
				'model:',
				'  - m1',
				'  - m2',
				'llm_temperature: 0.7',
				'llm_max_image_size: 512',
				'llm_connection: main',
				'llm_tools:',
				'  - t1',
				'llm_tool_servers:',
				'  - name: override',
				'    type: http',
				'    url: http://x/mcp',
				'---',
				'# user',
				'hello',
			].join('\n'),
		)

		const doc = await LlmDoc.fromFile(app, file, defaults)
		expect(doc.properties).toEqual({
			model: ['m1', 'm2'],
			connection: 'main',
			llmParams: { temperature: 0.7 },
			maxImageSize: 512,
			toolFilters: ['t1'],
			toolServerOverrides: [{ name: 'override', type: 'http', url: 'http://x/mcp' }],
		})
	})

	it('treats a string llm_tools as a one-element filter list', async () => {
		const app = fakeApp()
		const file = fakeFile(['---', 'llm_tools: t1', '---', 'hello'].join('\n'))
		const doc = await LlmDoc.fromFile(app, file, defaults)
		expect(doc.properties.toolFilters).toEqual(['t1'])
	})

	it('defaults tool filters to none when all tools are disabled', async () => {
		const app = fakeApp()
		const file = fakeFile('hello')
		const doc = await LlmDoc.fromFile(app, file, defaults, false)
		expect(doc.properties.toolFilters).toEqual([])
	})

	it('without frontmatter the whole text is a user message and the default model applies', async () => {
		const app = fakeApp()
		const file = fakeFile('hello')
		const doc = await LlmDoc.fromFile(app, file, defaults)

		expect(doc.properties.model).toBe('gpt-4o')
		expect(doc.properties.llmParams).toEqual({})
	})

	it('create() writes the messages as text and sets the model in frontmatter', async () => {
		const app = fakeApp()
		const messages: OpenaiBasicMessage[] = [
			{ role: 'system', content: 'be helpful' },
			{ role: 'user', content: 'hi' },
		]

		const doc = await LlmDoc.create(app, 'LLM/test.md', { model: 'gpt-4o' }, messages)

		const file: any = doc.file
		expect(file.content).toBe('# system\nbe helpful\n# user\nhi')
		expect(file.fm.model).toBe('gpt-4o')
	})
})

describe('LlmDoc.complete', () => {
	beforeEach(() => {
		streamState().behaviors.length = 0
		streamState().instances.length = 0
		mcpState().callToolResults.length = 0
		mcpState().connectError = null
	})

	it('appends the assistant heading, content, and a trailing user heading', async () => {
		const app = fakeApp()
		const file = fakeFile('---\nmodel: m1\n---\n# user\nhello\n')
		streamState().behaviors = [{ content: 'the answer' }]

		await completeDoc(app, file)

		expect(file.content).toBe('---\nmodel: m1\n---\n# user\nhello\n\n# assistant\nthe answer\n# user\n')
		// model already in frontmatter: no frontmatter write
		expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled()
	})

	it('passes the resolved connection and preprocessed messages to the stream', async () => {
		const app = fakeApp()
		const file = fakeFile('---\nmodel: m1\n---\n# user\nhello\n')
		streamState().behaviors = [{ content: 'ok' }]

		await completeDoc(app, file)

		const stream = streamState().instances[0]
		expect(stream.settings).toBe(connections[0])
		expect(stream.model).toBe('m1')
		expect(stream.messages).toEqual([{ role: 'user', content: 'hello\n' }])
	})

	it('writes the default model into frontmatter when missing', async () => {
		const app = fakeApp()
		const file = fakeFile('hello')
		streamState().behaviors = [{ content: 'ok' }]

		await completeDoc(app, file)

		expect(file.fm.model).toBe('gpt-4o')
	})

	it('passes llm params and tools to the stream and connects MCP servers', async () => {
		const app = fakeApp()
		const file = fakeFile('---\nmodel: m1\nllm_temperature: 0.7\n---\nhello\n')
		streamState().behaviors = [{ content: 'ok' }]

		const doc = await LlmDoc.fromFile(app, file, defaults)
		await doc.complete(connections, fakeEditor(), toolServers)

		const stream = streamState().instances[0]
		expect(stream.llmParams).toEqual({ temperature: 0.7 })
		expect(lastManager().connect).toHaveBeenCalledWith(toolServers)
		expect(lastManager().disconnect).toHaveBeenCalled()
	})

	it('tolerates MCP connection failures and continues without tools', async () => {
		const app = fakeApp()
		const file = fakeFile('---\nmodel: m1\n---\nhello\n')
		streamState().behaviors = [{ content: 'ok' }]
		mcpState().connectError = new Error('no server')

		const doc = await LlmDoc.fromFile(app, file, defaults)
		await expect(doc.complete(connections, fakeEditor(), toolServers)).resolves.toBeUndefined()
		expect(file.content).toContain('# assistant\nok')
	})

	it('uses the connection named in llm_connection', async () => {
		const app = fakeApp()
		const file = fakeFile('---\nmodel: m1\nllm_connection: main\n---\nhello\n')
		streamState().behaviors = [{ content: 'ok' }]

		await completeDoc(app, file)

		expect(streamState().instances[0].settings).toBe(connections[0])
	})

	it('executes tool calls and feeds the results back to the model', async () => {
		const app = fakeApp()
		const file = fakeFile('---\nmodel: m1\n---\nhello\n')
		streamState().behaviors = [
			{
				content: 'using tool',
				toolCalls: [
					{ id: 't1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } },
				],
			},
			{ content: 'final answer' },
		]
		mcpState().callToolResults = [{ content: 'tool result text', isError: false, name: 'search', serverName: 'srv' }]

		const doc = await LlmDoc.fromFile(app, file, defaults)
		await doc.complete(connections, fakeEditor(), toolServers)

		expect(file.content).toContain('using tool')
		expect(file.content).toContain('final answer')
		expect(file.content).toContain(' `tool: search, server: srv, result: 16 characters`\n')

		const manager = lastManager()
		expect(manager.callTool).toHaveBeenCalledWith({ name: 'search', arguments: { q: 'x' } })
		expect(manager.disconnect).toHaveBeenCalled()

		// the follow-up request contains the assistant tool call and the tool result
		const secondStream = streamState().instances[1]
		const roles = secondStream.messages.map((message: any) => message.role)
		expect(roles).toEqual(['user', 'assistant', 'tool'])
		expect(secondStream.messages[1].tool_calls).toEqual([
			{ id: 't1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } },
		])
		expect(secondStream.messages[2].content).toBe('tool result text')
	})

	it('reports failed tool calls in the document', async () => {
		const app = fakeApp()
		const file = fakeFile('---\nmodel: m1\n---\nhello\n')
		streamState().behaviors = [
			{
				content: '',
				toolCalls: [{ id: 't1', type: 'function', function: { name: 'search', arguments: '{}' } }],
			},
			{ content: 'recovered' },
		]
		mcpState().callToolResults = [{ content: 'nope', isError: true, name: 'search' }]

		const doc = await LlmDoc.fromFile(app, file, defaults)
		await doc.complete(connections, fakeEditor(), toolServers)

		expect(file.content).toContain(' `tool: search, failed`\n')
		expect(file.content).toContain('recovered')
	})

	it('unparsable tool arguments are passed as empty arguments', async () => {
		const app = fakeApp()
		const file = fakeFile('---\nmodel: m1\n---\nhello\n')
		streamState().behaviors = [
			{
				content: '',
				toolCalls: [{ id: 't1', type: 'function', function: { name: 'search', arguments: 'not json' } }],
			},
			{ content: 'done' },
		]

		const doc = await LlmDoc.fromFile(app, file, defaults)
		await doc.complete(connections, fakeEditor(), toolServers)

		expect(lastManager().callTool).toHaveBeenCalledWith({
			name: 'search',
			arguments: {},
		})
	})

	it('continues to the next model when one model errors', async () => {
		const app = fakeApp()
		const file = fakeFile('---\nmodel:\n  - m1\n  - m2\n---\nhello\n')
		streamState().behaviors = [{ error: new Error('bad model') }, { content: 'ok from m2' }]

		await completeDoc(app, file)

		expect(file.content).toContain('# assistant2 (m2)\nok from m2')
		expect(file.content).not.toContain('# assistant1')
	})

	it('rethrows the error for a single-model document', async () => {
		const app = fakeApp()
		const file = fakeFile('---\nmodel: m1\n---\nhello\n')
		streamState().behaviors = [{ error: new Error('bad model') }]

		await expect(completeDoc(app, file)).rejects.toThrow('bad model')
	})

	it('does nothing but append the user heading when stopped', async () => {
		const app = fakeApp()
		const file = fakeFile('---\nmodel: m1\n---\nhello\n')

		const doc = await LlmDoc.fromFile(app, file, defaults)
		await doc.stop()
		await doc.complete(connections, fakeEditor(), [])

		expect(streamState().instances.length).toBe(0)
		expect(file.content).toBe('---\nmodel: m1\n---\nhello\n\n# user\n')
	})
})
