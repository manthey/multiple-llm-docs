import { expect, it, describe, beforeEach, jest } from '@jest/globals'
import { FooterWidget } from './editor-extension'
import { fileEvents, fileProcessingStarted, fileProcessingStopped, setLlmDocsPlugin, setStopCallback } from './registry'
import { editorInfoField, TFile } from 'obsidian'
import { resetCaptured } from './settings-tab/test-utils'

// Minimal stand-ins for the codemirror packages; they only need the surface
// used by editor-extension.ts.
jest.mock('@codemirror/view', () => {
	class Decoration {
		static none = { none: true }
		static mark(spec: any) {
			return { mark: spec }
		}
		static widget(spec: any) {
			return { widget: spec.widget, side: spec.side }
		}
	}
	class WidgetType {
		destroy() {}
	}
	const ViewPlugin = {
		fromClass: jest.fn((cls: any, spec: any) => ({ cls, spec })),
	}
	return { Decoration, WidgetType, ViewPlugin }
})

jest.mock('@codemirror/state', () => ({
	RangeSetBuilder: jest.fn().mockImplementation(function (this: any) {
		this.points = [] as any[]
		this.add = (from: number, to: number, decoration: any) => {
			this.points.push({ from, to, decoration })
		}
		this.finish = () => this.points
	}),
}))

const { ViewPlugin }: any = jest.requireMock('@codemirror/view')

// The plugin class is not exported directly; retrieve it from the captured
// ViewPlugin.fromClass call.
const PluginClass: any = (ViewPlugin.fromClass as jest.Mock).mock.calls[0][0]

function makeDoc(lines: string[]) {
	const infos: any[] = []
	let pos = 0
	lines.forEach((text, index) => {
		infos.push({ text, from: pos, to: pos + text.length, number: index + 1 })
		pos += text.length + 1
	})
	return {
		lines: lines.length,
		length: pos - 1,
		lineAt(position: number) {
			return infos.find((info) => position >= info.from && position <= info.to + 1) ?? infos[infos.length - 1]
		},
		line(n: number) {
			return infos[n - 1]
		},
		// codemirror signature: iterLines(fromLineNumber?, toLineNumber?)
		*iterLines(from?: number, to?: number) {
			const start = from ?? 1
			const end = to ?? lines.length + 1
			for (let n = start; n < end && n <= lines.length; n++) {
				yield lines[n - 1]
			}
		},
	}
}

function makeView(lines: string[], viewport?: { from: number; to: number }) {
	const doc = makeDoc(lines)
	const info = { file: { path: 'doc.md' } as unknown as TFile, editor: { id: 'editor', focus: jest.fn() } }
	const state: any = {
		doc,
		field: jest.fn(() => info),
	}
	const view: any = {
		state,
		viewport: viewport ?? { from: 0, to: doc.length },
	}
	return { view, state, doc, info }
}

function markClasses(decorations: any[]): string[] {
	return decorations
		.filter((point) => point.decoration.mark)
		.map((point) => point.decoration.mark.class)
}

function footerWidget(decorations: any[]): any {
	const point = decorations.find((p) => p.decoration.widget)
	return point?.decoration.widget
}

