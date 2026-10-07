import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { appFiles } from './vite/appFiles.ts'
import { builtFrom } from './vite/builtFrom.ts'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
// A `<owner>.github.io` repository is served from the domain root; any other
// repository is served from `/<repository>/`.
const isRootPagesSite = repositoryName?.endsWith('.github.io') ?? false
const base = process.env.GITHUB_ACTIONS && repositoryName && !isRootPagesSite ? `/${repositoryName}/` : '/'

function getGitOutput(command: string): string | null {
  try {
    return execSync(command, { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function getRepositorySlug(): string {
  const envRepository = process.env.GITHUB_REPOSITORY?.trim()
  if (envRepository) return envRepository

  const remoteUrl = getGitOutput('git config --get remote.origin.url') ?? ''
  const githubMatch = remoteUrl.match(/github\.com[:/]([^/]+\/[^/]+)$/)
  return githubMatch?.[1].replace(/\.git$/, '') ?? ''
}

const sourceCommit = getGitOutput('git rev-parse --short=12 HEAD') ?? 'unknown'
// What the app is built from: a change anywhere else, such as a note in TODO.md, does not change what runs, so it does not make the build "-dirty".
const BUILT_FROM = ['index.html', 'src', 'public', 'vite', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'package.json', 'package-lock.json']
const sourceDirty = Boolean(getGitOutput(`git status --short -- ${BUILT_FROM.join(' ')}`))
const sourceVersion = `${sourceCommit}${sourceDirty ? '-dirty' : ''}`

// https://vite.dev/config/
export default defineConfig({
  base,
  resolve: {
    // One copy of each, as an app built on FOSS Earth is asked to keep (README). Without
    // it gamepad-tools' imports found the Babylon it installs for itself, and the build
    // held a second Babylon in the controller viewer's chunks.
    dedupe: ['@babylonjs/core', '@babylonjs/loaders', '3d-tiles-renderer', 'react', 'react-dom'],
  },
  test: {
    setupFiles: ['./src/test/setup.ts'],
    // The real adapter's Babylon imports omit .js; resolve them as the app's
    // bundler does so LOD integration tests exercise the installed renderer.
    server: { deps: { inline: [/3d-tiles-renderer\//] } },
    // Scratch and app-managed worktrees hold other checkouts, whose tests are not this tree's.
    exclude: [...configDefaults.exclude, 'build/**', '.delta/**'],
  },
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __SOURCE_VERSION__: JSON.stringify(sourceVersion),
    __REPOSITORY_SLUG__: JSON.stringify(getRepositorySlug()),
  },
  // The app's own files are kept on the visitor's device by a service worker (docs/app-files.md),
  // and each page says what it is built from, for the About tab.
  plugins: [react(), appFiles(), builtFrom()],
})
