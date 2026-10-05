## Dev installation

- Install/use the version of NodeJS specified in the `.tool-versions` file
- Run `npm i` to install dependencies.
- Run `npm run dev` to start compilation in watch mode.
- Reload Obsidian.
- Enable plugin in settings window.
- For updates to the Obsidian API run `npm update` in the command line under your repo folder.

## Releasing new releases

The version number is driven by the git tag. The release workflow
(`.github/workflows/release.yml`) runs when a bare semantic-version tag is
pushed, writes that version into `package.json`, `package-lock.json`,
`manifest.json`, and `versions.json` via `version-from-tag.mjs`, builds the
plugin, and publishes a GitHub release with `main.js`, `styles.css`, and
`manifest.json` attached.

To cut a release:

- If the minimum supported Obsidian version changed, update `minAppVersion` in
  `manifest.json` first (it is preserved by the versioning step).
- Create and push a tag with a bare semantic version, no `v` prefix:

  ```sh
  git tag 1.4.1
  git push origin 1.4.1
  ```

- The workflow publishes the release. BRAT and Obsidian both expect the tag to
  match the version in `manifest.json`, and to find the three assets on a
  published (not draft) release.

For a local dry run, `node version-from-tag.mjs 1.4.1` and `npm run build` can
be used to produce the release assets manually.

## Adding your plugin to the community plugin list

- Check the [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
- Publish an initial version.
- Make sure you have a `README.md` file in the root of your repo.
- Make a pull request at https://github.com/obsidianmd/obsidian-releases to add your plugin.
