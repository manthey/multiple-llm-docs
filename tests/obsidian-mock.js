/**
 * Obsidian API mock for jest tests, modeled on the approach used in
 * offline-whisper (tests/obsidian-mock.js): moduleNameMapper maps 'obsidian'
 * here, components build real DOM so code under test can be driven and
 * inspected, and callbacks are captured so tests can invoke them directly.
 *
 * Type checking still uses the real obsidian.d.ts; only runtime is mocked.
 */

// ---------------------------------------------------------------------------
// Obsidian DOM prototype extensions (createEl/createDiv/createSpan/empty/...)
// ---------------------------------------------------------------------------

function makeOptionsEl(tag, options, parent) {
	const el = document.createElement(tag)
	if (options) {
		if (options.cls) {
			options.cls.split(' ').forEach((cls) => cls && el.classList.add(cls))
		}
		if (options.text !== undefined) el.textContent = options.text
		if (options.type !== undefined) el.setAttribute('type', options.type)
		if (options.value !== undefined) el.value = options.value
		if (options.href !== undefined) el.setAttribute('href', options.href)
		if (options.attr) {
			for (const [key, value] of Object.entries(options.attr)) el.setAttribute(key, value)
		}
	}
	if (parent) parent.appendChild(el)
	return el
}

function applyElementHelpers(proto) {
	if (proto.createEl) return
	proto.createEl = function (tagName, options) {
		return makeOptionsEl(tagName, options, this)
	}
	proto.createDiv = function (options) {
		return makeOptionsEl('div', options, this)
	}
	proto.createSpan = function (options) {
		return makeOptionsEl('span', options, this)
	}
	proto.empty = function () {
		while (this.firstChild) this.removeChild(this.firstChild)
	}
	proto.setText = function (text) {
		this.textContent = text
		return this
	}
	proto.addClass = function (...classes) {
		classes.forEach((cls) => this.classList.add(cls))
		return this
	}
	proto.removeClass = function (...classes) {
		classes.forEach((cls) => this.classList.remove(cls))
		return this
	}
	proto.toggleClass = function (classes, value) {
		;(Array.isArray(classes) ? classes : Object.keys(classes)).forEach((cls) =>
			this.classList.toggle(cls, value),
		)
		return this
	}
}

applyElementHelpers(Element.prototype)
applyElementHelpers(DocumentFragment.prototype)

// ---------------------------------------------------------------------------
// Captured components and notices for test assertions
// ---------------------------------------------------------------------------

const __captured = {
	settings: [],
	texts: [],
	toggles: [],
	dropdowns: [],
	buttons: [],
	notices: [],
}

