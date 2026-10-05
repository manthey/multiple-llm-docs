import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpToolServerSettings } from './settings'
import { Platform } from 'obsidian'

export interface McpTool {
	name: string
	description: string
	inputSchema: Record<string, unknown>
	serverName: string
}

export interface ToolCallRequest {
	name: string
	arguments: Record<string, unknown>
}

export interface ToolCallResult {
	content: string
	isError: boolean
	name: string
	serverName?: string
}

interface ConnectedServer {
	client: Client
	serverName: string
	tools: McpTool[]
}

export class McpManager {
	private servers: ConnectedServer[] = []

	async connect(serverConfigs: McpToolServerSettings[]): Promise<void> {
		const promises = serverConfigs.map((config) => this.connectServer(config))
		const results = await Promise.allSettled(promises)
		for (const result of results) {
			if (result.status === 'fulfilled' && result.value) {
				this.servers.push(result.value)
			} else if (result.status === 'rejected') {
				console.error('Failed to connect MCP server:', result.reason)
			}
		}
	}

	private async connectServer(config: McpToolServerSettings): Promise<ConnectedServer | null> {
		const client = new Client({ name: 'multiple-llm-docs', version: '1.0.0' })
		const transport = await this.createTransport(config)
		if (!transport) return null

		await client.connect(transport)

		const response = await client.listTools()
		const tools: McpTool[] = response.tools.map((t) => ({
			name: t.name,
			description: t.description ?? '',
			inputSchema: t.inputSchema as Record<string, unknown>,
			serverName: config.name,
		}))

		return { client, serverName: config.name, tools }
	}

	private async createTransport(config: McpToolServerSettings) {
		if (config.type === 'http' || (!config.type && config.url)) {
			const transportOptions: { requestInit?: RequestInit } = {}
			if (config.headers && Object.keys(config.headers).length > 0) {
				transportOptions.requestInit = {
					headers: config.headers,
				}
			}
			return new StreamableHTTPClientTransport(new URL(config.url!), transportOptions)
		}

		if (config.type === 'stdio' || (!config.type && config.command)) {
			if (Platform.isMobile) {
				console.warn('Stdio MCP servers are not supported on mobile')
				return null
			}
			try {
				const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
				return new StdioClientTransport({
					command: config.command!,
					args: config.args ?? [],
					env: config.env as Record<string, string> | undefined,
				})
			} catch {
				console.error('Stdio transport not available in this environment')
				return null
			}
		}

		return null
	}

	getTools(filterNames?: string[]): McpTool[] {
		if (filterNames !== undefined && !filterNames.length) return []
		const allTools = this.servers.flatMap((s) => s.tools)
		console.info('All tools', allTools)
		if (!filterNames) return allTools
		return allTools.filter((t) => filterNames.includes(t.name) || filterNames.includes(t.serverName))
	}

	getOpenaiTools(filterNames?: string[], maxTokens = 8192): OpenaiToolDef[] {
		const defs = this.getTools(filterNames).map((t) => ({
			type: 'function' as const,
			function: {
				name: t.name,
				description: t.description,
				parameters: t.inputSchema,
				serverName: t.serverName,
			},
		}))
		return fitToolDefsToTokenBudget(defs, maxTokens)
	}

	async callTool(request: ToolCallRequest): Promise<ToolCallResult> {
		for (const server of this.servers) {
			const hasTool = server.tools.some((t) => t.name === request.name)
			if (!hasTool) continue

			const result = await server.client.callTool({
				name: request.name,
				arguments: request.arguments,
			})

			const textParts = (result.content as Array<{ type: string; text?: string }>)
				.filter((c) => c.type === 'text' && c.text)
				.map((c) => c.text!)

			return {
				content: textParts.join('\n'),
				isError: result.isError === true,
				name: request.name,
				serverName: server.serverName,
			}
		}

		return {
			content: `Tool "${request.name}" not found on any connected server`,
			isError: true,
			name: request.name,
		}
	}

	async disconnect(): Promise<void> {
		const promises = this.servers.map((s) => s.client.close().catch(() => {}))
		await Promise.all(promises)
		this.servers = []
	}
}

function estimateTokens(obj: unknown): number {
	// pure text would be more like 3.5, but braces are tokens
	return Math.ceil(JSON.stringify(obj).length / 2.25)
}

type Reducer = (def: OpenaiToolDef) => OpenaiToolDef

function truncateString(s: string, maxLen: number): string {
	if (s.length <= maxLen) return s
	return s.slice(0, maxLen) + '...'
}

function stripNestedDescriptions(schema: Record<string, unknown>): Record<string, unknown> {
	if (!schema || typeof schema !== 'object') return schema
	const result: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(schema)) {
		if (key === 'description') continue
		if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			result[key] = stripNestedDescriptions(value as Record<string, unknown>)
		} else {
			result[key] = value
		}
	}
	return result
}

const reductionPasses: Reducer[] = [
	// Pass 1: truncate long descriptions on the function itself
	(def) => ({
		...def,
		function: {
			...def.function,
			description: truncateString(def.function.description, 100),
		},
	}),
	// Pass 2: remove description fields from parameter schemas
	(def) => ({
		...def,
		function: {
			...def.function,
			parameters: stripNestedDescriptions(def.function.parameters),
		},
	}),
	// Pass 3: truncate function-level description further
	(def) => ({
		...def,
		function: {
			...def.function,
			description: truncateString(def.function.description, 30),
		},
	}),
	// Pass 4: remove function-level description entirely
	(def) => ({
		...def,
		function: {
			...def.function,
			description: '',
		},
	}),
]

function fitToolDefsToTokenBudget(defs: OpenaiToolDef[], maxTokens: number): OpenaiToolDef[] {
	let current = defs
	for (const reducer of reductionPasses) {
		if (estimateTokens(current) <= maxTokens) break
		console.log(`Reducing tool list size from ${estimateTokens(current)}`)
		current = current.map(reducer)
	}
	if (estimateTokens(current) > maxTokens) {
		console.log(
			`Tool definitions (${estimateTokens(current)} estimated tokens) exceed budget (${maxTokens}) ` +
				`even after all reductions. ${current.length} tools included.`,
		)
	}
	return current
}

export interface OpenaiToolDef {
	type: 'function'
	function: {
		name: string
		description: string
		parameters: Record<string, unknown>
	}
}
