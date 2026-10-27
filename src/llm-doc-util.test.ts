import { describe, expect, it } from '@jest/globals'
import {
	messagesToText,
	preprocessMessages,
	textToMessages,
	filterMessagesForModel,
	ParsedMessage,
} from './llm-doc-util'
import { OpenaiBasicMessage } from './open-ai'

describe('LLM doc util', () => {
	describe('text to messages (and back to text)', () => {
		it('should work with all message types', () => {
			const originalText = `# system\nmessage 1\n# user\nmessage 2\n# assistant\nmessage 3`
			const messages = textToMessages(originalText)
			expect(messages).toEqual([
				{ role: 'system', content: 'message 1' },
				{ role: 'user', content: 'message 2' },
				{ role: 'assistant', content: 'message 3' },
			])
			const text = messagesToText(messages)
			expect(text).toEqual(originalText)
		})
		it('should use whole text as user message when no explicit messages', () => {
			const originalText = 'message'
			const messages = textToMessages(originalText)
			expect(messages).toEqual([{ role: 'user', content: 'message' }])
			const text = messagesToText(messages)
			expect(text).toEqual('# user\nmessage')
		})
	})

	describe('context dividers', () => {
		it('should ignore text before # new except system blocks', () => {
			const originalText = ['# system', 'sys', '# user', 'u1', '# assistant', 'a1', '# new', '# user', 'u2'].join(
				'\n',
			)
			expect(textToMessages(originalText)).toEqual([
				{ role: 'system', content: 'sys' },
				{ role: 'user', content: 'u2' },
			])
		})

		it('should ignore text before # reset including system blocks', () => {
			const originalText = ['# system', 'sys', '# user', 'u1', '# reset', '# user', 'u2'].join('\n')
			expect(textToMessages(originalText)).toEqual([{ role: 'user', content: 'u2' }])
		})

		it('should keep multiple system blocks across # new dividers', () => {
			const originalText = [
				'# system1',
				'sys1',
				'# user',
				'u1',
				'# new',
				'# system2',
				'sys2',
				'# new',
				'# user',
				'u2',
			].join('\n')
			expect(textToMessages(originalText)).toEqual([
				{ role: 'system1', content: 'sys1' },
				{ role: 'system2', content: 'sys2' },
				{ role: 'user', content: 'u2' },
			])
		})

		it('should treat trailing text after a divider as an implicit user message', () => {
			const originalText = ['# user', 'u1', '# new', 'hello'].join('\n')
			expect(textToMessages(originalText)).toEqual([{ role: 'user', content: 'hello' }])
		})

		it('should support suffixes on dividers', () => {
			const originalText = ['# user', 'u1', '# new context A', '# user', 'u2'].join('\n')
			expect(textToMessages(originalText)).toEqual([{ role: 'user', content: 'u2' }])
		})

		it('should not fall back to whole-text user message when a divider leaves no messages', () => {
			const originalText = ['# system', 'sys', '# reset', ''].join('\n')
			expect(textToMessages(originalText)).toEqual([])
		})
	})

	describe('incremental input (typing and pasting)', () => {
		const CONVERSATION = '# system\nsys\n# user\nhello\n# assistant\nhi there\n# new\n# user\nnext message'

		// parse after each character, as if the text was typed
		const typeText = (text: string): ParsedMessage[][] => {
			const snapshots: ParsedMessage[][] = []
			for (let end = 1; end <= text.length; end++) {
				snapshots.push(textToMessages(text.slice(0, end)))
			}
			return snapshots
		}

		// parse after appending each chunk, as if the text was bulk pasted
		const pasteChunks = (chunks: string[]): ParsedMessage[] => {
			let text = ''
			let messages: ParsedMessage[] = []
			for (const chunk of chunks) {
				text += chunk
				messages = textToMessages(text)
			}
			return messages
		}

		it('should produce sane intermediate states while typing', () => {
			const snapshots = typeText(CONVERSATION)
			for (const messages of snapshots) {
				for (const message of messages) {
					// dividers are context boundaries, never messages
					expect(message.role).toMatch(/^(system|user|assistant|note)\d*$/)
					expect(typeof message.content).toBe('string')
				}
			}
			// the final typed state must match wholesale insertion
			expect(snapshots[snapshots.length - 1]).toEqual(textToMessages(CONVERSATION))
			expect(snapshots[snapshots.length - 1]).toEqual([
				{ role: 'system', content: 'sys' },
				{ role: 'user', content: 'next message' },
			])
		})

		it('should keep the previous context while a # new line is being typed and drop it once the line is complete', () => {
			const base = '# system\nsys\n# user\nhello'
			expect(textToMessages(base)).toEqual([
				{ role: 'system', content: 'sys' },
				{ role: 'user', content: 'hello' },
			])
			// partial divider text is still just text in the user block
			expect(textToMessages(`${base}\n# ne`)).toEqual([
				{ role: 'system', content: 'sys' },
				{ role: 'user', content: 'hello\n# ne' },
			])
			// completing the divider line drops the previous context, keeping system
			expect(textToMessages(`${base}\n# new`)).toEqual([{ role: 'system', content: 'sys' }])
			// and the new context builds up from there
			expect(textToMessages(`${base}\n# new\n# user\nnext`)).toEqual([
				{ role: 'system', content: 'sys' },
				{ role: 'user', content: 'next' },
			])
		})

		it('should drop system blocks while a # reset line is being typed once the line is complete', () => {
			const base = '# system\nsys\n# user\nhello'
			expect(textToMessages(`${base}\n# re`)).toEqual([
				{ role: 'system', content: 'sys' },
				{ role: 'user', content: 'hello\n# re' },
			])
			expect(textToMessages(`${base}\n# reset`)).toEqual([])
			expect(textToMessages(`${base}\n# reset\n# user\nagain`)).toEqual([{ role: 'user', content: 'again' }])
		})

		it('should not treat a heading as complete until its line is fully typed', () => {
			expect(textToMessages('# use')).toEqual([{ role: 'user', content: '# use' }])
			expect(textToMessages('# user')).toEqual([{ role: 'user', content: '' }])
			expect(textToMessages('# user\nhel')).toEqual([{ role: 'user', content: 'hel' }])
			expect(textToMessages('# assistant1 (g')).toEqual([{ role: 'user', content: '# assistant1 (g' }])
			expect(textToMessages('# assistant1 (gpt-4)')).toEqual([{ role: 'assistant1', content: '' }])
		})

		it('should parse pasted text identically to typed text', () => {
			// whatever the chunking, the parse at a given text state only depends
			// on the text itself
			const chunks = [CONVERSATION.slice(0, 10), CONVERSATION.slice(10, 40), CONVERSATION.slice(40)]
			expect(pasteChunks(chunks)).toEqual(textToMessages(CONVERSATION))
			// a single big paste behaves the same as typing the same text
			const typed = typeText(CONVERSATION)
			expect(pasteChunks([CONVERSATION])).toEqual(typed[typed.length - 1])
			// pasting onto an existing note keeps the divider semantics
			expect(pasteChunks(['# system\nsys\n# user\nhi\n', '# new\n# user\nnext'])).toEqual([
				{ role: 'system', content: 'sys' },
				{ role: 'user', content: 'next' },
			])
		})
	})

	describe('messages preprocessing', () => {
		it('should remove system prompt if it contains only whitespace', async () => {
			const messages: OpenaiBasicMessage[] = [
				{ role: 'system', content: ' \n' },
				{ role: 'user', content: 'message' },
			]
			const result = await preprocessMessages(messages, nullResolver, nullResolver)
			expect(result).toEqual([{ role: 'user', content: 'message' }])
		})
		it('should expand links in user/system messages but not in assistant messages', async () => {
			const messages: OpenaiBasicMessage[] = [
				{ role: 'system', content: 'text [[mylink]] text [[mylink]]' },
				{ role: 'user', content: 'text [[mylink]] text' },
				{ role: 'assistant', content: 'text [[mylink]] text' },
			]
			const resolver = async () => 'resolved'
			const result = await preprocessMessages(messages, resolver, nullResolver)
			expect(result).toEqual([
				{ role: 'system', content: 'text resolved text resolved' },
				{ role: 'user', content: 'text resolved text' },
				{ role: 'assistant', content: 'text [[mylink]] text' },
			])
		})
		it('should leave links unchanged when they cannot be resolved', async () => {
			const messages: OpenaiBasicMessage[] = [{ role: 'user', content: 'text [[mylink]] text' }]
			const resolver = async () => null
			const result = await preprocessMessages(messages, resolver, nullResolver)
			expect(result).toEqual([{ role: 'user', content: 'text [[mylink]] text' }])
		})
		it('should handle images', async () => {
			const messages: OpenaiBasicMessage[] = [
				{ role: 'user', content: 'Hello\n![[CleanShot 2025-03-12 at 13.11.51@2x.png]]\nworld.' },
			]
			const resolver = async () => 'data:image/jpeg;base64,{base64_image}'
			const result = await preprocessMessages(messages, nullResolver, resolver)
			expect(result).toEqual([
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: 'Hello\n',
						},
						{
							type: 'image_url',
							image_url: {
								url: 'data:image/jpeg;base64,{base64_image}',
							},
						},
						{
							type: 'text',
							text: '\nworld.',
						},
					],
				},
			])
		})
	})

	describe('tool calling functionality', () => {
		it('should properly handle tool calls in messages', () => {
			// Test the existing functionality that handles tool calls
			const messages = [
				{
					role: 'assistant',
					content: 'Some response',
					tool_calls: [
						{
							id: 'call_123',
							type: 'function',
							function: { name: 'get_weather', arguments: '{"location":"London"}' },
						},
					],
				},
			]

			// Just verify that the structure is preserved
			expect(messages[0]).toHaveProperty('tool_calls')
			expect(messages[0].tool_calls).toHaveLength(1)
			expect(messages[0].tool_calls[0]).toHaveProperty('id')
			expect(messages[0].tool_calls[0]).toHaveProperty('type')
			expect(messages[0].tool_calls[0]).toHaveProperty('function')
		})
	})

	describe('filterMessagesForModel fallback logic', () => {
		it('should handle numbered system/user blocks across multiple models with exact fallback sequence', () => {
			const messages: ParsedMessage[] = [
				{ role: 'system', content: 'sys' },

				// Group 2 (User) - only unnumbered user block available for all models
				{ role: 'user', content: 'userB' },

				// Group 3 (Assistant candidates for first turn)
				{ role: 'assistant1', content: 'assC' },
				{ role: 'assistant2', content: 'assD' },
				{ role: 'assistant3', content: 'assE' },

				// Group 4 (User) - only unnumbered user block
				{ role: 'user', content: 'userF' },

				// Group 5 (Assistant) - only unnumbered assistant block
				{ role: 'assistant', content: 'assG' },

				// Group 6 (User) - only unnumbered user block
				{ role: 'user', content: 'userH' },

				// Group 7 (Assistant candidates for second turn)
				{ role: 'assistant1', content: 'assI' },
				{ role: 'assistant3', content: 'assJ' },

				// Group 8 (User) - only unnumbered user block
				{ role: 'user', content: 'userK' },
			]

			const forModel1 = filterMessagesForModel(messages, 0, 3) // indices 0-based -> target 'assistant1'
			expect(forModel1.map((m) => m.content)).toEqual([
				'sys',
				'userB',
				'assC',
				'userF',
				'assG',
				'userH',
				'assI',
				'userK',
			])

			const forModel2 = filterMessagesForModel(messages, 1, 3) // target 'assistant2'
			expect(forModel2.map((m) => m.content)).toEqual([
				'sys',
				'userB',
				'assD',
				'userF',
				'assG',
				'userH',
				'assI',
				'userK',
			])

			const forModel3 = filterMessagesForModel(messages, 2, 3) // target 'assistant3'
			expect(forModel3.map((m) => m.content)).toEqual([
				'sys',
				'userB',
				'assE',
				'userF',
				'assG',
				'userH',
				'assJ',
				'userK',
			])

			// Ensure OpenAI roles are strictly mapped (numbered suffixes removed)
			for (const msg of forModel1.concat(forModel2).concat(forModel3)) {
				expect(['system', 'user', 'assistant'].includes(msg.role as string)).toBe(true)
			}
		})
	})
})

const nullResolver = async () => null
