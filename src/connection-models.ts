import { LlmConnectionSettings } from './settings'
import { getAvailableOpenaiModels } from './open-ai'
import { modelCacheUpdated } from './registry'

export const modelToConnectionCache = new Map<string, string>()

export function getConnectionId(connection: LlmConnectionSettings) {
	return connection.type + connection.baseUrl
}

/**
 * Resolve the connection to use for an explicit `llm_connection` value.
 *
 * The value may be a connection's short name, or a connection URL. If neither
 * matches a configured connection, an ad-hoc connection is created for the URL;
 * it borrows the type and API key of the default connection (if any), so that
 * impromptu URLs such as a different local ollama port still authenticate.
 */
export function resolveConnectionForValue(
	connections: LlmConnectionSettings[],
	value: string,
): LlmConnectionSettings {
	const named = connections.find((connection) => connection.name === value)
	if (named) {
		return named
	}

	const byUrl = connections.find((connection) => connection.baseUrl === value)
	if (byUrl) {
		return byUrl
	}

	const fallback = connections.find((connection) => connection.isDefault)
	return {
		type: fallback?.type ?? 'OpenAI',
		baseUrl: value,
		apiKey: fallback?.apiKey ?? '',
	}
}

export async function getAvailableModelsAndUpdateCache(connection: LlmConnectionSettings) {
	const connectionId = getConnectionId(connection)
	let models = await getAvailableOpenaiModels(connection)
	let somethingChanged = false
	for (const model of models) {
		const existing = modelToConnectionCache.get(model)
		if (!existing || existing !== connectionId) {
			modelToConnectionCache.set(model, connectionId)
			somethingChanged = true
		}
	}
	if (somethingChanged) {
		modelCacheUpdated.emit()
	}
}

export async function getAllAvailableModelsAndUpdateCache(connections: LlmConnectionSettings[]) {
	const promises = connections.map((connection) => getAvailableModelsAndUpdateCache(connection).catch(() => {}))
	await Promise.all(promises)
}

function resolveCachedConnectionForModel(
	connections: LlmConnectionSettings[],
	model: string,
): LlmConnectionSettings | null {
	const cachedConnectionId = modelToConnectionCache.get(model)
	if (cachedConnectionId) {
		const matching = connections.find((connection) => getConnectionId(connection) === cachedConnectionId)
		if (matching) {
			return matching
		}
	}
	return null
}

export async function resolveConnectionForModel(
	connections: LlmConnectionSettings[],
	model: string,
): Promise<LlmConnectionSettings | null> {
	const cached = resolveCachedConnectionForModel(connections, model)
	if (cached) {
		return cached
	}

	await getAllAvailableModelsAndUpdateCache(connections)

	return resolveCachedConnectionForModel(connections, model)
}