function resetCaptured() {
	for (const key of Object.keys(__captured)) {
		__captured[key].length = 0
	}
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function makeTextComponent() {
	const inputEl = document.createElement('input')
	const comp = { inputEl }
	comp.setPlaceholder = (placeholder) => {
		inputEl.placeholder = placeholder
		return comp
	}
	comp.setValue = (value) => {
		inputEl.value = value
		return comp
	}
	comp.getValue = () => inputEl.value
	comp.onChange = (fn) => {
		comp._onChange = fn
		return comp
	}
	return comp
}

function makeToggleComponent() {
	const inputEl = document.createElement('input')
	inputEl.type = 'checkbox'
	const comp = { inputEl }
	comp.setValue = (value) => {
		inputEl.checked = !!value
		return comp
	}
	comp.getValue = () => inputEl.checked
	comp.onChange = (fn) => {
		comp._onChange = fn
		return comp
	}
	return comp
}

function makeDropdownComponent() {
	const selectEl = document.createElement('select')
	const comp = { selectEl }
	comp.addOption = (value, display) => {
		const option = document.createElement('option')
		option.value = value
		option.textContent = display
		selectEl.appendChild(option)
		return comp
	}
	comp.addOptions = (options) => {
		for (const [value, display] of Object.entries(options)) comp.addOption(value, display)
		return comp
	}
	comp.setValue = (value) => {
		selectEl.value = value
		return comp
	}
	comp.getValue = () => selectEl.value
	comp.onChange = (fn) => {
		comp._onChange = fn
		return comp
	}
	return comp
}

function makeButtonComponent() {
	const buttonEl = document.createElement('button')
	const comp = { buttonEl }
	comp.setButtonText = (text) => {
		buttonEl.textContent = text
		return comp
	}
	comp.setDisabled = (disabled) => {
		buttonEl.disabled = !!disabled
		return comp
	}
	comp.setWarning = () => comp
	comp.setCta = () => comp
	comp.removeCta = () => comp
	comp.onClick = (fn) => {
		buttonEl.onclick = fn
		return comp
	}
	return comp
}

class Setting {
	constructor(containerEl) {
		this.containerEl = containerEl || document.createElement('div')
		__captured.settings.push(this)
	}
	setName(name) {
		this.nameEl = document.createElement('div')
		this.nameEl.className = 'setting-item-name'
		this.nameEl.textContent = typeof name === 'string' ? name : ''
		this.containerEl.appendChild(this.nameEl)
		return this
	}
	setDesc(desc) {
		this.descEl = document.createElement('div')
		this.descEl.className = 'setting-item-description'
		if (desc && desc.nodeType === 11) {
			// DocumentFragment
			this.descEl.appendChild(desc)
		} else {
			this.descEl.textContent = typeof desc === 'string' ? desc : ''
		}
		this.containerEl.appendChild(this.descEl)
		return this
	}
	setHeading() {
		this.containerEl.classList.add('setting-item-heading')
		return this
	}
	addText(cb) {
		const comp = makeTextComponent()
		this.containerEl.appendChild(comp.inputEl)
		__captured.texts.push(comp)
		cb(comp)
		comp.inputEl.addEventListener('input', () => comp._onChange && comp._onChange(comp.inputEl.value))
		return this
	}
	addTextArea(cb) {
		return this.addText(cb)
	}
	addToggle(cb) {
		const comp = makeToggleComponent()
		this.containerEl.appendChild(comp.inputEl)
		__captured.toggles.push(comp)
		cb(comp)
		comp.inputEl.addEventListener('change', () => comp._onChange && comp._onChange(comp.inputEl.checked))
		return this
	}
	addDropdown(cb) {
		const comp = makeDropdownComponent()
		this.containerEl.appendChild(comp.selectEl)
		__captured.dropdowns.push(comp)
		cb(comp)
		comp.selectEl.addEventListener('change', () => comp._onChange && comp._onChange(comp.selectEl.value))
		return this
	}
	addButton(cb) {
		const comp = makeButtonComponent()
		this.containerEl.appendChild(comp.buttonEl)
		__captured.buttons.push(comp)
		cb(comp)
		return this
	}
	addExtraButton(cb) {
		return this.addButton(cb)
	}
}

// ---------------------------------------------------------------------------
// Base classes
// ---------------------------------------------------------------------------

class Plugin {
	constructor(app, manifest) {
		this.app = app
		this.manifest = manifest
	}
	addCommand(command) {
		return command
	}
	addRibbonIcon() {
		return document.createElement('div')
	}
	addSettingTab() {}
	registerEditorExtension() {}
	registerEvent() {}
	registerDomEvent() {}
	async loadData() {
		return this._data ?? {}
	}
	async saveData(data) {
		this._data = data
	}
}

class PluginSettingTab {
	constructor(app, plugin) {
		this.app = app
		this.plugin = plugin
		this.containerEl = document.createElement('div')
	}
	display() {}
	hide() {}
}

class Modal {
	constructor(app) {
		this.app = app
		this.modalEl = document.createElement('div')
		this.contentEl = document.createElement('div')
		this.modalEl.appendChild(this.contentEl)
	}
	open() {
		document.body.appendChild(this.modalEl)
		this.onOpen && this.onOpen()
		return this
	}
	close() {
		this.onClose && this.onClose()
		this.modalEl.remove()
		return this
	}
}

class SuggestModal extends Modal {
	updateSuggestions() {}
	setPlaceholder(placeholder) {
		this.placeholder = placeholder
		return this
	}
}

class AbstractInputSuggest {
	constructor(app, inputEl) {
		this.app = app
		this.inputEl = inputEl
	}
	setValue(value) {
		this.inputEl.value = value
		return this
	}
	getValue() {
		return this.inputEl.value
	}
	close() {}
	open() {}
}

class Notice {
	constructor(message) {
		__captured.notices.push(String(message))
	}
	hide() {}
}

class TFile {}
class TFolder {}

// ---------------------------------------------------------------------------
// Utilities and constants
// ---------------------------------------------------------------------------

const Platform = { isMobile: false, isMobileApp: false, isDesktopApp: false, isIosApp: false, isAndroidApp: false }

function getIcon(name) {
	return document.createElement('span')
}
function setIcon(parent, name) {}

function normalizePath(path) {
	return path
}

function arrayBufferToBase64(buffer) {
	const bytes = new Uint8Array(buffer)
	let binary = ''
	for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
	return btoa(binary)
}

function base64ToArrayBuffer(base64) {
	const binary = atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes.buffer
}

module.exports = {
	Plugin,
	PluginSettingTab,
	Setting,
	Modal,
	SuggestModal,
	AbstractInputSuggest,
	Notice,
	TFile,
	TFolder,
	Platform,
	getIcon,
	setIcon,
	normalizePath,
	arrayBufferToBase64,
	base64ToArrayBuffer,
	__captured,
	resetCaptured,
}
