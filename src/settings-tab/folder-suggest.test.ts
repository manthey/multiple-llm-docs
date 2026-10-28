import { expect, it, describe, beforeEach } from '@jest/globals'
import { FolderSuggest } from './folder-suggest'
import { fakeApp, resetCaptured } from './test-utils'

function makeSuggest(folders: string[] = ['LLM', 'Projects/Notes']) {
	const app = fakeApp()
	app.vault.getAllFolders = () => folders.map((path) => ({ path }))
	const inputEl = document.createElement('input')
	const suggest = new FolderSuggest(app, inputEl)
	return { suggest, inputEl }
}

describe('FolderSuggest', () => {
	beforeEach(() => {
		resetCaptured()
	})

	it('collects all vault folders plus the root', () => {
		const { suggest } = makeSuggest()
		expect(suggest.getSuggestions('')).toEqual(['/', 'LLM', 'Projects/Notes'])
	})

	it('filters folders case-insensitively', () => {
		const { suggest } = makeSuggest()
		expect(suggest.getSuggestions('llm')).toEqual(['LLM'])
		expect(suggest.getSuggestions('NOTES')).toEqual(['Projects/Notes'])
	})

	it('returns nothing for non-matching input', () => {
		const { suggest } = makeSuggest()
		expect(suggest.getSuggestions('zzz')).toEqual([])
	})

	it('selectSuggestion sets the input value, closes, and triggers input event', () => {
		const { suggest, inputEl } = makeSuggest()
		const dispatched: Event[] = []
		jest.spyOn(inputEl, 'dispatchEvent').mockImplementation((event) => {
			dispatched.push(event)
			return true
		})
		const closeSpy = jest.spyOn(suggest, 'close')

		suggest.selectSuggestion('LLM')

		expect(inputEl.value).toBe('LLM')
		expect(closeSpy).toHaveBeenCalled()
		expect(dispatched.length).toBe(1)
		expect(dispatched[0].type).toBe('input')
	})
})
