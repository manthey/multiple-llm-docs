export interface PluginSettings {
	docsDir: string
	connections: LlmConnectionSettings[]
	defaults: DefaultsSettings
	pinnedModels: Record<string, boolean>
	toolServers: McpToolServerSettings[]
	stayAwake: boolean
	toolsDefaultToAll?: boolean
}

export enum DocOpenMethods {
	replace = 'replace',
	tab = 'tab',
	splitVertical = 'splitVertical',
	splitHorizontal = 'splitHorizontal',
	window = 'window',
}

export interface DefaultsSettings {
	model: string
	systemPrompt: string
	docOpenMethod: DocOpenMethods
}

export interface LlmConnectionSettings {
	type: 'OpenAI' // 'Anthropic' and other types in future
	baseUrl: string
	apiKey: string
	/** Short name usable in the `llm_connection` frontmatter key. Must not contain a colon. */
	name?: string
	/** Whether this connection is the default, used for impromptu connection URLs not in the settings. */
	isDefault?: boolean
}

export interface McpToolServerSettings {
	name: string
	type: 'http' | 'stdio'
	url?: string
	headers?: Record<string, string>
	command?: string
	args?: string[]
	env?: Record<string, string>
}
export const defaultPluginSettings: PluginSettings = {
	docsDir: 'LLM',
	connections: [],
	pinnedModels: {},
	toolServers: [],
	stayAwake: false,
	toolsDefaultToAll: true,
	defaults: {
		model: 'gpt-4o',
		systemPrompt: '',
		docOpenMethod: DocOpenMethods.tab,
	},
}
