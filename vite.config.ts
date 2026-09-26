import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

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
const sourceDirty = Boolean(getGitOutput('git status --short'))
const sourceVersion = `${sourceCommit}${sourceDirty ? '-dirty' : ''}`

// https://vite.dev/config/
export default defineConfig({
  base,
  test: {
    setupFiles: ['./src/test/setup.ts'],
    // build/ is scratch: it can hold other checkouts, such as bisect worktrees, whose tests are not this tree's.
    exclude: [...configDefaults.exclude, 'build/**'],
  },
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __SOURCE_VERSION__: JSON.stringify(sourceVersion),
    __REPOSITORY_SLUG__: JSON.stringify(getRepositorySlug()),
  },
  plugins: [react()],
})
