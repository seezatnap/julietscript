"use strict";

const vscode = require("vscode");
const { lintJulietScript, SEVERITY } = require("./linter");

function toVsCodeSeverity(severity) {
  if (severity === SEVERITY.WARNING) {
    return vscode.DiagnosticSeverity.Warning;
  }
  return vscode.DiagnosticSeverity.Error;
}

function validateDocument(document, diagnosticsCollection) {
  if (document.languageId !== "julietscript") {
    return;
  }

  const diagnostics = lintJulietScript(document.getText()).map((entry) => {
    const range = new vscode.Range(
      new vscode.Position(entry.range.start.line, entry.range.start.character),
      new vscode.Position(entry.range.end.line, entry.range.end.character)
    );
    const diagnostic = new vscode.Diagnostic(range, entry.message, toVsCodeSeverity(entry.severity));
    diagnostic.source = "julietscript";
    return diagnostic;
  });

  diagnosticsCollection.set(document.uri, diagnostics);
}

function activate(context) {
  const diagnosticsCollection = vscode.languages.createDiagnosticCollection("julietscript");
  context.subscriptions.push(diagnosticsCollection);

  const revalidate = (document) => validateDocument(document, diagnosticsCollection);
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(revalidate));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(revalidate));
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      revalidate(event.document);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnosticsCollection.delete(document.uri);
    })
  );

  for (const document of vscode.workspace.textDocuments) {
    revalidate(document);
  }
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
