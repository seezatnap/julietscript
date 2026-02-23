use std::collections::BTreeSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{bail, Context, Result};
use clap::{ArgAction, Parser};
use serde::{Deserialize, Serialize};

const EMBEDDED_LINTER_SOURCE: &str = include_str!("linter.js");

const NODE_BRIDGE_SCRIPT: &str = r#"
const fs = require("fs");

const linterPath = process.env.JULIETSCRIPT_LINTER_PATH;
const linterSource = process.env.JULIETSCRIPT_LINTER_SOURCE;

let lintJulietScript;
if (linterPath) {
  try {
    ({ lintJulietScript } = require(linterPath));
  } catch (error) {
    console.error(`Failed to load JulietScript linter from ${linterPath}: ${error.message}`);
    process.exit(1);
  }
} else if (linterSource) {
  try {
    const module = { exports: {} };
    const compile = new Function("module", "exports", "require", linterSource);
    compile(module, module.exports, require);
    ({ lintJulietScript } = module.exports);
  } catch (error) {
    console.error(`Failed to compile embedded JulietScript linter: ${error.message}`);
    process.exit(1);
  }
} else {
  console.error("No JulietScript linter source available. Set JULIETSCRIPT_LINTER_PATH or JULIETSCRIPT_LINTER_SOURCE.");
  process.exit(1);
}

if (typeof lintJulietScript !== "function") {
  console.error("Loaded JulietScript linter does not export lintJulietScript(source).");
  process.exit(1);
}