describe('LlmDocsCodemirrorPlugin.buildDecorations', () => {
	beforeEach(() => {
		resetCaptured()
		fileProcessingStopped({ path: 'doc.md' } as unknown as TFile)
	})

	it('produces no decorations without frontmatter', () => {
		const { view } = makeView(['plain', 'text'])
		const plugin = new PluginClass(view)
		expect((plugin.decorations as any).none).toBe(true)
	})

	it('produces no decorations when the frontmatter has no model key', () => {
		const { view } = makeView(['---', 'temperature: 1', '---', 'text'])
		const plugin = new PluginClass(view)
		expect((plugin.decorations as any).none).toBe(true)
	})

	it('decorates user and assistant headings', () => {
		const { view } = makeView(['---', 'model: gpt-4o', '---', '# user', 'do the thing', '# assistant', 'answer'])
		const plugin = new PluginClass(view)

		expect(markClasses(plugin.decorations)).toEqual(['llmdocs-heading-user', 'llmdocs-heading-assistant'])
	})

	it('decorates assistant headings with a model annotation as two marks', () => {
		const { view } = makeView(['---', 'model: m', '---', '# user', 'x', '# assistant1 (gpt-4o)'])
		const plugin = new PluginClass(view)

		expect(markClasses(plugin.decorations)).toEqual([
			'llmdocs-heading-user',
			'llmdocs-heading-assistant',
			'llmdocs-heading-assistant-model',
		])
	})

	it('decorates system headings, notes, and dividers', () => {
		const { view } = makeView([
			'---',
			'model: m',
			'---',
			'# system',
			'be nice',
			'# note',
			'skip this',
			'# new',
			'# user',
			'x',
		])
		const plugin = new PluginClass(view)

		expect(markClasses(plugin.decorations)).toEqual([
			'llmdocs-heading-system',
			'llmdocs-heading-notes',
			'llmdocs-heading-divider',
			'llmdocs-heading-user',
		])
	})

	it('does not decorate unknown headings', () => {
		const { view } = makeView(['---', 'model: m', '---', '# unknown-heading', 'text'])
		const plugin = new PluginClass(view)
		expect(markClasses(plugin.decorations).length).toBe(0)
	})

	it('only decorates the visible viewport', () => {
		const lines = ['---', 'model: m', '---', '# user', 'a', '# assistant', 'b']
		const doc = makeDoc(lines)
		const { view } = makeView(lines, { from: 0, to: doc.line(4).to })
		const plugin = new PluginClass(view)

		// only the '# user' heading (line 4) is in view
		expect(markClasses(plugin.decorations)).toEqual(['llmdocs-heading-user'])
	})

	it('degrades to no decorations when building fails', () => {
		const { view, state } = makeView(['---', 'model: m', '---'])
		state.field = () => {
			throw new Error('broken state')
		}
		const plugin = new PluginClass(view)
		expect((plugin.decorations as any).none).toBe(true)
	})
})

describe('footer widget placement', () => {
	beforeEach(() => {
		resetCaptured()
		fileProcessingStopped({ path: 'doc.md' } as unknown as TFile)
	})

	it('adds a footer while the file is being processed', () => {
		const { view, info } = makeView(['---', 'model: m', '---', '# user', 'hello'])
		fileProcessingStarted(info.file)
		const plugin = new PluginClass(view)

		const widget = footerWidget(plugin.decorations)
		expect(widget).toBeInstanceOf(FooterWidget)
	})

	it('adds a footer when a prompt precedes non-empty content', () => {
		const { view } = makeView(['---', 'model: m', '---', '# user', 'hello'])
		const plugin = new PluginClass(view)
		expect(footerWidget(plugin.decorations)).toBeInstanceOf(FooterWidget)
	})

	it('omits the footer when the document bottom is out of view', () => {
		const { doc, view } = makeView(['---', 'model: m', '---', '# user', 'hello'])
		view.viewport = { from: 0, to: doc.length - 3 }
		const plugin = new PluginClass(view)
		expect(footerWidget(plugin.decorations)).toBeUndefined()
	})

	it('omits the footer when the heading is the last line', () => {
		const { view } = makeView(['---', 'model: m', '---', '# user'])
		const plugin = new PluginClass(view)
		expect(footerWidget(plugin.decorations)).toBeUndefined()
	})

	it('omits the footer when nothing but whitespace follows the prompt', () => {
		const { view } = makeView(['---', 'model: m', '---', '# user', '   '])
		const plugin = new PluginClass(view)
		expect(footerWidget(plugin.decorations)).toBeUndefined()
	})

	it('omits the footer when it would obscure the cursor, and restores it after', () => {
		const { view } = makeView(['---', 'model: m', '---', '# user', 'hello'])
		view.cm = { state: { vim: { insertMode: false } } }
		const plugin = new PluginClass(view)
		// start with the footer visible
		expect(footerWidget(plugin.decorations)).toBeInstanceOf(FooterWidget)

		// cursor moves to the very end while out of insert mode: obscured
		view.state.selection = { main: { to: view.state.doc.length } }
		plugin.update({ selectionSet: true, docChanged: false, viewportChanged: false })
		expect(plugin.cursorCanBeObscured).toBe(true)
		expect(footerWidget(plugin.decorations)).toBeUndefined()

		// entering insert mode again restores the footer
		view.cm.state.vim.insertMode = true
		plugin.update({ selectionSet: true, docChanged: false, viewportChanged: false })
		expect(footerWidget(plugin.decorations)).toBeInstanceOf(FooterWidget)
	})

	it('rebuilds when the viewport changes', () => {
		const { view } = makeView(['---', 'model: m', '---', '# user', 'hello'])
		const plugin = new PluginClass(view)
		const rebuild = jest.spyOn(plugin, 'rebuild')

		plugin.update({ docChanged: false, viewportChanged: true, selectionSet: false })
		expect(rebuild).toHaveBeenCalled()
	})
})

