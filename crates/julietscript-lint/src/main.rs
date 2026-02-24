use std::collections::BTreeSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{bail, Context, Result};
use clap::{ArgAction, Args, Parser, Subcommand};
use serde::{Deserialize, Serialize};

const EMBEDDED_LINTER_SOURCE: &str = include_str!("linter.js");
const EXAMPLE_SCRIPT: &str = r#"# JulietScript specification example
# Reading guide:
# - Execution is top-to-bottom.
# - Later blocks may reference earlier named blocks.
# - `create` blocks are where upstream config is consumed.

# 1) Global runtime defaults (`juliet` block).
# Purpose: provide baseline engine/runtime settings for this script.
# Relationship:
# - Acts as default context for downstream work unless overridden by a local block.
# - `project` is intentionally runtime-scoped and should NOT be declared here.
# Keys:
# - `engine`: default execution backend/model family for this script (e.g. `codex`).
juliet {
  engine = codex;
}

# 2) Preflight policy.
# Purpose: reusable "before work starts" checklist instructions.
# Relationship:
# - Attached downstream via `with { preflight = ... }` in `create` blocks.
# - Not executed on its own; it is consumed by artifacts that reference it.
# Keys:
# - policy name (`PreflightChecklist`): reusable identifier referenced later by `preflight = ...`.
policy PreflightChecklist = """
Before sprinting:
- restate scope and acceptance criteria
- list risky files and intended safeguards
- confirm validation plan before code changes
""";

# 3) Failure triage policy.
# Purpose: reusable "what to do after a failed attempt" instructions.
# Relationship:
# - Attached downstream via `with { failureTriage = ... }`.
# - Pairs with PreflightChecklist: one is preventive, one is corrective.
# Note: plain quoted strings and triple-quoted block strings are both valid.
# Keys:
# - policy name (`FailureTriage`): reusable identifier referenced later by `failureTriage = ...`.
policy FailureTriage = "On failure: capture root cause, try one safe recovery, then escalate with evidence.";

# 4) Rubric.
# Purpose: define how outputs should be judged (criteria + point weights + tie resolution).
# Relationship:
# - Referenced by cadence (`compare using ShipRubric`) to rank variants.
# - Also attached in `create ... with { rubric = ShipRubric; }` so each artifact run
#   explicitly carries its evaluation contract downstream.
# Keys:
# - `criterion "<name>" points N means "<definition>"`:
#   - `<name>`: score dimension label.
#   - `points N`: weight/maximum points for that dimension.
#   - `means ...`: plain-language definition of what "good" looks like.
# - `tiebreakers [...]`: ordered fallback criteria when total scores tie.
rubric ShipRubric {
  criterion "Correctness" points 5 means "Behavior matches the specification and tests pass.";
  criterion "Safety" points 3 means "Risky changes include rollback guidance and guarded rollout.";
  criterion "Clarity" points 2 means "Patch rationale and follow-up tasks are explicit.";
  tiebreakers ["Correctness", "Safety"];
}

# 5) Cadence.
# Purpose: define the search strategy (how many variants, how many sprints, how to prune).
# Relationship:
# - `compare using ShipRubric` says which rubric scores candidate variants.
# - Attached downstream in `create` blocks via `cadence = ShipLoop`.
# Keys:
# - `engine`: cadence-level override for which engine runs the generation loop.
# - `variants = 3`: each active branch spawns 3 candidate variants per sprint.
# - `sprints = 2`: run 2 iteration rounds total.
# - `compare using ShipRubric`: score/rank candidates using that rubric.
# - `keep best 2`: after each sprint, keep only top 2 survivors for next sprint.
# Practical effect in this example:
# - Sprint 1: 1 starting branch -> 3 candidates -> keep 2.
# - Sprint 2: 2 survivors each branch into 3 (2 x 3 = 6) -> keep final best 2.
cadence ShipLoop {
  engine = codex;
  variants = 3;
  sprints = 2;
  compare using ShipRubric;
  keep best 2;
}

# 6) Seed artifact from source files.
# Purpose: ingest existing human-authored documents into the artifact graph.
# Relationship:
# - Produces `SourceBrief`, which downstream `create` blocks consume via `using [...]`.
# Keys:
# - artifact name (`SourceBrief`): output identifier referenced later in `using`.
# - `julietArtifactSourceFiles [...]`: explicit input file list used to seed the artifact.
create SourceBrief from julietArtifactSourceFiles [
  "../docs/product-brief.md",
  "../docs/constraints.md"
];

