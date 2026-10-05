// Derive the plugin version from a git tag and write it into the files that
// Obsidian and BRAT care about. This is used by the release workflow, which
// passes the tag name via GITHUB_REF_NAME.
//
// Usage:
//   node version-from-tag.mjs 1.4.0
//   node version-from-tag.mjs          # uses GITHUB_REF_NAME

import { readFileSync, writeFileSync } from 'fs'

const tag = process.argv[2] || process.env.GITHUB_REF_NAME

if (!tag) {
	console.error('Error: no version supplied (argument or GITHUB_REF_NAME).')
	process.exit(1)
}

// Obsidian requires a bare semantic version, with no leading "v".
const version = tag.replace(/^v/, '')

if (!/^\d+\.\d+\.\d+$/.test(version)) {
	console.error(`Error: version '${version}' is not a bare semantic version (e.g. 1.4.0).`)
	process.exit(1)
}

console.log(`Setting version to '${version}' (from tag '${tag}').`)

// package.json
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
pkg.version = version
writeFileSync('package.json', JSON.stringify(pkg, null, '\t') + '\n')

// package-lock.json (only the top-level version fields)
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
lock.version = version
if (lock.packages && lock.packages['']) {
	lock.packages[''].version = version
}
writeFileSync('package-lock.json', JSON.stringify(lock, null, '\t') + '\n')

// manifest.json, keeping minAppVersion as the source of truth
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'))
const { minAppVersion } = manifest
manifest.version = version
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t') + '\n')

// versions.json maps plugin version -> minimum Obsidian version
const versions = JSON.parse(readFileSync('versions.json', 'utf8'))
versions[version] = minAppVersion
writeFileSync('versions.json', JSON.stringify(versions, null, '\t') + '\n')

console.log('Updated package.json, package-lock.json, manifest.json, versions.json.')
