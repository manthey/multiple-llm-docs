import { describe, expect, it, test } from '@jest/globals'
import { splitKeepingSeparators, ValueEmitter, SimpleEventEmitter } from './utils'

describe('utils', () => {
	test('splitKeepingSeparators()', () => {
		const separator = /\[(.+?)]/g

		// when only non-separator
		expect(splitKeepingSeparators('a', separator)).toEqual([{ text: 'a' }])

		// when only separator
		expect(splitKeepingSeparators('[a]', separator)).toEqual([{ text: '[a]', isSeparator: true, innerMatch: 'a' }])

		// when separator side-by-side
		expect(splitKeepingSeparators('[a][b]', separator)).toEqual([
			{
				text: '[a]',
				isSeparator: true,
				innerMatch: 'a',
			},
			{
				text: '[b]',
				isSeparator: true,
				innerMatch: 'b',
			},
		])

		// when starts with non-separator and ends with separator
		expect(splitKeepingSeparators('a [b] c [d]', separator)).toEqual([
			{
				text: 'a ',
			},
			{
				text: '[b]',
				isSeparator: true,
				innerMatch: 'b',
			},
			{
				text: ' c ',
			},
			{
				text: '[d]',
				isSeparator: true,
				innerMatch: 'd',
			},
		])

		// when starts with separator and ends with non-separator
		expect(splitKeepingSeparators('[a] b [c] d', separator)).toEqual([
			{
				text: '[a]',
				isSeparator: true,
				innerMatch: 'a',
			},
			{
				text: ' b ',
			},
			{
				text: '[c]',
				isSeparator: true,
				innerMatch: 'c',
			},
			{
				text: ' d',
			},
		])
	})
})

describe('ValueEmitter', () => {
	it('notifies all listeners on emit', () => {
		const emitter = new ValueEmitter<number>()
		const received: number[] = []
		emitter.on((value) => received.push(value))
		emitter.on((value) => received.push(value * 10))

		emitter.emit(2)
		expect(received).toEqual([2, 20])
	})

	it('unsubscribes via the returned function', () => {
		const emitter = new ValueEmitter<number>()
		const received: number[] = []
		const unsubscribe = emitter.on((value) => received.push(value))

		unsubscribe()
		emitter.emit(1)
		expect(received).toEqual([])
	})

	it('off removes a specific listener', () => {
		const emitter = new ValueEmitter<number>()
		const received: number[] = []
		const listener = (value: number) => received.push(value)
		emitter.on(listener)
		emitter.off(listener)

		emitter.emit(1)
		expect(received).toEqual([])
	})

	it('once fires a single time only', () => {
		const emitter = new ValueEmitter<number>()
		const received: number[] = []
		emitter.once((value) => received.push(value))

		emitter.emit(1)
		emitter.emit(2)
		expect(received).toEqual([1])
	})
})

describe('SimpleEventEmitter', () => {
	it('emits events with arguments to registered listeners', () => {
		const emitter = new SimpleEventEmitter()
		const received: any[][] = []
		emitter.on('event', (...args: any[]) => received.push(args))

		emitter.emit('event', 'a', 'b')
		expect(received).toEqual([['a', 'b']])
	})

	it('off removes only the matching listener', () => {
		const emitter = new SimpleEventEmitter()
		const calls: string[] = []
		const listenerA = () => calls.push('a')
		const listenerB = () => calls.push('b')
		emitter.on('event', listenerA)
		emitter.on('event', listenerB)

		emitter.off('event', listenerA)
		emitter.emit('event')
		expect(calls).toEqual(['b'])

		emitter.off('event', listenerA) // removing again is a no-op
		emitter.emit('event')
		expect(calls).toEqual(['b', 'b'])
	})

	it('listeners of other events are not called', () => {
		const emitter = new SimpleEventEmitter()
		const calls: string[] = []
		emitter.on('other', () => calls.push('other'))

		emitter.emit('event')
		expect(calls).toEqual([])
	})

	it('removeAllListeners clears everything', () => {
		const emitter = new SimpleEventEmitter()
		const calls: string[] = []
		emitter.on('one', () => calls.push('one'))
		emitter.on('two', () => calls.push('two'))

		emitter.removeAllListeners()
		emitter.emit('one')
		emitter.emit('two')
		expect(calls).toEqual([])
	})
})
