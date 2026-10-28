import { Setting, Notice } from 'obsidian'
import { expect, it, describe } from '@jest/globals'

// Smoke test: verify the obsidian mock loads and basic DOM helpers work.
describe('obsidian mock (smoke test)', () => {
	it('Setting builds chained DOM and captures components', () => {
		const container = document.createElement('div')
		new Setting(container)
			.setName('Test setting')
			.setDesc('A description')
			.addText((text) => {
				text.setPlaceholder('ph').setValue('val').onChange(() => {})
			})
			.addToggle((toggle) => {
				toggle.setValue(true).onChange(() => {})
			})
			.addDropdown((dropdown) => {
				dropdown.addOption('a', 'A').setValue('a').onChange(() => {})
			})
			.addButton((button) => {
				button.setButtonText('Go').onClick(() => {})
			})
		expect(container.textContent).toContain('Test setting')
		expect(container.querySelector('input[placeholder="ph"]')).not.toBeNull()
		expect(container.querySelector('button')!.textContent).toBe('Go')
		expect(container.querySelector('option')!.value).toBe('a')
	})

	it('createEl/createDiv/empty helpers work on elements', () => {
		const div = document.createElement('div')
		const child = div.createDiv({ cls: 'row', text: 'hello' })
		expect(child.className).toBe('row')
		expect(div.textContent).toBe('hello')
		div.createEl('input', { type: 'checkbox' })
		expect(div.querySelectorAll('input[type="checkbox"]').length).toBe(1)
		div.empty()
		expect(div.children.length).toBe(0)
	})

	it('createFragment global builds a fragment that renders when appended', () => {
		const frag = createFragment((e) => {
			e.createSpan({ text: 'in fragment' })
			e.createEl('code', { text: 'llm_x' })
		})
		const container = document.createElement('div')
		container.appendChild(frag)
		expect(container.textContent).toBe('in fragmentllm_x')
	})

	it('Notice captures messages', () => {
		new Notice('hello world')
		const obsidian: any = require('obsidian')
		expect(obsidian.__captured.notices).toContain('hello world')
	})
})
