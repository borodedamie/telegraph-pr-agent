import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findRepositoryRoot, scanRepository } from './check.ts';

const getVersion = (): string => {
  const packageJson: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );

  if (
    typeof packageJson !== 'object' ||
    packageJson === null ||
    !('version' in packageJson) ||
    typeof packageJson.version !== 'string'
  ) {
    throw new Error('CLI package metadata must include a version string.');
  }

  return packageJson.version;
};

const printHelp = (): void => {
  console.log(`Telegraph PR Agent CLI

Usage:
  npm start -- [option]
  npm start -- check [directory] [--package name]

Options:
  -h, --help       Show this help message
  -v, --version    Show the CLI version`);
};

const check = async (args: string[]): Promise<void> => {
  let directory = process.cwd();
  let hasDirectory = false;
  let selectedPackage: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--package' && !selectedPackage) {
      selectedPackage = args[index + 1];

      if (!selectedPackage || selectedPackage.startsWith('-')) {
        throw new Error('--package requires a dependency name.');
      }

      index += 1;
    } else if (!argument.startsWith('-') && !hasDirectory) {
      directory = resolve(argument);
      hasDirectory = true;
    } else {
      throw new Error(`Unexpected argument: ${argument}. Use --help for usage.`);
    }
  }

  directory = hasDirectory ? directory : findRepositoryRoot(directory);
  const { root, projects, candidates, skipped } = await scanRepository(directory, selectedPackage);

  console.log(JSON.stringify({ root, projects, updates: candidates, skipped }, null, 2));
};

const main = async (args: string[]): Promise<void> => {
  if (args.length === 0) {
    printHelp();
    return;
  }

  if (args[0] === 'check') {
    await check(args.slice(1));
    return;
  }

  if (args.length !== 1) {
    throw new Error('Expected one option. Use --help for usage.');
  }

  const [option] = args;

  switch (option) {
    case '--help':
    case '-h':
      printHelp();
      return;
    case '--version':
    case '-v':
      console.log(getVersion());
      return;
    default:
      throw new Error(`Unknown option: ${option}. Use --help for usage.`);
  }
};

try {
  await main(process.argv.slice(2));
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Error: ${message}`);
  process.exitCode = 1;
}
