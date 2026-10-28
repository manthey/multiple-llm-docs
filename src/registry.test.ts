import { describe, expect, it, beforeEach } from '@jest/globals'
import {
	fileEvents,
	fileProcessingStarted,
	fileProcessingStopped,
	getLlmDocsPlugin,
	getStopCallback,
	isFileBeingProcessed,
	setLlmDocsPlugin,
	setStopCallback,
} from './registry'
import { TFile } from 'obsidian'

function fakeFile(path: string): TFile {
	return { path } as unknown as TFile
}

describe('file processing registry', () => {
	const file = fakeFile('notes/llm.md')

	beforeEach(() => {
		fileProcessingStopped(file)
	})

	it('tracks whether a file is being processed and emits change events', () => {
		const events: string[] = []
		fileEvents.on('change', () => events.push('change'))

		expect(isFileBeingProcessed(file)).toBe(false)
		fileProcessingStarted(file)
		expect(isFileBeingProcessed(file)).toBe(true)
		expect(events).toEqual(['change'])

		fileProcessingStopped(file)
		expect(isFileBeingProcessed(file)).toBe(false)
		expect(events).toEqual(['change', 'change'])
	})

	it('clears the stop callback when processing stops', () => {
		fileProcessingStarted(file)
		setStopCallback(file, () => {})
		expect(getStopCallback(file)).toBeDefined()

		fileProcessingStopped(file)
		expect(getStopCallback(file)).toBeUndefined()
	})

	it('returns undefined for files without a stop callback', () => {
		expect(getStopCallback(fakeFile('other.md'))).toBeUndefined()
	})
})

describe('plugin registry', () => {
	it('stores and retrieves the plugin instance', () => {
		const plugin = { completeDoc: async () => {} }
		setLlmDocsPlugin(plugin)
		expect(getLlmDocsPlugin()).toBe(plugin)
	})
})
