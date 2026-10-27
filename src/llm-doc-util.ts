import { OpenaiBasicMessage, OpenaiContent, OpenaiMessage, OpenaiRole } from './open-ai'
import { splitKeepingSeparators } from './utils'

export interface ParsedMessage {
	role: string
	content: string
}

export function textToMessages(text: string): ParsedMessage[] {
	const lines = text.split('\n')
	let currentRole: string | null = null
	let currentLines: string[] = []
	let sawHeading = false
	const messages: ParsedMessage[] = []
	const flush = () => {
		if (currentRole && currentRole !== 'note') {
			messages.push({ role: currentRole, content: currentLines.join('\n') })
		}
		currentLines = []
	}
	for (const line of lines) {
		if (line.match(/^# reset.*$/)) {
			// ignore everything before a reset divider, including system messages
			sawHeading = true
			messages.length = 0
			currentRole = null
			currentLines = []
			continue
		}
		if (line.match(/^# new.*$/)) {
			// ignore everything before a new divider except system messages
			sawHeading = true
			flush()
			for (let i = messages.length - 1; i >= 0; i--) {
				if (!messages[i].role.startsWith('system')) {
					messages.splice(i, 1)
				}
			}
			currentRole = null
			continue
		}
		let newRole: string | null = null
		const systemMatch = line.match(/^# (system\d*)$/)
		if (systemMatch) {
			newRole = systemMatch[1]
		}
		const userMatch = line.match(/^# (user\d*)$/)
		if (userMatch) {
			newRole = userMatch[1]
		} else if (line.match(/^# (note|skip).*$/)) {
			newRole = 'note'
		}
		const assistantMatch = line.match(/^# (assistant\d*)(\s+\(.*\))?$/)
		if (assistantMatch) {
			newRole = assistantMatch[1]
		}
		if (newRole) {
			sawHeading = true
			if (currentRole && currentRole !== 'note') {
				messages.push({ role: currentRole, content: currentLines.join('\n') })
			}
			currentLines = []
			currentRole = newRole
		} else {
			currentLines.push(line)
		}
	}
	if (currentRole && currentRole !== 'note') {
		messages.push({ role: currentRole, content: currentLines.join('\n') })
	} else if (sawHeading && currentRole === null && currentLines.some((line) => line.trim())) {
		// trailing text after a divider without a role heading is an implicit user message
		messages.push({ role: 'user', content: currentLines.join('\n') })
	}

	if (!messages.length && !sawHeading) {
		messages.push({ role: 'user', content: text })
	}

	return messages
}

export function messagesToText(messages: ParsedMessage[]): string {
	const segments = messages.map((message) => `# ${message.role}\n${message.content}`)
	return segments.join('\n')
}

export async function preprocessMessages(
	messages: OpenaiBasicMessage[],
	textLinkResolver: (link: string) => Promise<string | null>,
	imageLinkResolver: (link: string) => Promise<string | null>,
): Promise<OpenaiMessage[]> {
	const cleaned = messages.filter((msg) => !(msg.role === 'system' && /^\s*$/.test(msg.content)))
	const expandedPromises = cleaned.map(async (msg) => {
		if (msg.role === 'assistant') {
			return msg
		}
		const text = await expandLinks(msg.content, textLinkResolver)
		const withImages = await resolveImages(text, imageLinkResolver)
		return {
			...msg,
			content: withImages,
		}
	})
	return Promise.all(expandedPromises)
}

async function resolveImages(
	content: string,
	linkResolver: (linkText: string) => Promise<string | null>,
): Promise<OpenaiContent[] | string> {
	const promises = splitLinks(content).map(async (part) => {
		const textContent: OpenaiContent = {
			type: 'text',
			text: part.text,
		}
		if (part.isSeparator) {
			const resolved = await linkResolver(part.innerMatch!)
			if (!resolved) {
				return textContent
			}
			const imageContent: OpenaiContent = {
				type: 'image_url',
				image_url: { url: resolved },
			}
			return imageContent
		}
		return textContent
	})

	const parts = await Promise.all(promises)
	if (parts.some((part) => part.type === 'image_url')) {
		return parts.filter((part) => !(part.type === 'text' && (!part.text || !part.text.trim())))
	}
	return content
}

async function expandLinks(
	content: string,
	linkResolver: (linkText: string) => Promise<string | null>,
): Promise<string> {
	const promises = splitLinks(content).map(async (part) => {
		if (part.isSeparator) {
			const resolved = await linkResolver(part.innerMatch!)
			return resolved ?? part.text
		}
		return part.text
	})
	return (await Promise.all(promises)).join('')
}

const linkPattern = /!?\[\[(.+?)]]|!?\[.*?\]\((.+?)\)/g
const splitLinks = (content: string) => splitKeepingSeparators(content, linkPattern)

function selectFromGroup(messages: ParsedMessage[], modelIndex: number, modelCount: number): OpenaiBasicMessage {
	const baseRole = messages[0].role.replace(/\d+$/, '') as 'system' | 'user' | 'assistant'

	// Determine exactly which role string we're targeting
	const targetTag = modelCount > 1 ? `${baseRole}${modelIndex + 1}` : baseRole

	// (a) find the matching numbered block
	const match = messages.find((m) => m.role === targetTag)
	if (match) return { role: baseRole, content: match.content }

	// (b) if there is no matching numbered block, use the unnumbered block
	const unnumbered = messages.find((m) => m.role === baseRole)
	if (unnumbered) return { role: baseRole, content: unnumbered.content }

	// (c) if there is no unnumbered block, use the first numbered block regardless of its number
	return { role: baseRole, content: messages[0].content }
}

export function filterMessagesForModel(
	messages: ParsedMessage[],
	modelIndex: number,
	modelCount: number,
): OpenaiBasicMessage[] {
	const result: OpenaiBasicMessage[] = []
	let currentGroup: ParsedMessage[] = []
	let currentBaseRole: string | null = null
	const filterRoles = ['system', 'user', 'assistant']

	for (const msg of messages) {
		const baseRole = msg.role.replace(/\d+$/, '') as 'system' | 'user' | 'assistant'

		// Only group and process valid conversation roles
		if (!filterRoles.includes(baseRole)) continue

		// Group changes when the base role changes (starts a new conversation step)
		if (currentBaseRole && currentBaseRole !== baseRole) {
			result.push(selectFromGroup(currentGroup, modelIndex, modelCount))
			currentGroup = []
			currentBaseRole = null
		}

		currentGroup.push(msg)
		currentBaseRole = baseRole
	}

	// Flush the final group
	if (currentGroup.length > 0) {
		result.push(selectFromGroup(currentGroup, modelIndex, modelCount))
	}

	return result
}
