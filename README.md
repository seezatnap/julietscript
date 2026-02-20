# JulietScript VS Code Extension

VS Code extension for JulietScript language support:

- Syntax highlighting
- Parser-backed lint diagnostics

## Requirements

- VS Code `1.90.0` or newer
- Node.js `18+` (for running tests/packaging)

## Installation

### Option 1: Run as an extension in development

1. Open this folder in VS Code.
2. Open `Run and Debug` and run `Extension` (or press `F5`).
3. In the new Extension Development Host window, open a `.julietscript`, `.jls`, or `.juliet` file.

### Option 2: Package and install as a normal extension

1. Install the VS Code extension packager:
   ```bash
   npm install -g @vscode/vsce
   ```
2. From this project root, build a `.vsix` package:
   ```bash
   vsce package
   ```
3. Install the generated file:
   ```bash
   code --install-extension julietscript-vscode-0.0.1.vsix
   ```

## What it adds

- Language id: `julietscript`
- File extensions: `.julietscript`, `.jls`, `.juliet`
- Line comments with `#`
- TextMate grammar: `syntaxes/julietscript.tmLanguage.json`
- Linter engine: `src/linter.js`
- VS Code diagnostics wiring: `src/extension.js`

## Linter checks

- Statement parsing for `juliet`, `policy`, `rubric`, `cadence`, `create`, `extend`, `halt`
- Invalid/unknown keys in `juliet { ... }` and `create ... with { ... }`
- Unresolved references (policy/rubric/cadence/artifact)
- Cadence action validation (`compare using`, `keep best`, `discard rest`)
- Extend target validation (`<Artifact>.rubric`)
- Common syntax errors (missing `;`, missing braces, bad strings)

## Verify

```bash
npm run test:linter
```
