import { LlmConnectionSettings } from './settings'
import { getAvailableOpenaiModels } from './open-ai'
import { modelCacheUpdated } from './registry'

export const modelToConnectionCache = new Map<string, string>()

export function getConnectionId(connection: LlmConnectionSettings) {
	return connection.type + connection.baseUrl
}

/**
 * The default connection, used when no explicit `llm_connection` applies to a
 * query or when an impromptu URL needs to borrow credentials. If no connection
 * is explicitly marked as the default, the first configured connection is used.
 * Returns null only when there are no connections at all.
 */
export function getDefaultConnection(connections: LlmConnectionSettings[]): LlmConnectionSettings | null {
	return connections.find((connection) => connection.isDefault) ?? connections[0] ?? null
}

export function getDefaultConnectionId(connections: LlmConnectionSettings[]): string | null {
	const connection = getDefaultConnection(connections)
	return connection ? getConnectionId(connection) : null
}

/**
 * Ensure exactly one connection is explicitly marked as the default whenever
 * connections exist. If none is marked, the first is selected. Returns true if
 * the connections were modified.
 */
export function ensureDefaultConnection(connections: LlmConnectionSettings[]): boolean {
	if (connections.length === 0) {
		return false
	}
	const defaultIndex = connections.findIndex((connection) => connection.isDefault)
	if (defaultIndex === -1) {
		connections[0].isDefault = true
		return true
	}
	let changed = false
	connections.forEach((connection, index) => {
		const shouldBeDefault = index === defaultIndex
		if (!!connection.isDefault !== shouldBeDefault) {
			connection.isDefault = shouldBeDefault
			changed = true
		}
	})
	return changed
}

/**
 * Resolve the connection to use for an explicit `llm_connection` value.
 *
 * The value may be a connection's short name, or a connection URL. If neither
 * matches a configured connection, an ad-hoc connection is created for the URL;
 * it borrows the type and API key of the default connection (if any), so that
 * impromptu URLs such as a different local ollama port still authenticate.
 */
export function resolveConnectionForValue(connections: LlmConnectionSettings[], value: string): LlmConnectionSettings {
	const named = connections.find((connection) => connection.name === value)
	if (named) {
		return named
	}

	const byUrl = connections.find((connection) => connection.baseUrl === value)
	if (byUrl) {
		return byUrl
	}

	const fallback = getDefaultConnection(connections)
	return {
		type: fallback?.type ?? 'OpenAI',
		baseUrl: value,
		apiKey: fallback?.apiKey ?? '',
	}
}

export async function getAvailableModelsAndUpdateCache(connection: LlmConnectionSettings) {
	const connectionId = getConnectionId(connection)
	const models = await getAvailableOpenaiModels(connection)
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
	// Fetch the default connection last so that, when a model is served by more
	// than one connection, it ends up associated with the default and the
	// default credentials are the ones used for queries.
	const defaultConnectionId = getDefaultConnectionId(connections)
	const ordered = [
		...connections.filter((connection) => getConnectionId(connection) !== defaultConnectionId),
		...connections.filter((connection) => getConnectionId(connection) === defaultConnectionId),
	]
	for (const connection of ordered) {
		await getAvailableModelsAndUpdateCache(connection).catch(() => {})
	}
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

	// Prefer a configured connection that advertises the model. If none does (the
	// model may be cached against an ad-hoc connection, or the connection may not
	// list models), fall back to the default so its API key is applied rather than
	// failing or using empty credentials.
	return resolveCachedConnectionForModel(connections, model) ?? getDefaultConnection(connections)
}
