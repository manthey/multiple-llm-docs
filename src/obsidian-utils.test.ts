import { expect, it, describe, beforeEach } from '@jest/globals'
import { DocOpenMethods } from './settings'
import { getDocLinkResolver, getImageLinkResolver, getLeaf } from './obsidian-utils'

function fakeFile(extension: string) {
	return { extension }
}

function fakeApp(file: any | null) {
	return {
		metadataCache: {
			getFirstLinkpathDest: jest.fn(() => file),
		},
		vault: {
			cachedRead: jest.fn(async () => 'file content'),
			readBinary: jest.fn(async () => new Uint8Array([1, 2, 3]).buffer),
		},
	} as any
}

describe('getLeaf', () => {
	it('maps each doc open method to the right workspace leaf request', () => {
		const cases: Array<[DocOpenMethods, any[]]> = [
			[DocOpenMethods.replace, []],
			[DocOpenMethods.tab, ['tab']],
			[DocOpenMethods.splitVertical, ['split', 'vertical']],
			[DocOpenMethods.splitHorizontal, ['split', 'horizontal']],
			[DocOpenMethods.window, ['window']],
		]
		for (const [method, args] of cases) {
			const calls: any[][] = []
			const workspace = {
				getLeaf: (...getArgs: any[]) => {
					calls.push(getArgs)
					return 'leaf'
				},
			}
			expect(getLeaf(workspace as any, method)).toBe('leaf')
			expect(calls[0]).toEqual(args)
		}
	})

	it('falls back to a tab for unknown methods', () => {
		const calls: any[][] = []
		const workspace = {
			getLeaf: (...args: any[]) => {
				calls.push(args)
				return 'leaf'
			},
		}
		expect(getLeaf(workspace as any, 'nonsense' as DocOpenMethods)).toBe('leaf')
		expect(calls[0]).toEqual(['tab'])
	})
})

describe('getDocLinkResolver', () => {
	it('returns the file content for text documents', async () => {
		const app = fakeApp(fakeFile('md'))
		const resolve = getDocLinkResolver(app, 'source.md')

		await expect(resolve('note')).resolves.toBe('file content')
		expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('note', 'source.md')
	})

	it('accepts all text extensions', async () => {
		for (const extension of ['txt', 'md', 'markdown', 'html']) {
			const app = fakeApp(fakeFile(extension))
			await expect(getDocLinkResolver(app)(`file.${extension}`)).resolves.toBe('file content')
		}
	})

	it('returns null for missing files', async () => {
		const app = fakeApp(null)
		await expect(getDocLinkResolver(app)('missing')).resolves.toBeNull()
	})

	it('returns null for non-text files such as images', async () => {
		const app = fakeApp(fakeFile('png'))
		await expect(getDocLinkResolver(app)('image')).resolves.toBeNull()
	})

	it('decodes uri-encoded link paths', async () => {
		const app = fakeApp(fakeFile('md'))
		await getDocLinkResolver(app)('my%20note')
		expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('my note', '')
	})
})

describe('getImageLinkResolver', () => {
	it('returns a data url for images', async () => {
		const app = fakeApp(fakeFile('png'))
		const resolve = getImageLinkResolver(app, 'source.md')

		const result = await resolve('picture')
		expect(result).toMatch(/^data:image\/png;base64,/)
	})

	it('maps jpg to the jpeg mime type', async () => {
		const app = fakeApp(fakeFile('jpg'))
		const result = await getImageLinkResolver(app)('picture')
		expect(result).toMatch(/^data:image\/jpeg;base64,/)
	})

	it('returns null for missing files and non-image extensions', async () => {
		const app = fakeApp(null)
		await expect(getImageLinkResolver(app)('missing')).resolves.toBeNull()

		const app2 = fakeApp(fakeFile('md'))
		await expect(getImageLinkResolver(app2)('note')).resolves.toBeNull()
	})

	it('skips resizing when the image is within the size limit', async () => {
		const app = fakeApp(fakeFile('png'))
		;(globalThis as any).URL.createObjectURL = jest.fn(() => 'blob:fake')
		;(globalThis as any).URL.revokeObjectURL = jest.fn()

		class FakeImage {
			onload: () => void = () => {}
			set src(_value: string) {
				// simulate a small image loading successfully
				Promise.resolve().then(() => {
					Object.defineProperties(this, {
						width: { value: 10 },
						height: { value: 10 },
					})
					this.onload()
				})
			}
		}
		;(globalThis as any).Image = FakeImage

		const result = await getImageLinkResolver(app, '', 256)('picture')
		expect(result).toMatch(/^data:image\/png;base64,/)
		expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
	})
})

describe('getImageLinkResolver image resizing', () => {
	const realCreateElement = document.createElement.bind(document)

	function fakeImage(width: number, height: number) {
		class FakeImage {
			onload: () => void = () => {}
			onerror: () => void = () => {}
			set src(_value: string) {
				Promise.resolve().then(() => {
					Object.defineProperties(this, {
						width: { value: width },
						height: { value: height },
					})
					this.onload()
				})
			}
		}
		;(globalThis as any).Image = FakeImage
	}

	function fakeCanvas(toDataUrl: jest.Mock) {
		return {
			width: 0,
			height: 0,
			getContext: () => ({ drawImage: jest.fn() }),
			toDataURL: toDataUrl,
		}
	}

	beforeEach(() => {
		;(globalThis as any).URL.createObjectURL = jest.fn(() => 'blob:fake')
		;(globalThis as any).URL.revokeObjectURL = jest.fn()
	})

	afterEach(() => {
		document.createElement = realCreateElement
	})

	it('scales oversized images down to the size limit', async () => {
		const toDataUrl = jest.fn(() => 'data:image/png;base64,RESIZED')
		jest.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
			tag === 'canvas' ? (fakeCanvas(toDataUrl) as any) : realCreateElement(tag)) as any)
		fakeImage(1000, 500)
		const app = fakeApp(fakeFile('png'))

		const result = await getImageLinkResolver(app, '', 256)('picture')

		expect(toDataUrl).toHaveBeenCalledWith('image/png')
		// canvas was sized to fit within 256
		const canvas = toDataUrl.mock.contexts[0] as any
		expect(canvas.width).toBe(256)
		expect(canvas.height).toBe(128)
		expect(result).toBe('data:image/png;base64,RESIZED')
	})

	it('resizes gifs to png data urls', async () => {
		const toDataUrl = jest.fn(() => 'data:image/png;base64,GIF')
		jest.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
			tag === 'canvas' ? (fakeCanvas(toDataUrl) as any) : realCreateElement(tag)) as any)
		fakeImage(1000, 1000)
		const app = fakeApp(fakeFile('gif'))

		const result = await getImageLinkResolver(app, '', 100)('picture')

		expect(toDataUrl).toHaveBeenCalledWith('image/png')
		expect(result).toBe('data:image/png;base64,GIF')
	})

	it('falls back to the original bytes when image loading fails', async () => {
		class FailingImage {
			onload: () => void = () => {}
			onerror: () => void = () => {}
			set src(_value: string) {
				Promise.resolve().then(() => this.onerror())
			}
		}
		;(globalThis as any).Image = FailingImage
		const app = fakeApp(fakeFile('png'))

		const result = await getImageLinkResolver(app, '', 256)('picture')

		expect(result).toMatch(/^data:image\/png;base64,/)
		expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
	})
})
