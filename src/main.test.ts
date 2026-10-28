import { expect, it, describe, beforeEach, jest } from '@jest/globals'
import LlmDocsPlugin from './main'
import { LlmDoc } from './llm-doc'
import { DocOpenMethods } from './settings'
import { isFileBeingProcessed, fileProcessingStarted, fileProcessingStopped } from './registry'
import { TFile } from 'obsidian'
import { resetCaptured, notices } from './settings-tab/test-utils'

jest.mock('./llm-doc', () => ({
	LlmDoc: {
		fromFile: jest.fn(),
		create: jest.fn(),
	},
}))

jest.mock('./editor-extension', () => ({
	llmDocsCodemirrorPlugin: {},
}))

jest.mock('./settings-tab', () => ({
	SettingsTab: jest.fn().mockImplementation(() => ({})),
}))

jest.mock('./settings-tab/model-picker', () => ({
	ModelPickerModal: jest.fn(),
}))

jest.mock('./settings-tab/tool-picker', () => ({
	ToolPickerModal: jest.fn(),
}))

const { LlmDoc }: any = jest.requireMock('./llm-doc')

function makePlugin() {
	const sentinel = {
		release: jest.fn(async () => {}),
		addEventListener: jest.fn(),
	}
	const app: any = {
		vault: {
			getAbstractFileByPath: jest.fn(() => null),
			createFolder: jest.fn(async () => {}),
		},
		fileManager: {
			processFrontMatter: jest.fn(async (file: any, fn: any) => fn(file.fm ?? (file.fm = {}))),
		},
		metadataCache: {
			fileToLinktext: jest.fn(() => 'notes/ref'),
			getFirstLinkpathDest: () => null,
		},
		workspace: {
			getLeavesOfType: jest.fn(() => []),
			getLeaf: jest.fn(() => ({ openFile: jest.fn(async () => {}) })),
			activeEditor: null,
		},
	}
	const plugin = new LlmDocsPlugin(app, { id: 'test' } as any)
	return { plugin, app, sentinel }
}

function fakeFile(path = 'LLM/doc.md'): TFile {
	return { path, name: path.split('/').pop() } as unknown as TFile
}

function fakeEditor() {
	return {
		focus: jest.fn(),
		setCursor: jest.fn(),
		lastLine: () => 3,
		cm: { contentDOM: document.createElement('div') },
	} as any
}

