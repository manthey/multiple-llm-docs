import { expect, it, describe, beforeEach, jest } from '@jest/globals'
import {
	getAvailableOpenaiModels,
	OpenaiChatCompletionStream,
	OpenaiMessage,
} from './open-ai'
import { LlmConnectionSettings } from './settings'
import { OpenaiToolDef } from './mcp'

const settings: LlmConnectionSettings = {
	type: 'OpenAI',
	baseUrl: 'https://api.example.com',
	apiKey: 'secret-key',
}

const messages: OpenaiMessage[] = [{ role: 'user', content: 'hello' }]

function okJsonResponse(body: any): Response {
	return {
		ok: true,
		json: async () => body,
	} as unknown as Response
}

function errorResponse(body: any, status = 400, statusText = 'Bad Request'): Response {
	return {
		ok: false,
		status,
		statusText,
		json: async () => body,
	} as unknown as Response
}

function sseResponse(lines: string[]): Response {
	const encoder = new TextEncoder()
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const line of lines) controller.enqueue(encoder.encode(line + '\n'))
			controller.close()
		},
	})
	return { ok: true, body } as unknown as Response
}

function dataLine(delta: any): string {
	return 'data: ' + JSON.stringify({ choices: [{ delta }] })
}

const fetchMock = () => global.fetch as jest.Mock

describe('getAvailableOpenaiModels', () => {
	beforeEach(() => {
		global.fetch = jest.fn()
	})

	it('returns model ids from the /v1/models endpoint with auth header', async () => {
		fetchMock().mockResolvedValue(okJsonResponse({ data: [{ id: 'gpt-4o' }, { id: 'llama3' }] }))

		await expect(getAvailableOpenaiModels(settings)).resolves.toEqual(['gpt-4o', 'llama3'])

		const [url, init] = fetchMock().mock.calls[0]
		expect(url).toBe('https://api.example.com/v1/models')
		expect(init.headers.Authorization).toBe('Bearer secret-key')
	})

	it('throws the API error message for a bad response', async () => {
		fetchMock().mockResolvedValue(errorResponse({ error: { message: 'quota exceeded' } }))
		await expect(getAvailableOpenaiModels(settings)).rejects.toThrow('quota exceeded')
	})

	it('throws a friendly error for an invalid API key', async () => {
		fetchMock().mockResolvedValue(
			errorResponse({ error: { code: 'invalid_api_key', message: 'Incorrect API key' } }),
		)
		await expect(getAvailableOpenaiModels(settings)).rejects.toThrow('Invalid OpenAI API key')
	})

	it('throws a friendly error when no API key was provided', async () => {
		fetchMock().mockResolvedValue(
			errorResponse({ error: { message: "You didn't provide an API key." } }),
		)
		await expect(getAvailableOpenaiModels(settings)).rejects.toThrow('You must provide an OpenAI API key')
	})

	it('throws status and status text for a non-JSON error body', async () => {
		fetchMock().mockResolvedValue({
			ok: false,
			status: 502,
			statusText: 'Bad Gateway',
			json: async () => {
				throw new Error('not json')
			},
		} as unknown as Response)
		await expect(getAvailableOpenaiModels(settings)).rejects.toThrow('502 Bad Gateway')
	})
})

