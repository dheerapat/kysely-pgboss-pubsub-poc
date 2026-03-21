import { writeFileSync } from "fs";

// --- Types ---

interface User {
  email: string;
  name: string;
  [key: string]: unknown;
}

interface Config {
  count: number;
  output: string;
  domain: string;
}

// --- Arg parsing ---

function parseArgs(argv: string[]): Config {
  const get = (flag: string, def: string): string => {
    const i = argv.indexOf(flag);
    const next = argv[i + 1];
    if (i !== -1 && next !== undefined) return next;
    return def;
  };

  const count = parseInt(get("-n", "1000"), 10);
  if (isNaN(count) || count <= 0) {
    throw new Error(`Invalid -n value: must be a positive integer`);
  }

  return {
    count,
    output: get("-o", "bodies.jsonl"),
    domain: get("--domain", "example.com"),
  };
}

// --- Generator ---

function generateUser(index: number, domain: string): User {
  const uid = crypto.randomUUID().slice(0, 8);
  return {
    email: `user_${uid}@${domain}`,
    name: `User ${index + 1}`,
  };
}

function generateLines(config: Config): string[] {
  return Array.from({ length: config.count }, (_, i) =>
    JSON.stringify(generateUser(i, config.domain)),
  );
}

// --- Main ---

function main(): void {
  const config = parseArgs(process.argv.slice(2));
  const lines = generateLines(config);
  writeFileSync(config.output, lines.join("\n") + "\n", "utf-8");
  console.log(`✓ Generated ${config.count} records → ${config.output}`);
}

main();

/*
load testing with oha

oha -n 1000 -c 50 \
  -m POST \
  -H "Content-Type: application/json" \
  -Z bodies.jsonl \
  http://localhost:3000/users
*/
