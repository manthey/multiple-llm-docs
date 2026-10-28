/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
	testEnvironment: 'jsdom',
	transform: {
		"^.+.tsx?$": ["ts-jest",{}],
	},
	moduleNameMapper: {
		'^obsidian$': '<rootDir>/tests/obsidian-mock.js',
	},
	setupFiles: ['<rootDir>/tests/setup.js'],
	collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/settings-tab/test-utils.ts'],
};
