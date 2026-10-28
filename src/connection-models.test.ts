import { describe, expect, it, jest, beforeEach } from '@jest/globals'
import { LlmConnectionSettings } from './settings'
import {
	ensureDefaultConnection,
	getDefaultConnection,
	getConnectionId,
	getDefaultConnectionId,
	getAvailableModelsAndUpdateCache,
	getAllAvailableModelsAndUpdateCache,
	modelToConnectionCache,
	resolveConnectionForModel,
	resolveConnectionForValue,
} from './connection-models'
import { modelCacheUpdated } from './registry'

// Network guard: model fetches are mocked for the cache tests below.
jest.mock('./open-ai', () => ({
	getAvailableOpenaiModels: jest.fn(),
}))
const { getAvailableOpenaiModels }: any = jest.requireMock('./open-ai')

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

describe('getConnectionId / getDefaultConnectionId', () => {
	it('builds the id from type and base url', () => {
		expect(getConnectionId(connection({ type: 'OpenAI', baseUrl: 'https://x' }))).toBe('OpenAIhttps://x')
	})

	it('returns null for the default id when there are no connections', () => {
		expect(getDefaultConnectionId([])).toBeNull()
	})
})

describe('resolveConnectionForValue', () => {
	it('matches a connection by short name', () => {
		const named = connection({ name: 'main' })
		expect(resolveConnectionForValue([connection(), named], 'main')).toBe(named)
	})

	it('matches a connection by base url', () => {
		const byUrl = connection({ baseUrl: 'https://specific' })
		expect(resolveConnectionForValue([connection(), byUrl], 'https://specific')).toBe(byUrl)
	})

	it('prefers the explicitly marked default for borrowed credentials', () => {
		const fallback = connection({ baseUrl: 'https://default', isDefault: true, apiKey: 'default-key', type: 'OpenAI' })
		const resolved = resolveConnectionForValue([connection({ apiKey: 'other' }), fallback], 'https://impromptu')
		expect(resolved).toEqual({
			type: 'OpenAI',
			baseUrl: 'https://impromptu',
			apiKey: 'default-key',
		})
	})
})

describe('model cache resolution', () => {
	const first = connection({ baseUrl: 'https://first' })
	const second = connection({ baseUrl: 'https://second', isDefault: true })

	beforeEach(() => {
		modelToConnectionCache.clear()
		getAvailableOpenaiModels.mockReset()
	})

	it('caches fetched models against the connection id and emits on change', async () => {
		getAvailableOpenaiModels.mockResolvedValue(['m1', 'm2'])
		const emitSpy = jest.spyOn(modelCacheUpdated, 'emit')

		await getAvailableModelsAndUpdateCache(first)

		expect(modelToConnectionCache.get('m1')).toBe('OpenAIhttps://first')
		expect(modelToConnectionCache.get('m2')).toBe('OpenAIhttps://first')
		expect(emitSpy).toHaveBeenCalledTimes(1)

		// second fetch with the same models: no change, no emit
		await getAvailableModelsAndUpdateCache(first)
		expect(emitSpy).toHaveBeenCalledTimes(1)

		// a new model changes the cache and emits
		getAvailableOpenaiModels.mockResolvedValue(['m1', 'm2', 'm3'])
		await getAvailableModelsAndUpdateCache(first)
		expect(emitSpy).toHaveBeenCalledTimes(2)
	})

	it('fetch failures propagate from the single-connection call', async () => {
		getAvailableOpenaiModels.mockRejectedValue(new Error('offline'))
		await expect(getAvailableModelsAndUpdateCache(first)).rejects.toThrow('offline')
	})

	it('fetches the default connection last so shared models map to it', async () => {
		getAvailableOpenaiModels.mockResolvedValue(['shared'])

		await getAllAvailableModelsAndUpdateCache([first, second])

		expect(getAvailableOpenaiModels.mock.calls.map((call: any[]) => call[0].baseUrl)).toEqual([
			'https://first',
			'https://second',
		])
		expect(modelToConnectionCache.get('shared')).toBe('OpenAIhttps://second')
	})

	it('swallows fetch failures across all connections', async () => {
		getAvailableOpenaiModels.mockRejectedValue(new Error('offline'))
		await expect(getAllAvailableModelsAndUpdateCache([first, second])).resolves.toBeUndefined()
	})

	it('resolves from the cache without refetching', async () => {
		modelToConnectionCache.set('m1', 'OpenAIhttps://first')

		const resolved = await resolveConnectionForModel([first, second], 'm1')

		expect(resolved).toBe(first)
		expect(getAvailableOpenaiModels).not.toHaveBeenCalled()
	})

	it('refetches on a cache miss and resolves from the refreshed cache', async () => {
		getAvailableOpenaiModels.mockResolvedValue(['m2'])

		const resolved = await resolveConnectionForModel([first, second], 'm2')

		expect(resolved).toBe(second)
		expect(getAvailableOpenaiModels).toHaveBeenCalledTimes(2) // once per connection
	})

	it('falls back to the default connection for unknown models', async () => {
		getAvailableOpenaiModels.mockResolvedValue(['other'])

		const resolved = await resolveConnectionForModel([first, second], 'unknown-model')

		expect(resolved).toBe(second)
	})

	it('returns null when there are no connections at all', async () => {
		getAvailableOpenaiModels.mockResolvedValue([])

		const resolved = await resolveConnectionForModel([], 'm1')

		expect(resolved).toBeNull()
	})
})
