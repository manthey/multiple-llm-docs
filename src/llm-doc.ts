import { App, Editor, getFrontMatterInfo, parseYaml, TFile } from 'obsidian'
import { OpenaiChatCompletionStream, OpenaiBasicMessage, OpenaiMessage } from './open-ai'
import {
	filterMessagesForModel,
	messagesToText,
	ParsedMessage,
	preprocessMessages,
	textToMessages,
} from './llm-doc-util'
import { DefaultsSettings, LlmConnectionSettings, McpToolServerSettings } from './settings'
import { getImageLinkResolver, getDocLinkResolver } from './obsidian-utils'
import { resolveConnectionForModel, resolveConnectionForValue } from './connection-models'
import { McpManager } from './mcp'

export interface LlmDocProperties {
	model: string | string[]
	connection?: string
	/* Additional API parameters extracted from frontmatter keys prefixed with
	 * `llm_`. e.g. llm_temperature, llm_top_p, llm_max_tokens, llm_num_ctx
	 * (Ollama).
	 */
	llmParams?: Record<string, unknown>
	maxImageSize?: number
	toolFilters?: string[]
	toolServerOverrides?: McpToolServerSettings[]
}

type CompletionStream = OpenaiChatCompletionStream
const completionStream = OpenaiChatCompletionStream

export class LlmDoc {
	private currentStream: CompletionStream | null = null
	private stopped = false

	private constructor(
		private app: App,
		public file: TFile,
		private messages: ParsedMessage[],
		private properties: LlmDocProperties,
		private modelExistsInFrontmatter: boolean = true,
	) {}

	static async fromFile(
		app: App,
		file: TFile,
		defaults: DefaultsSettings,
		useAllToolsByDefault: boolean = true,
	): Promise<LlmDoc> {
		const text = await app.vault.read(file)
		const fmInfo = getFrontMatterInfo(text)
		const frontmatter = fmInfo.exists ? parseYaml(fmInfo.frontmatter) : {}
		const llmParams: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(frontmatter ?? {})) {
			if (
				key.startsWith('llm_') &&
				!['llm_max_image_size', 'llm_connection', 'llm_tools', 'llm_tool_servers'].includes(key)
			) {
				llmParams[key.slice(4)] = value
			}
		}
		// Handle explicit tool selection from frontmatter, or default based on plugin setting
		let explicitToolFilters: string[] | null
		const yamlTools = frontmatter?.llm_tools
		if (Array.isArray(yamlTools)) {
			explicitToolFilters = yamlTools as string[]
		} else if (typeof yamlTools === 'string') {
			explicitToolFilters = [yamlTools]
		} else {
			explicitToolFilters = null
		}
		let toolFilters: string[] | undefined
		if (explicitToolFilters !== null) {
			toolFilters = explicitToolFilters
		} else if (useAllToolsByDefault) {
			toolFilters = undefined
		} else {
			toolFilters = []
		}

