import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const srcRoot = path.resolve(__dirname, '..', '..', 'src');

const codeFile = /\.(tsx?|css)$/;

export type SourceFile = { path: string; text: string };

// Paths are relative to the app root, so a failure names the file the way the
// repository does.
export function sourceFiles(): SourceFile[] {
  return readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })
    .filter((name) => codeFile.test(name))
    .map((name) => ({
      path: path.join('src', name),
      text: readFileSync(path.join(srcRoot, name), 'utf8'),
    }));
}