describe('FooterWidget', () => {
	const lines = ['---', 'model: m', '---', '# user', 'hello']
	let view: any
	let info: any
	let plugin: any

	beforeEach(() => {
		resetCaptured()
		;({ view, info } = makeView(lines))
		plugin = new PluginClass(view)
		fileProcessingStopped(info.file)
	})

	function makeWidget(): FooterWidget {
		const widget = footerWidget(plugin.decorations) as FooterWidget
		if (!widget) {
			// build one directly for tests that do not produce a footer
			return new FooterWidget(info.editor, info.file, plugin)
		}
		return widget
	}

	it('toDOM builds the complete, stop, and loading indicator elements', () => {
		const widget = makeWidget()
		const container = widget.toDOM(view) as HTMLElement

		expect(container.className).toBe('llmdocs-footer')
		const buttons = Array.from(container.querySelectorAll('button'))
		expect(buttons.map((button) => button.textContent)).toEqual(['Complete', 'Stop'])
		expect(container.querySelector('.llmdocs-loading-indicator')).not.toBeNull()
	})

	it('the complete button invokes the plugin completeDoc', async () => {
		const completeDoc = jest.fn(async () => {})
		setLlmDocsPlugin({ completeDoc })

		const widget = makeWidget()
		const container = widget.toDOM(view) as HTMLElement
		const complete = container.querySelector<HTMLButtonElement>('.llmdocs-complete-button')!

		await complete.onclick(new MouseEvent('click'))

		expect(completeDoc).toHaveBeenCalledWith(info.editor, info.file)
	})

	it('the stop button invokes the registered stop callback', () => {
		const widget = makeWidget()
		widget.toDOM(view)
		const stop = jest.fn()
		setStopCallback(info.file, stop)

		widget.stopButton.onmousedown(new MouseEvent('mousedown'))

		expect(stop).toHaveBeenCalled()
	})

	it('shows the loading indicator and hides buttons while processing', () => {
		fileProcessingStarted(info.file)
		const widget = makeWidget()
		const container = widget.toDOM(view)

		const complete = container.querySelector<HTMLButtonElement>('.llmdocs-complete-button')!
		const stop = container.querySelector<HTMLButtonElement>('.llmdocs-stop-button')!
		const indicator = container.querySelector<HTMLElement>('.llmdocs-loading-indicator')!

		expect(complete.style.display).toBe('none')
		expect(indicator.style.display).not.toBe('none')
		expect(stop.style.display).not.toBe('none')
	})

	it('hides the indicator when processing stops and rebuilds the plugin', () => {
		fileProcessingStarted(info.file)
		const widget = makeWidget()
		widget.toDOM(view)

		const rebuild = jest.spyOn(plugin, 'rebuild')
		fileProcessingStopped(info.file) // emits fileEvents 'change'

		expect(widget.stopButton.style.display).toBe('none')
		expect(widget.loadingIndicator.style.display).toBe('none')
		expect(rebuild).toHaveBeenCalled()
	})

	it('destroy unsubscribes from file events', () => {
		const widget = makeWidget()
		widget.toDOM(view)
		const rebuild = jest.spyOn(plugin, 'rebuild')

		widget.destroy(widget.loadingIndicator)
		fileProcessingStarted(info.file)
		fileProcessingStopped(info.file)

		expect(rebuild).not.toHaveBeenCalled()
	})
})
