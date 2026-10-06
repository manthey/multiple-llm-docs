import { Notice, Setting } from 'obsidian'
import LlmDocsPlugin from '../main'
import { ensureDefaultConnection, getDefaultConnection, getAvailableModelsAndUpdateCache } from '../connection-models'

export function addConnectionsSettings(containerEl: HTMLElement, plugin: LlmDocsPlugin, redraw: () => void) {
	new Setting(containerEl)
		.setName('Connections')
		.setDesc('Use official OpenAI/Anthropic APIs, or a compatible self-hosted alternative')
		.setHeading()

	const connectionsContainer = containerEl.createDiv()

	plugin.settings.connections.forEach((connection, index) => {
		const group = connectionsContainer.createDiv({ cls: 'llmdocs-connection-group' })

		// Row 1: type dropdown and API key field
		const row1 = group.createDiv({ cls: 'llmdocs-connection-row' })

		const typeSelect = row1.createEl('select', { cls: 'dropdown llmdocs-connection-type' })
		const option = typeSelect.createEl('option', { text: 'OpenAI', value: 'OpenAI' })
		typeSelect.value = connection.type
		typeSelect.onchange = async () => {
			plugin.settings.connections[index].type = typeSelect.value as 'OpenAI'
			await plugin.saveSettings()
		}

		const apiKeyInput = row1.createEl('input', { cls: 'llmdocs-connection-apikey' })
		apiKeyInput.type = 'text'
		apiKeyInput.placeholder = 'API key'
		apiKeyInput.value = connection.apiKey
		apiKeyInput.oninput = async () => {
			plugin.settings.connections[index].apiKey = apiKeyInput.value
			await plugin.saveSettings()
		}

		// Row 2: short name and default selector
		const row2 = group.createDiv({ cls: 'llmdocs-connection-row' })

		const nameInput = row2.createEl('input', { cls: 'llmdocs-connection-name' })
		nameInput.type = 'text'
		nameInput.placeholder = 'Short name (optional)'
		nameInput.value = connection.name ?? ''
		nameInput.oninput = async () => {
			if (nameInput.value.includes(':')) {
				nameInput.addClass('llmdocs-connection-name-invalid')
				new Notice('Connection short names cannot contain a colon')
				return
			}
			nameInput.removeClass('llmdocs-connection-name-invalid')
			const value = nameInput.value.trim()
			plugin.settings.connections[index].name = value.length ? value : undefined
			await plugin.saveSettings()
		}

		const defaultLabel = row2.createEl('label', { cls: 'llmdocs-connection-default' })
		const defaultInput = defaultLabel.createEl('input')
		defaultInput.type = 'radio'
		defaultInput.name = 'llmdocs-default-connection'
		defaultInput.checked = getDefaultConnection(plugin.settings.connections) === connection
		defaultInput.onchange = async () => {
			plugin.settings.connections.forEach((c, i) => {
				c.isDefault = i === index
			})
			await plugin.saveSettings()
			redraw()
		}
		defaultLabel.createSpan({ text: 'Default' })

		// Row 3: base URL field
		const row3 = group.createDiv({ cls: 'llmdocs-connection-row' })
		const baseUrlInput = row3.createEl('input', { cls: 'llmdocs-connection-baseurl' })
		baseUrlInput.type = 'text'
		baseUrlInput.placeholder = 'Base URL'
		baseUrlInput.value = connection.baseUrl
		baseUrlInput.oninput = async () => {
			plugin.settings.connections[index].baseUrl = baseUrlInput.value
			await plugin.saveSettings()
		}

		// Row 4: buttons
		const row4 = group.createDiv({ cls: 'llmdocs-connection-row llmdocs-connection-buttons' })

		const testButton = row4.createEl('button', { text: 'Test', cls: 'llmdocs-connection-button' })
		testButton.onclick = async () => {
			testButton.disabled = true
			try {
				await getAvailableModelsAndUpdateCache(connection)
				new Notice('Connection success!')
			} catch (error) {
				new Notice(String(error))
			}
			testButton.disabled = false
		}

		const removeButton = row4.createEl('button', { text: 'Remove', cls: 'llmdocs-connection-button' })
		removeButton.onclick = async () => {
			plugin.settings.connections.splice(index, 1)
			ensureDefaultConnection(plugin.settings.connections)
			await plugin.saveSettings()
			redraw()
		}
	})

	new Setting(containerEl).addButton((button) => {
		button.setButtonText('Add connection').onClick(async () => {
			plugin.settings.connections.push({
				baseUrl: 'https://api.openai.com',
				apiKey: '',
				type: 'OpenAI',
			})
			ensureDefaultConnection(plugin.settings.connections)
			await plugin.saveSettings()
			redraw()
		})
	})
}
