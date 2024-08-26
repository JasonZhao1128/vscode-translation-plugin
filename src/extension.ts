import * as vscode from 'vscode';
import * as path from 'path';
import * as vm from 'vm';
import * as ts from 'typescript'; // TypeScript support

let translations: any = {};
let decorationType: vscode.TextEditorDecorationType | undefined;

async function loadTranslations() {
    const config = vscode.workspace.getConfiguration();
    const translationFilesPath = config.get<string>('translationFilesPath', 'locales/**/*.{json,js,ts}');

    translations = {};
    const files = await vscode.workspace.findFiles(translationFilesPath);

    for (const file of files) {
        const fileExtension = path.extname(file.fsPath);
        
        if (fileExtension === '.json') {
            const data = await vscode.workspace.fs.readFile(file);
            const json = JSON.parse(data.toString());
            translations = { ...translations, ...json };
        } else if (fileExtension === '.js' || fileExtension === '.ts') {
            const fileContent = await vscode.workspace.fs.readFile(file);
            const scriptContent = fileContent.toString();

            // If TypeScript, compile it first
            let compiledContent = scriptContent;
            if (fileExtension === '.ts') {
                compiledContent = compileTypeScript(scriptContent, file.fsPath);
            }

            const sandbox = { module: { exports: {} }, exports: {}, require, console };
            vm.createContext(sandbox);

            if (isESModule(compiledContent)) {
                try {
                    const scriptWithExportHandling = handleESModuleExports(compiledContent);
                    const script = new vm.Script(scriptWithExportHandling);
                    script.runInContext(sandbox);
                    const moduleExports = sandbox.module.exports;
                    const exports = sandbox.exports;
                    translations = { ...translations, ...moduleExports,...exports };
                    console.log('Loaded ES Module:', moduleExports);
                } catch (error) {
                    console.error(`Failed to load ES Module from file ${file.fsPath}:`, error);
                }
            } else {
                try {
                    const script = new vm.Script(compiledContent);
                    script.runInContext(sandbox);

                    const moduleExports = sandbox.module.exports;
                    translations = { ...translations, ...moduleExports };
                    console.log('Loaded CommonJS Module:', moduleExports);
                } catch (error) {
                    console.error(`Failed to execute CommonJS script in file ${file.fsPath}:`, error);
                }
            }
        }
    }

    console.log('Loaded translations:', translations);
}

function isESModule(scriptContent: string): boolean {
    const hasExport = /\bexport\b/.test(scriptContent);
    const hasImport = /\bimport\b/.test(scriptContent);
    return hasExport || hasImport;
}

function handleESModuleExports(scriptContent: string): string {
    return scriptContent.replace(/export\s+default\s+/g, 'module.exports = ')
                        .replace(/export\s+const\s+(\w+)\s*=\s*/g, 'exports.$1 = ');
}

// TypeScript compiler
function compileTypeScript(source: string, fileName: string): string {
    const result = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
        fileName,
    });
    return result.outputText;
}

function getNestedTranslation(keyPath: string, obj: any): string | undefined {
    return keyPath.split('.').reduce((acc, key) => acc && acc[key], obj);
}

function applyDecorations() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    if (decorationType) {
        editor.setDecorations(decorationType, []);
        decorationType.dispose();
    }

    decorationType = vscode.window.createTextEditorDecorationType({});

    const decorations: vscode.DecorationOptions[] = [];
    const text = editor.document.getText();
    const regex = /t\(['"]([^'"]+)['"]\)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        const key = match[1];
        const translation = getNestedTranslation(key, translations); 
        if (translation) {
            const startPos = editor.document.positionAt(match.index + 2);
            const endPos = editor.document.positionAt(match.index + match[0].length - 1);
            const range = new vscode.Range(startPos, endPos);

            const decoration: vscode.DecorationOptions = {
                range: range,
                renderOptions: {
                    before: { contentText: '', textDecoration: 'none' },
                    after: { 
                        contentText: translation, 
                        textDecoration: 'none',
                        color: '#9f9fa3', 
                        fontStyle: 'italic'
                    }
                },
                hoverMessage: `Original text: t("${key}")`
            };
            decorations.push(decoration);
        }
    }

    editor.setDecorations(decorationType, decorations);
}

export async function activate(context: vscode.ExtensionContext) {
    await loadTranslations();

    vscode.window.onDidChangeActiveTextEditor(applyDecorations, null, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument(() => {
        applyDecorations();
    }, null, context.subscriptions);

    vscode.workspace.onDidSaveTextDocument(async (document) => {
        const config = vscode.workspace.getConfiguration();
        const translationFilesPath = config.get<string>('translationFilesPath', 'locales/**/*.{json,js,ts}');
        
        const files = await vscode.workspace.findFiles(translationFilesPath);
        if (files.some(file => file.fsPath === document.fileName)) {
            await loadTranslations();
            applyDecorations();
        }
    }, null, context.subscriptions);

    applyDecorations();
}

export function deactivate() {
    if (decorationType) {
        decorationType.dispose();
    }
}
