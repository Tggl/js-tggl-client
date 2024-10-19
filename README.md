<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://tggl.io/tggl-io-logo-white.svg">
    <img align="center" alt="Tggl Logo" src="https://tggl.io/tggl-io-logo-black.svg" width="200rem" />
  </picture>
</p>

<h1 align="center">Tggl Typescript SDK</h1>

<p align="center">
  The Typescript SDK can be used both on the client and server to evaluate flags and report usage to the Tggl API or a <a href="https://tggl.io/developers/evaluating-flags/tggl-proxy">proxy</a>.
</p>

<p align="center">
  <a href="https://tggl.io/">🔗 Website</a>
  •
  <a href="https://tggl.io/developers/sdks/node">📚 Documentation</a>
  •
  <a href="https://www.npmjs.com/package/tggl-client">📦 NPM</a>
  •
  <a href="https://www.youtube.com/@Tggl-io">🎥 Videos</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/actions/workflow/status/Tggl/js-tggl-client/tests.yml" alt="GitHub Workflow Status (with event)" />
  <img src="https://img.shields.io/coverallsCoverage/github/Tggl/js-tggl-client" alt="Coveralls branch" />
  <img src="https://img.shields.io/npm/v/tggl-client" alt="npm" />
</p>

## Usage

Install the dependency:

```bash
npm i tggl-client
```

Start evaluating flags:

```typescript
import { TgglClient } from 'tggl-client'

const flags = await client.evalContext({
  userId: 'foo',
  email: 'foo@gmail.com',
  country: 'FR',
  // ...
})

if (flags.get('my-feature', true)) {
  // ...
}
```
