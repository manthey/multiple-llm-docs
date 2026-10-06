import { SimpleEventEmitter } from './utils'
import { LlmConnectionSettings } from './settings'
import { OpenaiToolDef } from './mcp'

export type OpenaiRole = 'user' | 'assistant' | 'system'

export interface OpenaiBasicMessage {
	role: OpenaiRole
	content: string
}

export interface OpenaiMessage {
	role: OpenaiRole
	content: string | OpenaiContent[]
}

export interface OpenaiContent {
	type: 'text' | 'image_url'
	text?: string
	image_url?: {
		url: string
	}
}

export interface OpenaiToolCall {
	id: string
	type: 'function'
	function: {
		name: string
		arguments: string
	}
}

export async function getAvailableOpenaiModels(settings: LlmConnectionSettings): Promise<string[]> {
	const response = await fetch(`${settings.baseUrl}/v1/models`, {
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${settings.apiKey}`,
		},
	})

	await throwOnBadResponse(response)

	const data: any = await response.json()
	return data.data.map((model: any) => model.id)
}

export class OpenaiChatCompletionStream extends SimpleEventEmitter {
	entireContent = ''

	private abortController?: AbortController
	public toolCalls: OpenaiToolCall[] = []

	constructor(
		private settings: LlmConnectionSettings,
		private model: string,
		private messages: OpenaiMessage[],
		private llmParams?: Record<string, unknown>,
		private tools?: OpenaiToolDef[],
	) {
		super()
	}

	result() {
		return new Promise<string>((resolve, reject) => {
			this.on('error', (error) => reject(error))
			this.on('end', () => resolve(this.entireContent))
			this.start()
		})
	}

	async start() {
		try {
			await this.doRequest()
		} catch (error) {
			if ((error as Error).name !== 'AbortError') {
				this.emit('error', error)
			}
		} finally {
			this.emit('end')
			this.removeAllListeners()
		}
	}

	private async doRequest() {
		const recordBody: Record<string, unknown> = {
			model: this.model,
			messages: this.messages,
			stream: true,
			...this.llmParams,
			...(this.llmParams ? { options: this.llmParams } : {}),
		}
		if (this.tools && this.tools.length > 0) {
			recordBody.tools = this.tools
		}
		const data = JSON.stringify(recordBody)

		this.abortController = new AbortController()

		let response = await fetch(`${this.settings.baseUrl}/v1/chat/completions`, {
			method: 'POST',
			body: data,
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.settings.apiKey}`,
			},
			signal: this.abortController.signal,
		})
		const retryable = [
			{ key: 'reasoning_effort', error: ['reasoning', 'thinking', 'unsupported'] },
			{ key: 'tools', error: ['tools', 'unsupported'] },
		]
		for (const { key, error } of retryable) {
			if (recordBody[key] && !response.ok) {
				const errorText = await response.text()
				if (error.some((phrase) => errorText.includes(phrase))) {
					delete recordBody[key]
					const data = JSON.stringify(recordBody)
					response = await fetch(`${this.settings.baseUrl}/v1/chat/completions`, {
						method: 'POST',
						body: data,
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${this.settings.apiKey}`,
						},
						signal: this.abortController.signal,
					})
				}
			}
		}
		await throwOnBadResponse(response)
		const body: ReadableStream<Uint8Array> = response.body!
		const reader = body.getReader()
		const decoder = new TextDecoder('utf-8')
		let done = false
		while (!done) {
			const { done: readerDone, value } = await reader.read()
			done = readerDone
			if (value) {
				const chunk = decoder.decode(value, { stream: true })
				this.processChunk(chunk)
			}
		}
	}

	private processChunk(chunk: string) {
		const lines = chunk.toString().split('\n')
		for (const line of lines) {
			if (!line.startsWith('data: ')) continue
			const json = line.slice(6)
			let data: any
			try {
				data = JSON.parse(json)
			} catch {
				continue
			}
			const delta = data?.choices?.[0]?.delta
			if (!delta) continue

			if (delta.tool_calls) {
				for (const tc of delta.tool_calls) {
					this.mergeToolCallDelta(tc)
				}
			}

			if (delta.content) {
				this.entireContent += delta.content
				this.emit('data', delta.content)
			}
		}
	}

	private mergeToolCallDelta(delta: any) {
		const index: number = delta.index ?? 0
		while (this.toolCalls.length <= index) {
			this.toolCalls.push({ id: '', type: 'function', function: { name: '', arguments: '' } })
		}
		const tc = this.toolCalls[index]
		if (delta.id) tc.id = delta.id
		if (delta.function?.name) tc.function.name += delta.function.name
		if (delta.function?.arguments) tc.function.arguments += delta.function.arguments
	}

	stop() {
		this.abortController?.abort()
	}
}

async function throwOnBadResponse(response: Response) {
	if (response.ok) {
		return
	}
	let json: any
	try {
		json = await response.json()
	} catch (ex) {
		throw new Error(`${response.status} ${response.statusText}`)
	}
	const error = json.error
	if (error.code === 'invalid_api_key') {
		throw new Error('Invalid OpenAI API key')
	}
	if (error.message.startsWith("You didn't provide an API key")) {
		throw new Error('You must provide an OpenAI API key')
	}
	throw new Error(error.message)
}
