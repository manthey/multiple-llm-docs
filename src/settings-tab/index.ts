import { App, PluginSettingTab, Setting } from 'obsidian'
import { DocOpenMethods } from '../settings'
import LlmDocsPlugin from '../main'
import { addConnectionsSettings } from './connections'
import { modelCacheUpdated } from '../registry'
import { ModelPickerModal } from './model-picker'
import { addToolServersSettings } from './tool-servers'
import { FolderSuggest } from './folder-suggest'

export class SettingsTab extends PluginSettingTab {
	unsubscribe = modelCacheUpdated.on(() => this.display())

	constructor(
		app: App,
		private plugin: LlmDocsPlugin,
	) {
		super(app, plugin)
	}

	hide() {
		super.hide()

		this.unsubscribe()
	}

	display(): void {
		const { containerEl } = this

		containerEl.empty()

		new Setting(containerEl)
			.setName('LLM docs directory')
			.setDesc('The directory where new LLM documents will be created')
			.addText((text) => {
				text.setPlaceholder('path/to/directory')
					.setValue(this.plugin.settings.docsDir)
					.onChange(async (value) => {
						this.plugin.settings.docsDir = value
						await this.plugin.saveSettings()
					})

				new FolderSuggest(this.app, text.inputEl)
			})

		const documentOpenMethods: Record<DocOpenMethods, string> = {
			tab: 'a new tab',
			splitVertical: 'a new split (vertical)',
			splitHorizontal: 'a new split (horizontal)',
			window: 'a new window',
			replace: 'an existing tab',
		}
		new Setting(containerEl).setName('Create new documents in...').addDropdown((dropdown) =>
			dropdown
				.addOptions(documentOpenMethods)
				.setValue(this.plugin.settings.defaults.docOpenMethod)
				.onChange(async (value) => {
					this.plugin.settings.defaults.docOpenMethod = value as DocOpenMethods
					await this.plugin.saveSettings()
				}),
		)

		new Setting(containerEl)
			.setName('Stay awake while completing')
			.setDesc('Prevent the device from sleeping during LLM completions')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.stayAwake).onChange(async (value) => {
					this.plugin.settings.stayAwake = value
					await this.plugin.saveSettings()
				}),
			)

		new Setting(containerEl)
			.setName('All tools available by default')
			.setDesc(
				createFragment((e) => {
					e.createSpan({
						text: 'If disabled, notes without an explicit llm_tools setting will have no MCP tools enabled.',
					})
				}),
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.toolsDefaultToAll ?? true).onChange(async (value) => {
					this.plugin.settings.toolsDefaultToAll = value
					await this.plugin.saveSettings()
				}),
			)

		addToolServersSettings(containerEl, this.plugin, () => this.display())

		addConnectionsSettings(containerEl, this.plugin, () => this.display())

		new Setting(containerEl).setName('Defaults').setHeading()

		this.addDefaultModelSetting(containerEl)

		new Setting(containerEl)
			.setName('Default system prompt')
			.setDesc('The default system prompt for new LLM documents')
			.addText((text) =>
				text
					.setPlaceholder('System prompt')
					.setValue(this.plugin.settings.defaults.systemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.defaults.systemPrompt = value
						await this.plugin.saveSettings()
					}),
			)
		new Setting(containerEl).setName('Frontmatter parameters (llm_*)').setDesc(
			createFragment((e) => {
				const baseParams: [string, string][] = [
					['model', 'a single model name or a list of models to use for chat'],
					['llm_connection', 'a connection short name, or a connection endpoint URL. URLs not in the settings use the default connection\'s API key'],
					[
						'llm_tools',
						'Use the plugin setting to determine default selection (all or none). Explicitly set to array to override.',
					],
					[
						'llm_tool_servers',
						'if specified, ignore the configured tool servers and use those specified.  This is a list where all tools have keys of name and type (either "stdio" or "http"); stdio tools have additional keys of command, args (a list), and env (a dictionary); and http tools have keys of url and headers (a dictionary of header name to value)',
					],
					['llm_max_image_size', 'scale images sent to vision models'],
				]
				const params: [string, string][] = [
					['llm_temperature', 'randomness, 0-2'],
					['llm_top_p', 'sampling threshold, 0.05-1'],
					['llm_max_tokens', 'response size'],
					['llm_stop', 'stop string(s)'],
					['llm_seed', 'random seed'],
					['llm_response_format', '{"type":"json_object"} might work'],
					['llm_presence_penalty', '-2-2, not ollama'],
					['llm_frequency_penalty', '-2-2, not ollama'],
					['llm_num_ctx', 'context size, ollama'],
					['llm_num_predict', 'response size, ollama'],
					['llm_repeat_penalty', '1-2, ollama'],
					['llm_repeat_last_n', 'recent lookback, 64-512, ollama'],
					['llm_top_k', 'tokens considered, 5-100, ollama'],
					['llm_min_p', 'sampling discard, 0.01-0.2'],
				]
				e.createSpan({ text: 'These frontmatter keys control the process:' })
				const list1 = e.createEl('ul')
				baseParams.forEach(([key, desc]) => {
					const li = list1.createEl('li')
					li.createEl('code', { text: key })
					li.createSpan({ text: `: ${desc}` })
				})
				e.createSpan({ text: 'Any other frontmatter keys starting with ' })
				e.createEl('code', { text: 'llm_' })
				e.createSpan({ text: ' are sent directly to the API. Examples:' })
				const list2 = e.createEl('ul')
				params.forEach(([key, desc]) => {
					const li = list2.createEl('li')
					li.createEl('code', { text: key })
					li.createSpan({ text: `: ${desc}` })
				})
			}),
		)
	}

	addDefaultModelSetting(containerEl: HTMLElement) {
		const save = async (value: string) => {
			this.plugin.settings.defaults.model = value
			await this.plugin.saveSettings()
		}

		new Setting(containerEl)
			.setName('Default model')
			.setDesc('The default LLM model variant to use for new LLM documents')
			.addButton((button) => {
				button.setButtonText('Select').onClick(async () => {
					const model = await new ModelPickerModal(this.app, this.plugin).openAndGetResult()
					if (model) {
						await save(model)
						// force refresh of textbox in a way that is resilient to
						// the page being refreshed while the modal is still open
						// (can happen due to the subscription to "modelCacheUpdated")
						this.display()
					}
				})
			})
			.addText((text) => {
				text.setValue(this.plugin.settings.defaults.model).onChange(async (value) => save(value))
			})
	}
}
