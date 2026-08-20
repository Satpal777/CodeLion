export const supportedLanguages = [
  "typescript",
  "javascript",
  "python",
  "java",
  "kotlin",
  "groovy",
  "go",
  "rust",
  "c",
  "cpp",
  "objectivec",
  "csharp",
  "fsharp",
  "ruby",
  "php",
  "swift",
  "dart",
  "scala",
  "sql",
  "shell",
  "powershell",
  "elixir",
  "erlang",
  "lua",
  "r",
  "perl",
  "haskell",
  "ocaml",
  "julia",
  "solidity",
  "cobol",
  "fortran",
  "html",
  "css",
  "terraform",
  "yaml",
  "json",
  "toml",
  "xml",
  "dockerfile",
] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number];

const extensionMap: Readonly<Record<string, SupportedLanguage>> = {
  // TypeScript & JavaScript
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".vue": "typescript",
  ".svelte": "typescript",

  // Python
  ".py": "python",
  ".pyi": "python",

  // JVM Family
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".groovy": "groovy",
  ".gvy": "groovy",
  ".gradle": "groovy",
  ".scala": "scala",
  ".sc": "scala",

  // Go
  ".go": "go",

  // Native (C / C++ / Objective-C)
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  ".m": "objectivec",
  ".mm": "objectivec",

  // .NET Family
  ".cs": "csharp",
  ".fs": "fsharp",
  ".fsi": "fsharp",
  ".fsx": "fsharp",

  // Rust
  ".rs": "rust",

  // Ruby
  ".rb": "ruby",
  ".rake": "ruby",
  ".gemspec": "ruby",

  // PHP
  ".php": "php",
  ".phtml": "php",

  // Swift
  ".swift": "swift",

  // Dart
  ".dart": "dart",

  // SQL
  ".sql": "sql",
  ".pgsql": "sql",
  ".mysql": "sql",

  // Shell & PowerShell
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".psd1": "powershell",

  // BEAM (Elixir / Erlang)
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hrl": "erlang",

  // Scripting & Data
  ".lua": "lua",
  ".r": "r",
  ".R": "r",
  ".rmd": "r",
  ".pl": "perl",
  ".pm": "perl",
  ".t": "perl",
  ".jl": "julia",

  // Functional
  ".hs": "haskell",
  ".lhs": "haskell",
  ".ml": "ocaml",
  ".mli": "ocaml",

  // Smart Contracts
  ".sol": "solidity",

  // Legacy Enterprise
  ".cbl": "cobol",
  ".cob": "cobol",
  ".cpy": "cobol",
  ".f": "fortran",
  ".for": "fortran",
  ".f90": "fortran",
  ".f95": "fortran",

  // Web Formats
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "css",
  ".sass": "css",
  ".less": "css",

  // Config & IaC
  ".tf": "terraform",
  ".tfvars": "terraform",
  ".hcl": "terraform",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".jsonc": "json",
  ".toml": "toml",
  ".xml": "xml",
};

const specialNames: Readonly<Record<string, SupportedLanguage>> = {
  dockerfile: "dockerfile",
  makefile: "shell",
  gemfile: "ruby",
  rakefile: "ruby",
  cmakelists: "cpp",
  "cmakelists.txt": "cpp",
  "cargo.toml": "toml",
  "pyproject.toml": "toml",
  "pubspec.yaml": "yaml",
  "mix.exs": "elixir",
  "dune-project": "ocaml",
};

export function detectLanguage(path: string): SupportedLanguage | null {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  const special = specialNames[name];
  if (special) return special;
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? (extensionMap[name.slice(dotIndex)] ?? null) : null;
}

const ignoredSegments = new Set([
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  "target",
  "Pods",
  "bin",
  "obj",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
  ".vscode",
]);

const ignoredNames = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "composer.lock",
  "cargo.lock",
  "poetry.lock",
  "mix.lock",
  "gemfile.lock",
  "pubspec.lock",
]);

export function shouldIndexPath(path: string): boolean {
  const parts = path.split("/");
  const name = parts.at(-1) ?? "";
  if (parts.some((part) => ignoredSegments.has(part))) return false;
  if (ignoredNames.has(name.toLowerCase())) return false;
  if (/\.(min\.(js|css)|map|snap|d\.ts)$/i.test(name)) return false;
  if (/(^|\/)(generated|fixtures?|__snapshots__)(\/|$)/i.test(path)) return false;
  return detectLanguage(path) !== null;
}
