use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEST_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new() -> Self {
        let mut path = std::env::temp_dir();
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let counter = TEST_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        path.push(format!(
            "julietscript-lint-tests-{}-{}-{}",
            std::process::id(),
            unique,
            counter
        ));
        fs::create_dir_all(&path).expect("failed to create temporary test directory");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn file(&self, relative: &str) -> PathBuf {
        self.path.join(relative)
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("failed to create parent directory");
    }
    fs::write(path, content).expect("failed to write file");
}

fn has_node() -> bool {
    Command::new("node")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn run_lint(root: &Path, globs: &[&str]) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_julietscript-lint"));
    command.arg("--root").arg(root);
    for pattern in globs {
        command.arg("--glob").arg(pattern);
    }
    command.output().expect("failed to run julietscript-lint")
}

fn run_example() -> Output {
    Command::new(env!("CARGO_BIN_EXE_julietscript-lint"))
        .arg("example")
        .output()
        .expect("failed to run julietscript-lint example")
}

fn valid_script() -> &'static str {
    r#"juliet {
  engine = codex;
}

policy triage = """Recover quickly.""";

rubric quality {
  criterion "Spec" points 1;
}

cadence loop {
  variants = 1;
  sprints = 1;
  compare using quality;
  keep best 1;
}

create Artifact from juliet """Prompt""" with {
  preflight = triage;
  failureTriage = triage;
  cadence = loop;
  rubric = quality;
};

halt;
"#
}

fn source_files_script() -> &'static str {
    r#"create Phase1WebGLFoundation from julietArtifactSourceFiles [
  "../path-to-file/example.md",
  "../path-to-file/notes.md"
];
"#
}

#[test]
fn example_subcommand_prints_annotated_script() {
    let output = run_example();
    assert_eq!(output.status.code(), Some(0));

    let stdout = String::from_utf8(output.stdout).expect("stdout should be utf8");
    assert!(stdout.contains("# JulietScript specification example"));
    assert!(stdout.contains("create SourceBrief from julietArtifactSourceFiles ["));
    assert!(stdout.contains("using [SourceBrief, IterationPlan]"));
    assert!(stdout.contains("extend PatchSet.rubric with"));
}

#[test]
fn example_script_lints_cleanly() {
    if !has_node() {
        eprintln!("Skipping test: node is not available.");
        return;
    }

    let dir = TestDir::new();
    let example_output = run_example();
    assert_eq!(example_output.status.code(), Some(0));

    let example_source = String::from_utf8(example_output.stdout).expect("stdout should be utf8");
    write_file(&dir.file("scripts/example.julietscript"), &example_source);

    let lint_output = run_lint(dir.path(), &["**/*.julietscript"]);
    assert_eq!(lint_output.status.code(), Some(0));

    let stdout = String::from_utf8(lint_output.stdout).expect("stdout should be utf8");
    assert!(stdout.contains("Linted 1 file(s): 0 issue(s) (0 error(s), 0 warning(s))."));
}

#[test]
fn exits_zero_for_valid_file_match() {
    if !has_node() {
        eprintln!("Skipping test: node is not available.");
        return;
    }

    let dir = TestDir::new();
    write_file(&dir.file("scripts/ok.julietscript"), valid_script());

    let output = run_lint(dir.path(), &["**/*.julietscript"]);
    assert_eq!(output.status.code(), Some(0));

    let stdout = String::from_utf8(output.stdout).expect("stdout should be utf8");
    assert!(stdout.contains("Linted 1 file(s): 0 issue(s) (0 error(s), 0 warning(s))."));
}

#[test]
fn exits_one_and_prints_diagnostics_for_invalid_file() {
    if !has_node() {
        eprintln!("Skipping test: node is not available.");
        return;
    }

    let dir = TestDir::new();
    write_file(
        &dir.file("scripts/bad.julietscript"),
        "policy triage = \"\"\"x\"\"\"\nhalt\n",
    );

    let output = run_lint(dir.path(), &["**/*.julietscript"]);
    assert_eq!(output.status.code(), Some(1));

    let stdout = String::from_utf8(output.stdout).expect("stdout should be utf8");
    assert!(stdout.contains("error: Expected ';' after policy declaration."));
    assert!(stdout.contains("Linted 1 file(s): 3 issue(s) (3 error(s), 0 warning(s))."));
}

#[test]
fn exits_zero_for_source_files_seeded_create() {
    if !has_node() {
        eprintln!("Skipping test: node is not available.");
        return;
    }

    let dir = TestDir::new();
    write_file(
        &dir.file("scripts/source-seeded.julietscript"),
        source_files_script(),
    );

    let output = run_lint(dir.path(), &["**/*.julietscript"]);
    assert_eq!(output.status.code(), Some(0));

    let stdout = String::from_utf8(output.stdout).expect("stdout should be utf8");
    assert!(stdout.contains("Linted 1 file(s): 0 issue(s) (0 error(s), 0 warning(s))."));
}

#[test]
fn deduplicates_matches_across_multiple_globs() {
    if !has_node() {
        eprintln!("Skipping test: node is not available.");
        return;
    }

    let dir = TestDir::new();
    write_file(&dir.file("scripts/only-once.julietscript"), valid_script());

    let output = run_lint(dir.path(), &["**/*.julietscript", "scripts/*"]);
    assert_eq!(output.status.code(), Some(0));

    let stdout = String::from_utf8(output.stdout).expect("stdout should be utf8");
    assert!(stdout.contains("Linted 1 file(s): 0 issue(s) (0 error(s), 0 warning(s))."));
}

#[test]
fn exits_two_when_no_files_match() {
    let dir = TestDir::new();

    let output = run_lint(dir.path(), &["**/*.julietscript"]);
    assert_eq!(output.status.code(), Some(2));

    let stderr = String::from_utf8(output.stderr).expect("stderr should be utf8");
    assert!(stderr.contains("no files matched"));
}
