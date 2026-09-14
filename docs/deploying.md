# Deploying to GitHub Pages

Redeploying the live site is one command:

```sh
npm run deploy
```

That's it. A minute or so later, https://foss-earth.github.io/ serves the new build.

## What the command does

`npm run deploy` runs `deploy:gh-pages`, which is two steps:

1. `npm run build` — typechecks (`tsc -b`), then builds with Vite. This repository,
   `foss-earth/foss-earth.github.io`, is the organization's Pages site, which GitHub serves from
   the domain root. So the build keeps Vite's default base of `/`, and every asset URL in the
   bundle starts with `/assets/`.
2. `gh-pages -d dist` — commits the contents of `dist/` to the `gh-pages` branch and pushes it.
   GitHub Pages serves that branch directly. Nothing on `main` is touched.

The command does not run lint or tests; run `npm run ci` first.

The deploy is manual and runs from your machine. There is no GitHub Actions workflow in this
repository, so pushing to `main` does **not** republish the site — you have to run the command.

## Before the first deploy on a new machine

- Node.js 22 or newer.
- `npm ci` at least once, so the `gh-pages` CLI is installed.
- Push access to `origin`, with git credentials already working (the command pushes as you).

## Repository settings

Pages must be set to deploy from the `gh-pages` branch, folder `/ (root)`, under
**Settings → Pages** in GitHub. This is already configured; you only need it when setting up a
fresh fork. The `gh-pages` branch is created automatically by the first deploy.

## Verifying

A blank page can still return `200`, so check the main script as well as the page:

```sh
curl -o /dev/null -w '%{http_code}\n' https://foss-earth.github.io/
curl -s https://foss-earth.github.io/ | grep -o 'src="[^"]*"'
```

The script path should start with `/assets/`, and requesting it on `https://foss-earth.github.io`
should also return `200`. Hard-refresh in the browser — Pages caches aggressively and a normal
reload will happily serve you the previous build.

## Troubleshooting

**The page loads blank and the console shows 404s for its scripts.** The build went out with a base
path that does not match where Pages serves it. This site is served from the root, so
`dist/index.html` must load `/assets/…`. Check `deploy:gh-pages` in `package.json` for a `--base`
flag, and `vite.config.ts` for the `base` it chooses.

**The deploy reports success but nothing changes.** The `gh-pages` package keeps a cache in
`node_modules/.cache/gh-pages` that can get out of sync with the remote branch. Clear it and retry:

```sh
npx gh-pages-clean
npm run deploy
```

**Renaming or moving the repository.** Where Pages serves the site depends on the repository name.
A repository named `<owner>.github.io` is served from the domain root and builds with `/`. Any other
name is served from `/<repository>/`, so the build needs `--base=/<repository>/`, otherwise every
asset 404s.

## Deploying your own fork

A fork named `<your-user>.github.io` is served from the root, so `npm run deploy` works unchanged.

Any other fork is served from `https://<your-user>.github.io/<your-repo>/` and needs that path as its
base. Change the build step of `deploy:gh-pages` in `package.json` to
`npm run build -- --base=/<your-repo>/`, then run `npm run deploy`. If you add a GitHub Actions
build instead, `vite.config.ts` picks the same base from the repository name.

See [Development](development.md) for what running a fork involves.