describe('LlmDocsPlugin', () => {
	beforeEach(() => {
		resetCaptured()
		jest.clearAllMocks()
		;(globalThis as any).navigator.wakeLock = undefined
		fileProcessingStopped(fakeFile())
	})

	it('onload registers commands, ribbon icon, and the settings tab', async () => {
		const { plugin } = makePlugin()
		const addCommand = jest.spyOn(plugin, 'addCommand')
		const addRibbonIcon = jest.spyOn(plugin, 'addRibbonIcon')
		const addSettingTab = jest.spyOn(plugin, 'addSettingTab')

		await plugin.onload()

		expect(addCommand).toHaveBeenCalledTimes(6)
		expect(addRibbonIcon).toHaveBeenCalledWith('bot', 'Create new LLM doc', expect.any(Function))
		expect(addSettingTab).toHaveBeenCalledTimes(1)
	})

	it('loadSettings applies defaults and marks the first connection default', async () => {
		const { plugin } = makePlugin()
		;(plugin as any)._data = {
			connections: [{ type: 'OpenAI', baseUrl: 'https://x', apiKey: '' }],
		}

		await plugin.loadSettings()

		expect(plugin.settings.docsDir).toBe('LLM')
		expect(plugin.settings.defaults.model).toBe('gpt-4o')
		expect(plugin.settings.connections[0].isDefault).toBe(true)
		// the corrected settings were persisted
		await expect(plugin.saveData).toBeDefined()
		expect((plugin as any)._data.connections[0].isDefault).toBe(true)
	})

	it('completeDoc runs a completion and clears the processing state', async () => {
		const { plugin, app } = makePlugin()
		await plugin.onload()
		const file = fakeFile()
		const complete = jest.fn(async () => {})
		LlmDoc.fromFile.mockResolvedValue({ complete, stop: jest.fn() })
		app.workspace.getLeavesOfType.mockReturnValue([
			{ view: { file, save: jest.fn(async () => {}) } },
		])

		const editor = fakeEditor()
		await plugin.completeDoc(editor, file)

		expect(LlmDoc.fromFile).toHaveBeenCalledWith(plugin.app, file, plugin.settings.defaults, true)
		expect(complete).toHaveBeenCalledWith(plugin.settings.connections, editor, plugin.settings.toolServers)
		expect(isFileBeingProcessed(file)).toBe(false)
	})

	it('completeDoc saves the active view before completing', async () => {
		const { plugin, app } = makePlugin()
		await plugin.onload()
		const file = fakeFile()
		const save = jest.fn(async () => {})
		app.workspace.getLeavesOfType.mockReturnValue([{ view: { file, save } }])
		LlmDoc.fromFile.mockResolvedValue({ complete: jest.fn(async () => {}), stop: jest.fn() })

		await plugin.completeDoc(fakeEditor(), file)

		expect(save).toHaveBeenCalled()
	})

	it('completeDoc ignores a file that is already being processed', async () => {
		const { plugin } = makePlugin()
		await plugin.onload()
		const file = fakeFile()
		fileProcessingStarted(file)

		await plugin.completeDoc(fakeEditor(), file)

		expect(LlmDoc.fromFile).not.toHaveBeenCalled()
		expect(isFileBeingProcessed(file)).toBe(true)
		fileProcessingStopped(file)
	})

	it('completeDoc shows an error notice when completion fails', async () => {
		const { plugin } = makePlugin()
		await plugin.onload()
		const file = fakeFile()
		LlmDoc.fromFile.mockRejectedValue(new Error('boom'))

		await plugin.completeDoc(fakeEditor(), file)

		expect(notices().some((notice) => notice.includes('boom'))).toBe(true)
		expect(isFileBeingProcessed(file)).toBe(false)
	})

	it('the Escape key cancels the running completion', async () => {
		const { plugin, app } = makePlugin()
		await plugin.onload()
		const file = fakeFile()
		const stop = jest.fn()
		LlmDoc.fromFile.mockResolvedValue({ complete: jest.fn(async () => {}), stop })
		app.workspace.getLeavesOfType.mockReturnValue([])

		const listeners: Record<string, (event: any) => void> = {}
		jest.spyOn(document, 'addEventListener').mockImplementation((type: any, handler: any) => {
			listeners[type] = handler
			return {} as any
		})
		jest.spyOn(document, 'removeEventListener').mockImplementation(() => {})

		const completion = plugin.completeDoc(fakeEditor(), file)
		// let the completion reach the point where it registers the listener
		await new Promise((resolve) => setTimeout(resolve, 0))
		listeners['keydown']({ key: 'Escape' })

		await completion
		expect(stop).toHaveBeenCalled()
		expect(notices()).toContain('Cancelling...')
		jest.restoreAllMocks()
	})

	it('createNewDoc creates the docs folder and a new document, then opens it', async () => {
		const { plugin, app } = makePlugin()
		await plugin.loadSettings()
		const docFile = fakeFile('LLM/2026-10-28_01_LLM.md')
		LlmDoc.create.mockResolvedValue({ file: docFile })

		const editor = fakeEditor()
		app.workspace.activeEditor = { editor }

		await plugin.createNewDoc()

		expect(app.vault.createFolder).toHaveBeenCalledWith('LLM')
		const [, path, properties, messages] = LlmDoc.create.mock.calls[0]
		expect(path).toBe('LLM/2026-10-28_01_LLM.md')
		expect(properties).toEqual({ model: 'gpt-4o' })
		expect(messages).toEqual([{ role: 'user', content: '' }])

		const leaf = app.workspace.getLeaf.mock.results[0].value
		expect(leaf.openFile).toHaveBeenCalledWith(docFile)
		expect(editor.focus).toHaveBeenCalled()
		expect(editor.setCursor).toHaveBeenCalledWith({ line: 3, ch: 0 })
		// the vim insert-mode keystroke was dispatched to codemirror
		const keys: string[] = []
		editor.cm.contentDOM.addEventListener('keydown', (event: any) => keys.push(event.key))
		// re-run createNewDoc with the listener already attached
		await plugin.createNewDoc()
		expect(keys).toEqual(['i'])
	})

	it('createNewDoc uses the configured open method and system prompt by default', async () => {
		const { plugin, app } = makePlugin()
		await plugin.loadSettings()
		plugin.settings.defaults.docOpenMethod = DocOpenMethods.window
		plugin.settings.defaults.systemPrompt = 'be brief'
		LlmDoc.create.mockResolvedValue({ file: fakeFile() })

		await plugin.createNewDoc()

		expect(app.workspace.getLeaf).toHaveBeenCalledWith('window')
		expect(LlmDoc.create.mock.calls[0][3]).toEqual([
			{ role: 'system', content: 'be brief' },
			{ role: 'user', content: '' },
		])
	})

	it('createNewDoc gives up after 100 documents exist for the day', async () => {
		const { plugin, app } = makePlugin()
		await plugin.loadSettings()
		app.vault.getAbstractFileByPath.mockReturnValue({})

		await plugin.createNewDoc()

		expect(LlmDoc.create).not.toHaveBeenCalled()
		expect(notices().some((notice) => notice.includes('maximum of 100 files per day'))).toBe(true)
	})

	it('chatWithDoc creates a document referencing the source file', async () => {
		const { plugin, app } = makePlugin()
		await plugin.loadSettings()
		LlmDoc.create.mockResolvedValue({ file: fakeFile() })

		await (plugin as any).chatWithDoc(fakeFile('notes/ref.md'))

		expect(app.metadataCache.fileToLinktext).toHaveBeenCalled()
		const [, , , messages] = LlmDoc.create.mock.calls[0]
		expect(messages[0].role).toBe('system')
		expect(messages[0].content).toContain('ref.md')
		expect(messages[0].content).toContain('[[notes/ref]]')
	})

	it('acquires and releases the wake lock when staying awake', async () => {
		const { plugin, app, sentinel } = makePlugin()
		await plugin.loadSettings()
		plugin.settings.stayAwake = true
		;(globalThis as any).navigator.wakeLock = { request: jest.fn(async () => sentinel) }
		const file = fakeFile()
		LlmDoc.fromFile.mockResolvedValue({ complete: jest.fn(async () => {}), stop: jest.fn() })
		app.workspace.getLeavesOfType.mockReturnValue([])

		await plugin.completeDoc(fakeEditor(), file)

		expect((globalThis as any).navigator.wakeLock.request).toHaveBeenCalledWith('screen')
		expect(sentinel.release).toHaveBeenCalled()
	})

	it('does not request a wake lock when stay awake is disabled', async () => {
		const { plugin, app } = makePlugin()
		await plugin.loadSettings()
		const request = jest.fn()
		;(globalThis as any).navigator.wakeLock = { request }
		const file = fakeFile()
		LlmDoc.fromFile.mockResolvedValue({ complete: jest.fn(async () => {}), stop: jest.fn() })
		app.workspace.getLeavesOfType.mockReturnValue([])

		await plugin.completeDoc(fakeEditor(), file)

		expect(request).not.toHaveBeenCalled()
	})
})
