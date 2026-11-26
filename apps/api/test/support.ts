import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../src/modules');
let cache: string | null = null;
function allResolverSource(): string {
  if (cache !== null) return cache;
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.resolver.ts')) parts.push(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(SRC);
  return (cache = parts.join('\n'));
}

/** First of the candidate GraphQL operation names that exists in the API source today, else null. */
export function builtOp(...names: string[]): string | null {
  const src = allResolverSource();
  return names.find((n) => new RegExp(`async\\s+${n}\\s*\\(`).test(src)) || null;
}

/**
 * `it` when the action exists in the API, otherwise `it.todo`. Skeleton specs for actions another lane is
 * still building switch on by themselves the moment the resolver lands. Candidate names are tried in order.
 */
export function itWhenBuilt(ops: string[]) {
  const op = builtOp(...ops);
  return (name: string, fn: (op: string) => Promise<void>, timeout?: number) => {
    if (op) it(name, () => fn(op), timeout);
    else it.todo(`${name}  [waiting for API action: ${ops.join(' / ')}]`);
  };
}
