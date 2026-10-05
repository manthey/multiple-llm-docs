import { describe, expect, it } from '@jest/globals'
import { LlmConnectionSettings } from './settings'
import { ensureDefaultConnection, getDefaultConnection, resolveConnectionForValue } from './connection-models'

function connection(overrides: Partial<LlmConnectionSettings> = {}): LlmConnectionSettings {
	return {
		type: 'OpenAI',
		baseUrl: 'https://api.openai.com',
		apiKey: '',
		...overrides,
	}
}

describe('getDefaultConnection', () => {
	it('returns null when there are no connections', () => {
		expect(getDefaultConnection([])).toBeNull()
	})

	it('returns the explicitly marked default', () => {
		const first = connection({ baseUrl: 'https://first' })
		const second = connection({ baseUrl: 'https://second', isDefault: true })
		expect(getDefaultConnection([first, second])).toBe(second)
	})

	it('falls back to the first connection when none is marked', () => {
		const first = connection({ baseUrl: 'https://first' })
		const second = connection({ baseUrl: 'https://second' })
		expect(getDefaultConnection([first, second])).toBe(first)
	})
})

describe('ensureDefaultConnection', () => {
	it('marks the first connection when none is marked', () => {
		const first = connection({ baseUrl: 'https://first' })
		const second = connection({ baseUrl: 'https://second' })
		expect(ensureDefaultConnection([first, second])).toBe(true)
		expect(first.isDefault).toBe(true)
		expect(second.isDefault).toBeFalsy()
	})

	it('does nothing when a default is already set', () => {
		const first = connection({ baseUrl: 'https://first', isDefault: true })
		const second = connection({ baseUrl: 'https://second' })
		expect(ensureDefaultConnection([first, second])).toBe(false)
		expect(first.isDefault).toBe(true)
		expect(second.isDefault).toBeFalsy()
	})

	it('keeps only the first default when several are marked', () => {
		const first = connection({ baseUrl: 'https://first', isDefault: true })
		const second = connection({ baseUrl: 'https://second', isDefault: true })
		expect(ensureDefaultConnection([first, second])).toBe(true)
		expect(first.isDefault).toBe(true)
		expect(second.isDefault).toBe(false)
	})

	it('does nothing when there are no connections', () => {
		expect(ensureDefaultConnection([])).toBe(false)
	})
})

describe('resolveConnectionForValue', () => {
	const defaultConnection = connection({ baseUrl: 'https://default', apiKey: 'default-key', isDefault: true })
	const named = connection({ baseUrl: 'https://named', apiKey: 'named-key', name: 'local' })

	it('matches by short name', () => {
		expect(resolveConnectionForValue([defaultConnection, named], 'local')).toBe(named)
	})

	it('matches by base URL', () => {
		expect(resolveConnectionForValue([defaultConnection, named], 'https://named')).toBe(named)
	})

	it('borrows the type and API key from the default for an unknown URL', () => {
		const resolved = resolveConnectionForValue([defaultConnection, named], 'https://impromptu')
		expect(resolved).toEqual({
			type: 'OpenAI',
			baseUrl: 'https://impromptu',
			apiKey: 'default-key',
		})
	})

	it('borrows the API key from the first connection when none is marked default', () => {
		const first = connection({ baseUrl: 'https://first', apiKey: 'first-key' })
		const second = connection({ baseUrl: 'https://second', apiKey: 'second-key' })
		const resolved = resolveConnectionForValue([first, second], 'https://impromptu')
		expect(resolved.apiKey).toBe('first-key')
	})

	it('uses an empty API key when there are no connections', () => {
		const resolved = resolveConnectionForValue([], 'https://impromptu')
		expect(resolved.apiKey).toBe('')
		expect(resolved.type).toBe('OpenAI')
	})
})
