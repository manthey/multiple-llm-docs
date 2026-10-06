import { Editor, MarkdownView, normalizePath, Notice, Plugin, TFile } from 'obsidian'

import { LlmDoc } from './llm-doc'
import { LlmConnectionSettings, defaultPluginSettings, DocOpenMethods, PluginSettings } from './settings'
import { llmDocsCodemirrorPlugin } from './editor-extension'
import { OpenaiBasicMessage } from './open-ai'
import {
	fileProcessingStarted,
	fileProcessingStopped,
	ILlmDocsPlugin,
	isFileBeingProcessed,
	setLlmDocsPlugin,
	setStopCallback,
} from './registry'
import { getLeaf } from './obsidian-utils'
import { ensureDefaultConnection, resolveConnectionForValue } from './connection-models'
import { SettingsTab } from './settings-tab'
import { ModelPickerModal } from './settings-tab/model-picker'
import { ToolPickerModal } from './settings-tab/tool-picker'

interface WakeLockSentinel {
	release(): Promise<void>
	addEventListener(type: 'release', listener: () => void): void
}

export default class LlmDocsPlugin extends Plugin implements ILlmDocsPlugin {
	private wakeLock: WakeLockSentinel | null = null
	declare settings: PluginSettings

	async onload() {
		await this.loadSettings()

		setLlmDocsPlugin(this)

		this.addRibbonIcon('bot', 'Create new LLM doc', () => {
			this.createNewDoc()
		})

		this.addCommand({
			id: 'create',
			name: 'Create new LLM document',
			icon: 'bot',
			callback: () => this.createNewDoc(),
		})

		this.addCommand({
			id: 'complete',
			name: 'Complete LLM document',
			editorCallback: async (editor, view) => {
				if (view.file) {
					await this.completeDoc(editor, view.file)
				}
			},
		})

		this.addCommand({
			id: 'chat_with_current_document',
			name: 'Chat with current document',
			editorCallback: async (editor, view) => {
				if (view.file) {
					await this.chatWithDoc(view.file)
				}
			},
		})

		this.addCommand({
			id: 'change_model',
			name: 'Change model used in current document',
			editorCallback: async (editor, view) => {
				if (!view.file) return

				let llmConnectionUrl: string | undefined
				await this.app.fileManager.processFrontMatter(view.file, (fm) => {
					if (typeof fm.llm_connection === 'string') {
						llmConnectionUrl = fm.llm_connection
					}
				})
				const customConns: LlmConnectionSettings[] = llmConnectionUrl
					? [resolveConnectionForValue(this.settings.connections, llmConnectionUrl)]
					: []
				const modelPickerModal = new ModelPickerModal(this.app, this, customConns[0])
				const model = await modelPickerModal.openAndGetResult()
				if (model) {
					await this.app.fileManager.processFrontMatter(view.file, (frontmatter) => {
						const existingModel = frontmatter.model
						if (model !== existingModel) {
							frontmatter.model = model
							new Notice('Changed to ' + model)
						}
					})
				}
			},
		})

		this.addCommand({
			id: 'append_model',
			name: 'Append another model used in current document',
			editorCallback: async (editor, view) => {
				if (!view.file) return

				let llmConnectionUrl: string | undefined
				await this.app.fileManager.processFrontMatter(view.file, (fm) => {
					if (typeof fm.llm_connection === 'string') {
						llmConnectionUrl = fm.llm_connection
					}
				})
				const customConns: LlmConnectionSettings[] = llmConnectionUrl
					? [resolveConnectionForValue(this.settings.connections, llmConnectionUrl)]
					: []

				const modelPickerModal = new ModelPickerModal(this.app, this, customConns[0])
				const model = await modelPickerModal.openAndGetResult()
				if (model) {
					await this.app.fileManager.processFrontMatter(view.file, (frontmatter) => {
						let modelList = frontmatter.model
						if (!Array.isArray(modelList)) {
							modelList = [modelList]
						}
						modelList.push(model)
						frontmatter.model = modelList
						new Notice('Changed to ' + modelList.join(', '))
					})
				}
			},
		})

		this.addCommand({
			id: 'select_tools',
			name: 'Select tools for current document',
			editorCallback: async (editor, view) => {
				if (!view.file) return
				const file = view.file
				const currentFilters: string[] | null = await new Promise((resolve) => {
					this.app.fileManager.processFrontMatter(file, (fm) => {
						resolve(Array.isArray(fm.llm_tools) ? fm.llm_tools : null)
					})
				})
				const result = await new ToolPickerModal(
					this.app,
					this.settings.toolServers,
					currentFilters,
				).openAndGetResult()
				if (result !== null) {
					await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
						frontmatter.llm_tools = result
					})
				}
			},
		})

		this.addSettingTab(new SettingsTab(this.app, this))

		this.registerEditorExtension(llmDocsCodemirrorPlugin)
	}

	async completeDoc(editor: Editor, file: TFile) {
		if (isFileBeingProcessed(file)) {
			return
		}
		fileProcessingStarted(file)

		let doc: LlmDoc
		await this.acquireWakeLock()

		const stopGeneration = () => {
			doc?.stop()
			new Notice('Cancelling...')
		}

		const onkeydown = (evt: KeyboardEvent) => {
			if (evt.key === 'Escape') {
				stopGeneration()
			}
		}

		try {
			const view = this.app.workspace
				.getLeavesOfType('markdown')
				.map((leaf) => {
					const view = leaf.view as MarkdownView
					return view.file === file ? view : undefined
				})
				.filter(Boolean)[0]
			if (view) {
				// make sure current editor changes are readable from disk so as not to lose them
				await view.save()
			}

			doc = await LlmDoc.fromFile(this.app, file, this.settings.defaults, this.settings.toolsDefaultToAll ?? true)
			setStopCallback(file, stopGeneration)
			document.addEventListener('keydown', onkeydown)
			await doc.complete(this.settings.connections, editor, this.settings.toolServers)
		} catch (error) {
			new Notice(String(error))
		} finally {
			document.removeEventListener('keydown', onkeydown)
		}

		fileProcessingStopped(file)
		await this.releaseWakeLock()
	}

	async createNewDoc(docOpenMethod?: DocOpenMethods, systemPrompt?: string) {
		// create directory if it doesn't exist
		const dir = normalizePath(this.settings.docsDir)
		if (!this.app.vault.getAbstractFileByPath(dir)) {
			await this.app.vault.createFolder(dir)
		}

		// find the next free path
		const dateString = new Date().toISOString().split('T')[0]
		let freePath: string | null = null
		for (let i = 1; i < 100; i++) {
			const formattedNumber = i.toString().padStart(2, '0')
			const checkPath = `${dir}/${dateString}_${formattedNumber}_LLM.md`
			if (!this.app.vault.getAbstractFileByPath(checkPath)) {
				freePath = checkPath
				break
			}
		}
		if (!freePath) {
			new Notice("Couldn't create - maximum of 100 files per day reached")
			return
		}

		const { defaults } = this.settings
		docOpenMethod = docOpenMethod ?? defaults.docOpenMethod
		systemPrompt = systemPrompt ?? defaults.systemPrompt
		// create the doc
		const doc = await LlmDoc.create(this.app, freePath, { model: defaults.model }, [
			...(systemPrompt.length ? [{ role: 'system', content: systemPrompt } as OpenaiBasicMessage] : []),
			{ role: 'user', content: '' },
		])

		// navigate to the doc
		const leaf = getLeaf(this.app.workspace, docOpenMethod)
		await leaf.openFile(doc.file)
		const active = this.app.workspace.activeEditor
		const editor = active?.editor
		if (editor) {
			editor.focus()
			editor.setCursor({ line: editor.lastLine(), ch: 0 })

			// enter insert mode (applicable if VIM mode enabled)
			const codemirror = (editor as any).cm as { contentDOM: HTMLElement }
			const event = new KeyboardEvent('keydown', { key: 'i' })
			codemirror.contentDOM.dispatchEvent(event)
		}
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, defaultPluginSettings, await this.loadData())
		// there must always be a default connection when any are configured
		if (ensureDefaultConnection(this.settings.connections)) {
			await this.saveSettings()
		}
		// todo: delete all keys (recursively) that are not in defaultPluginSettings
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}

	private async chatWithDoc(file: TFile) {
		const newDocDir = normalizePath(this.settings.docsDir)
		const linkText = this.app.metadataCache.fileToLinktext(file, newDocDir)
		await this.createNewDoc(
			DocOpenMethods.splitVertical,
			`The user is referencing a document named "${file.name}" with the following content: [[${linkText}]]`,
		)
	}

	private async acquireWakeLock() {
		const nav = navigator as any
		if (!nav.wakeLock || !this.settings.stayAwake) return
		try {
			const sentinel: WakeLockSentinel = await nav.wakeLock.request('screen')
			sentinel.addEventListener('release', () => {
				this.wakeLock = null
			})
			this.wakeLock = sentinel
		} catch {
			this.wakeLock = null
		}
	}

	private async releaseWakeLock() {
		if (!this.wakeLock) return
		try {
			await this.wakeLock.release()
		} catch {}
		this.wakeLock = null
	}
}