# 7) Artifact generated from a prompt, chained to the seed artifact.
# Purpose: turn source material into an actionable implementation plan.
# Relationship:
# - `using [SourceBrief]` means this artifact depends on and consumes SourceBrief.
# - `with { ... }` wires policies + cadence + rubric into this artifact's run behavior.
# Keys:
# - `from juliet """..."""`: prompt used to generate the artifact.
# - `using [SourceBrief]`: upstream artifact dependencies to include as context.
# - `with { ... }` attachments:
#   - `preflight`: policy to run before work starts.
#   - `failureTriage`: policy used when attempts fail.
#   - `cadence`: iteration/branching strategy.
#   - `rubric`: scoring contract used for evaluation/ranking.
create IterationPlan from juliet """
Draft an implementation plan with:
- milestones
- risks
- test strategy
"""
using [SourceBrief]
with {
  preflight = PreflightChecklist;
  failureTriage = FailureTriage;
  cadence = ShipLoop;
  rubric = ShipRubric;
};

# 8) Second generated artifact, chained to multiple upstream artifacts.
# Purpose: produce implementation output (patches) using both context and plan artifacts.
# Relationship:
# - `using [SourceBrief, IterationPlan]` demonstrates multi-artifact dependency chaining.
# - Reuses the same policies/cadence/rubric so evaluation and recovery behavior stay consistent.
# Keys:
# - same `from` / `using` / `with` semantics as block 7.
# - multi-item `using` merges multiple upstream artifacts as generation context.
create PatchSet from juliet "Produce a patch series implementing the approved plan."
using [SourceBrief, IterationPlan]
with {
  preflight = PreflightChecklist;
  failureTriage = FailureTriage;
  cadence = ShipLoop;
  rubric = ShipRubric;
};

# 9) Extend artifact rubric guidance.
# Purpose: add extra scoring guidance specific to one artifact after it is defined.
# Relationship:
# - Targets an existing artifact (`PatchSet`) and supported target (`.rubric`).
# - Refines how PatchSet should be judged in downstream evaluation/review.
# Keys:
# - `PatchSet.rubric`: extend target (`<Artifact>.rubric` is the supported form).
# - `with "..."/"""..."""`: additional guidance text appended to rubric intent.
extend PatchSet.rubric with """
Add an explicit criterion for migration safety and backward compatibility.
""";

# 10) Optional stop point.
# Purpose: terminate workflow intentionally after the desired artifact state.
# Relationship:
# - Ends execution after all prior blocks have been processed.
# Keys:
# - `halt;` stops silently.
# - `halt "message";` stops with an explicit reason/message.
halt "Stop after the first accepted PatchSet.";
"#;

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
    about = "Lint JulietScript files against the repository specification",
    args_conflicts_with_subcommands = true,
    subcommand_negates_reqs = true
)]
struct Cli {
    #[command(subcommand)]
    command: Option<CliSubcommand>,

    #[command(flatten)]
    lint: LintArgs,
}

#[derive(Subcommand, Debug, Clone, Copy)]
enum CliSubcommand {
    #[command(
        about = "Print a deeply annotated JulietScript example that exercises the full linted specification."
    )]
    Example,
}

#[derive(Args, Debug)]
struct LintArgs {
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
    let cli = Cli::parse();

    // Subcommands are handled first so that `julietscript-lint example` can run
    // without lint flags. No Node.js process is needed for this command.
    if matches!(cli.command, Some(CliSubcommand::Example)) {
        print_example();
        return Ok(ExitCode::Clean);
    }

    let root = fs::canonicalize(&cli.lint.root).with_context(|| {
        format!(
            "failed to resolve --root directory '{}'",
            cli.lint.root.display()
        )
    })?;

    let files = collect_files(&root, &cli.lint.globs)?;
    if files.is_empty() {
        bail!(
            "no files matched. Provided patterns: {}",
            cli.lint
                .globs
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
                .join(", ")
        );
    }

    let lint_inputs = load_files(&files)?;
    let linter_path = resolve_linter_path(cli.lint.linter)?;
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

fn print_example() {
    print!("{EXAMPLE_SCRIPT}");
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
