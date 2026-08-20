import type { SupportedLanguage } from "../languages";
import type { LanguageAdapter } from "./base";
import { TypeScriptAdapter } from "./typescript";
import { PythonAdapter } from "./python";
import { JVMAdapter } from "./jvm";
import { GoAdapter } from "./go";
import { NativeAdapter } from "./native";
import { DotNetAdapter } from "./dotnet";
import { RustAdapter } from "./rust";
import { RubyAdapter } from "./ruby";
import { PHPAdapter } from "./php";
import { SwiftAdapter } from "./swift";
import { DartAdapter } from "./dart";
import { SQLAdapter } from "./sql";
import { ScriptingAdapter } from "./scripting";
import { BEAMAdapter } from "./beam";
import { FunctionalAdapter } from "./functional";
import { SolidityAdapter } from "./solidity";
import { LegacyAdapter } from "./legacy";
import { WebAdapter } from "./web";
import { ConfigAdapter } from "./config";

const adapterCache = new Map<SupportedLanguage, LanguageAdapter>();

export function getLanguageAdapter(language: SupportedLanguage): LanguageAdapter {
  const cached = adapterCache.get(language);
  if (cached) return cached;

  let adapter: LanguageAdapter;
  switch (language) {
    case "typescript":
    case "javascript":
      adapter = new TypeScriptAdapter();
      break;
    case "python":
      adapter = new PythonAdapter();
      break;
    case "java":
    case "kotlin":
    case "groovy":
    case "scala":
      adapter = new JVMAdapter(language);
      break;
    case "go":
      adapter = new GoAdapter();
      break;
    case "c":
    case "cpp":
    case "objectivec":
      adapter = new NativeAdapter(language);
      break;
    case "csharp":
    case "fsharp":
      adapter = new DotNetAdapter(language);
      break;
    case "rust":
      adapter = new RustAdapter();
      break;
    case "ruby":
      adapter = new RubyAdapter();
      break;
    case "php":
      adapter = new PHPAdapter();
      break;
    case "swift":
      adapter = new SwiftAdapter();
      break;
    case "dart":
      adapter = new DartAdapter();
      break;
    case "sql":
      adapter = new SQLAdapter();
      break;
    case "shell":
    case "powershell":
    case "lua":
    case "r":
    case "perl":
    case "julia":
      adapter = new ScriptingAdapter(language);
      break;
    case "elixir":
    case "erlang":
      adapter = new BEAMAdapter(language);
      break;
    case "haskell":
    case "ocaml":
      adapter = new FunctionalAdapter(language);
      break;
    case "solidity":
      adapter = new SolidityAdapter();
      break;
    case "cobol":
    case "fortran":
      adapter = new LegacyAdapter(language);
      break;
    case "html":
    case "css":
      adapter = new WebAdapter(language);
      break;
    case "terraform":
    case "yaml":
    case "json":
    case "toml":
    case "xml":
    case "dockerfile":
      adapter = new ConfigAdapter(language);
      break;
    default: {
      const _exhaustiveCheck: never = language;
      adapter = new TypeScriptAdapter();
    }
  }

  adapterCache.set(language, adapter);
  return adapter;
}