describe('OpenaiChatCompletionStream', () => {
	beforeEach(() => {
		global.fetch = jest.fn()
	})

	function makeStream(options: {
		llmParams?: Record<string, unknown>
		tools?: OpenaiToolDef[]
	}): OpenaiChatCompletionStream {
		return new OpenaiChatCompletionStream(settings, 'test-model', messages, options.llmParams, options.tools)
	}

	it('streams content, emits data events, and resolves with the full content', async () => {
		const stream = makeStream({})
		const dataEvents: string[] = []
		stream.on('data', (chunk: string) => dataEvents.push(chunk))

		fetchMock().mockResolvedValue(sseResponse([dataLine({ content: 'Hello' }), dataLine({ content: ' world' }), 'data: [DONE]']))

		await expect(stream.result()).resolves.toBe('Hello world')
		expect(stream.entireContent).toBe('Hello world')
		expect(dataEvents).toEqual(['Hello', ' world'])
	})

	it('posts the expected request body', async () => {
		const tools: OpenaiToolDef[] = [
			{ type: 'function', function: { name: 'f', description: '', parameters: {} } },
		]
		const stream = makeStream({ llmParams: { temperature: 0.5 }, tools })
		fetchMock().mockResolvedValue(sseResponse([dataLine({ content: 'ok' })]))

		await stream.result()

		const [, init] = fetchMock().mock.calls[0]
		const body = JSON.parse(init.body)
		expect(init.method).toBe('POST')
		expect(body.model).toBe('test-model')
		expect(body.messages).toEqual(messages)
		expect(body.stream).toBe(true)
		expect(body.temperature).toBe(0.5)
		expect(body.options).toEqual({ temperature: 0.5 })
		expect(body.tools).toEqual(tools)
	})

	it('omits tools from the body when none are provided', async () => {
		const stream = makeStream({})
		fetchMock().mockResolvedValue(sseResponse([dataLine({ content: 'ok' })]))

		await stream.result()

		const body = JSON.parse(fetchMock().mock.calls[0][1].body)
		expect(body.tools).toBeUndefined()
	})

	it('merges streamed tool call deltas across indices', async () => {
		const stream = makeStream({})
		fetchMock().mockResolvedValue(
			sseResponse([
				dataLine({ tool_calls: [{ index: 0, id: 'call1', function: { name: 'get', arguments: '' } }] }),
				dataLine({ tool_calls: [{ index: 0, function: { arguments: '{"a":' } }] }),
				dataLine({ tool_calls: [{ index: 0, function: { arguments: '1}' } }] }),
				dataLine({ tool_calls: [{ index: 1, id: 'call2', function: { name: 'put', arguments: '{}' } }] }),
			]),
		)

		await stream.result()

		expect(stream.toolCalls).toEqual([
			{ id: 'call1', type: 'function', function: { name: 'get', arguments: '{"a":1}' } },
			{ id: 'call2', type: 'function', function: { name: 'put', arguments: '{}' } },
		])
	})

	it('ignores malformed and non-SSE lines', async () => {
		const stream = makeStream({})
		fetchMock().mockResolvedValue(
			sseResponse([
				'not an sse line',
				'data: {invalid json',
				dataLine({ content: 'kept' }),
				'',
			]),
		)

		await expect(stream.result()).resolves.toBe('kept')
	})

	it('retries without reasoning_effort when the server rejects it', async () => {
		const stream = makeStream({ llmParams: { reasoning_effort: 'high' } })
		fetchMock()
			.mockResolvedValueOnce({
				ok: false,
				status: 400,
				statusText: 'Bad Request',
				text: async () => 'reasoning is unsupported by this model',
			} as unknown as Response)
			.mockResolvedValueOnce(sseResponse([dataLine({ content: 'done' })]))

		await expect(stream.result()).resolves.toBe('done')
		expect(fetchMock()).toHaveBeenCalledTimes(2)

		const firstBody = JSON.parse(fetchMock().mock.calls[0][1].body)
		expect(firstBody.reasoning_effort).toBe('high')
		const secondBody = JSON.parse(fetchMock().mock.calls[1][1].body)
		expect(secondBody.reasoning_effort).toBeUndefined()
	})

	it('retries without tools when the server rejects them', async () => {
		const tools: OpenaiToolDef[] = [
			{ type: 'function', function: { name: 'f', description: '', parameters: {} } },
		]
		const stream = makeStream({ tools })
		fetchMock()
			.mockResolvedValueOnce({
				ok: false,
				status: 400,
				statusText: 'Bad Request',
				text: async () => 'tools are not supported',
			} as unknown as Response)
			.mockResolvedValueOnce(sseResponse([dataLine({ content: 'done' })]))

		await expect(stream.result()).resolves.toBe('done')
		const secondBody = JSON.parse(fetchMock().mock.calls[1][1].body)
		expect(secondBody.tools).toBeUndefined()
	})

	it('does not retry non-retryable errors and rejects with the error', async () => {
		const stream = makeStream({})
		fetchMock().mockResolvedValue(errorResponse({ error: { message: 'bad model' } }))

		await expect(stream.result()).rejects.toThrow('bad model')
		expect(fetchMock()).toHaveBeenCalledTimes(1)
	})

	it('resolves when the request is aborted via stop()', async () => {
		const stream = makeStream({})
		fetchMock().mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					const abortError = new Error('aborted')
					abortError.name = 'AbortError'
					// capture the signal so stop() can trigger it
					Promise.resolve().then(() => stream.stop())
					reject(abortError)
				}),
		)

		await expect(stream.result()).resolves.toBe('')
	})

	it('emits error for other request failures', async () => {
		const stream = makeStream({})
		fetchMock().mockRejectedValue(new Error('network down'))

		await expect(stream.result()).rejects.toThrow('network down')
	})
})