let files;
try {
  files = JSON.parse(fs.readFileSync(0, "utf8"));
} catch (error) {
  console.error(`Failed to parse lint payload: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(files)) {
  console.error("Lint payload must be an array.");
  process.exit(1);
}

const results = files.map((file) => ({
  path: file.path,
  diagnostics: lintJulietScript(file.source),
}));

process.stdout.write(JSON.stringify(results));
"#;

#[derive(Parser, Debug)]
#[command(
    name = "julietscript-lint",
    version,
    about = "Lint JulietScript files against the repository specification"
)]
struct Args {
    #[arg(
        long = "glob",
        required = true,
        action = ArgAction::Append,
        value_name = "PATTERN",
        help = "Glob pattern for JulietScript files. Pass multiple --glob flags to lint more patterns."
    )]
    globs: Vec<String>,

    #[arg(
        long,
        default_value = ".",
        value_name = "DIR",
        help = "Base directory used to resolve relative --glob patterns."
    )]
    root: PathBuf,

    #[arg(
        long,
        value_name = "FILE",
        help = "Path to linter.js. Overrides the embedded linter implementation."
    )]
    linter: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ExitCode {
    Clean = 0,
    LintIssues = 1,
}

#[derive(Serialize)]
struct LintInputFile {
    path: String,
    source: String,
}

#[derive(Deserialize)]
struct LintPosition {
    line: usize,
    character: usize,
}

#[derive(Deserialize)]
struct LintRange {
    start: LintPosition,
}

#[derive(Deserialize)]
struct LintDiagnostic {
    severity: String,
    message: String,
    range: LintRange,
}

#[derive(Deserialize)]
struct LintFileResult {
    path: String,
    diagnostics: Vec<LintDiagnostic>,
}

fn main() {
    match run() {
        Ok(code) => std::process::exit(code as i32),
        Err(error) => {
            eprintln!("julietscript-lint: {error:#}");
            std::process::exit(2);
        }
    }
}

fn run() -> Result<ExitCode> {
    let args = Args::parse();
    let root = fs::canonicalize(&args.root).with_context(|| {
        format!(
            "failed to resolve --root directory '{}'",
            args.root.display()
        )
    })?;

    let files = collect_files(&root, &args.globs)?;
    if files.is_empty() {
        bail!(
            "no files matched. Provided patterns: {}",
            args.globs
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
                .join(", ")
        );
    }

    let lint_inputs = load_files(&files)?;
    let linter_path = resolve_linter_path(args.linter)?;
    let mut lint_results = run_node_linter(linter_path.as_deref(), &lint_inputs)?;
    lint_results.sort_by(|a, b| a.path.cmp(&b.path));

    let mut issue_count = 0usize;
    let mut error_count = 0usize;
    let mut warning_count = 0usize;

    for file in &lint_results {
        for diagnostic in &file.diagnostics {
            issue_count += 1;
            match diagnostic.severity.as_str() {
                "error" => error_count += 1,
                "warning" => warning_count += 1,
                _ => {}
            }

            println!(
                "{}:{}:{}: {}: {}",
                file.path,
                diagnostic.range.start.line + 1,
                diagnostic.range.start.character + 1,
                diagnostic.severity,
                diagnostic.message
            );
        }
    }

    println!(
        "Linted {} file(s): {} issue(s) ({} error(s), {} warning(s)).",
        lint_results.len(),
        issue_count,
        error_count,
        warning_count
    );

    if issue_count > 0 {
        Ok(ExitCode::LintIssues)
    } else {
        Ok(ExitCode::Clean)
    }
}

fn collect_files(root: &Path, patterns: &[String]) -> Result<Vec<PathBuf>> {
    let mut files = BTreeSet::new();

    for pattern in patterns {
        let resolved_pattern = if Path::new(pattern).is_absolute() {
            pattern.clone()
        } else {
            root.join(pattern).to_string_lossy().into_owned()
        };

        let entries = glob::glob(&resolved_pattern)
            .with_context(|| format!("invalid glob pattern '{}'", pattern))?;

        for entry in entries {
            let path = entry
                .with_context(|| format!("error while expanding glob pattern '{}'", pattern))?;
            if path.is_file() {
                files
                    .insert(fs::canonicalize(path).context("failed to canonicalize matched path")?);
            }
        }
    }

    Ok(files.into_iter().collect())
}

fn load_files(paths: &[PathBuf]) -> Result<Vec<LintInputFile>> {
    let mut files = Vec::with_capacity(paths.len());
    for path in paths {
        let source = fs::read_to_string(path)
            .with_context(|| format!("failed to read '{}'", path.display()))?;
        files.push(LintInputFile {
            path: path.display().to_string(),
            source,
        });
    }
    Ok(files)
}

fn resolve_linter_path(linter_arg: Option<PathBuf>) -> Result<Option<PathBuf>> {
    if let Some(path) = linter_arg {
        if !path.is_file() {
            bail!("--linter path '{}' is not a file", path.display());
        }
        return fs::canonicalize(path)
            .context("failed to canonicalize --linter path")
            .map(Some);
    }

    if let Some(env_path) = std::env::var_os("JULIETSCRIPT_LINTER_PATH") {
        let path = PathBuf::from(env_path);
        if !path.is_file() {
            bail!(
                "JULIETSCRIPT_LINTER_PATH '{}' is not a file",
                path.display()
            );
        }
        return fs::canonicalize(path)
            .context("failed to canonicalize JULIETSCRIPT_LINTER_PATH")
            .map(Some);
    }

    Ok(None)
}

fn run_node_linter(
    linter_path: Option<&Path>,
    files: &[LintInputFile],
) -> Result<Vec<LintFileResult>> {
    let payload = serde_json::to_vec(files).context("failed to serialize lint payload")?;

    let mut command = Command::new("node");
    command
        .arg("-e")
        .arg(NODE_BRIDGE_SCRIPT)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(path) = linter_path {
        command.env("JULIETSCRIPT_LINTER_PATH", path);
    } else if !EMBEDDED_LINTER_SOURCE.trim().is_empty() {
        command.env("JULIETSCRIPT_LINTER_SOURCE", EMBEDDED_LINTER_SOURCE);
    } else {
        bail!("no linter source available. Provide --linter FILE or set JULIETSCRIPT_LINTER_PATH");
    }

    let mut child = command
        .spawn()
        .context("failed to execute 'node'. Install Node.js (18+) to run julietscript-lint")?;

    {
        let mut stdin = child
            .stdin
            .take()
            .context("failed to open stdin for node bridge process")?;
        stdin
            .write_all(&payload)
            .context("failed to send lint payload to node bridge")?;
    }

    let output = child
        .wait_with_output()
        .context("failed while waiting for node bridge process")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr.trim();
        if message.is_empty() {
            bail!("node bridge exited with status {}", output.status);
        } else {
            bail!(
                "node bridge exited with status {}: {}",
                output.status,
                message
            );
        }
    }

    serde_json::from_slice(&output.stdout).context("failed to decode JSON results from node bridge")
}