		const properties: LlmDocProperties = {
			model: defaults.model,
			...(frontmatter?.model ? { model: frontmatter.model } : {}),
			...(frontmatter?.llm_connection ? { connection: frontmatter.llm_connection } : {}),
			llmParams,
			...(frontmatter?.llm_max_image_size ? { maxImageSize: frontmatter.llm_max_image_size } : {}),
			...(toolFilters !== undefined ? { toolFilters } : {}),
			...(frontmatter?.llm_tool_servers ? { toolServerOverrides: frontmatter.llm_tool_servers } : {}),
		}
		const withoutFrontmatter = text.slice(fmInfo.contentStart)
		const messages = textToMessages(withoutFrontmatter)
		return new LlmDoc(app, file, messages, properties, !!frontmatter?.model)
	}

	static async create(
		app: App,
		path: string,
		properties: LlmDocProperties,
		messages: OpenaiBasicMessage[],
	): Promise<LlmDoc> {
		const text = messagesToText(messages)
		const file = await app.vault.create(path, text)
		await app.fileManager.processFrontMatter(file, (frontmatter) => {
			if (!frontmatter.model) {
				frontmatter.model = properties.model
			}
		})
		return new LlmDoc(app, file, messages, properties)
	}

	async stop() {
		this.stopped = true
		this.currentStream?.stop()
	}

	async complete(connections: LlmConnectionSettings[], editor: Editor, toolServers: McpToolServerSettings[]) {
		let modelProp = this.properties.model
		if (Array.isArray(modelProp) && modelProp.length === 1) {
			modelProp = modelProp[0]
		}
		const models = Array.isArray(modelProp) ? modelProp : [modelProp]
		// update model in frontmatter if not set and default was used
		if (!this.modelExistsInFrontmatter) {
			await this.app.fileManager.processFrontMatter(this.file, (frontmatter) => {
				frontmatter.model = modelProp
			})
		}
		let mcpManager: McpManager | null = null
		if (this.properties.toolFilters === undefined || this.properties.toolFilters?.length > 0) {
			const effectiveToolServers = this.properties.toolServerOverrides ?? toolServers
			if (effectiveToolServers.length > 0) {
				mcpManager = new McpManager()
				try {
					await mcpManager.connect(effectiveToolServers)
				} catch (error) {
					console.error('Failed to connect to MCP servers:', error)
				}
			}
		}
		for (let i = 0; i < models.length; i++) {
			if (this.stopped) break

			const model = models[i]
			let connectionSettings: LlmConnectionSettings | null
			if (this.properties.connection) {
				connectionSettings = resolveConnectionForValue(connections, this.properties.connection)
			} else {
				connectionSettings = await resolveConnectionForModel(connections, model)
			}
			if (!connectionSettings) {
				throw new Error(`No connection found for model "${model}"`)
			}

			const heading = models.length > 1 ? `assistant${i + 1} (${model})` : 'assistant'
			const filtered = filterMessagesForModel(this.messages, i, models.length)

			const preprocessed = await preprocessMessages(
				filtered,
				getDocLinkResolver(this.app, this.file.path),
				getImageLinkResolver(this.app, this.file.path, this.properties.maxImageSize),
			)

			const openaiTools = mcpManager?.getOpenaiTools(this.properties.toolFilters)
			console.log('Filtered tools', openaiTools)
			const conversationMessages: OpenaiMessage[] = [...preprocessed]

			try {
				let headingAdded = false
				let continueLoop = true

				while (continueLoop && !this.stopped) {
					const stream = new completionStream(
						connectionSettings,
						model,
						conversationMessages,
						this.properties.llmParams,
						openaiTools,
					)
					this.currentStream = stream

					stream.on('data', (data: string) => {
						if (!headingAdded) {
							this.app.vault.append(this.file, `\n# ${heading}\n`)
							headingAdded = true
						}
						this.app.vault.append(this.file, data)
					})

					await stream.result()

					if (stream.toolCalls.length > 0 && mcpManager) {
						conversationMessages.push({
							role: 'assistant',
							content: stream.entireContent || '',
							tool_calls: stream.toolCalls,
						} as any)

						for (const tc of stream.toolCalls) {
							let args: Record<string, unknown> = {}
							try {
								args = JSON.parse(tc.function.arguments)
							} catch {}

							const result = await mcpManager.callTool({
								name: tc.function.name,
								arguments: args,
							})

							conversationMessages.push({
								role: 'tool',
								tool_call_id: tc.id,
								content: result.content,
							} as any)

							if (!headingAdded) {
								this.app.vault.append(this.file, `\n# ${heading}\n`)
								headingAdded = true
							}
							console.log('tool call and result', tc, result)
							this.app.vault.append(
								this.file,
								' `' +
									`tool: ${result.name}` +
									(result.serverName ? `, server: ${result.serverName}` : '') +
									(result.isError ? ', failed' : `, result: ${result.content.length} characters`) +
									'`\n',
							)
						}
					} else {
						continueLoop = false
					}
				}
			} catch (error) {
				if (models.length > 1) {
					continue
				}
				throw error
			}
		}
		if (mcpManager) {
			await mcpManager.disconnect()
		}

		await this.app.vault.append(this.file, '\n# user\n')

		// hack to ensure editor has the latest file changes before setting cursor position
		await sleep(10)

		editor.setCursor({ line: editor.lastLine(), ch: 0 })
	}
}
