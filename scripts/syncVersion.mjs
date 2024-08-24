import fs from 'fs/promises'

fs.readFile('src/TgglReporting.ts', 'utf-8').then(
  async (code) => {
    const packageJson = await fs.readFile('package.json', 'utf-8')
    const version = JSON.parse(packageJson).version

    await fs.writeFile('src/TgglReporting.ts', code.replace(/export const PACKAGE_VERSION = '[0-9.]+'/, `export const PACKAGE_VERSION = '${version}'`))
  }
)
