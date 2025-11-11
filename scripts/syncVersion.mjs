import fs from 'fs/promises';

fs.readFile('src/version.ts', 'utf-8').then(async (code) => {
  const packageJson = await fs.readFile('package.json', 'utf-8');
  const version = JSON.parse(packageJson).version;

  await fs.writeFile(
    'src/version.ts',
    code.replace(
      /PACKAGE_VERSION = '[0-9.]+'/,
      `PACKAGE_VERSION = '${version}'`
    )
  );
});
