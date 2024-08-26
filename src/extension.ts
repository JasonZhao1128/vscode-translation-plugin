import * as vscode from 'vscode';
import * as path from 'path';
import * as vm from 'vm';
import * as ts from 'typescript'; // TypeScript support

let translations: any = {};
let decorationType: vscode.TextEditorDecorationType | undefined;

async function loadTranslations() {
    const config = vscode.workspace.getConfiguration();
    const translationLanguage = config.get<string>('translationLanguage', 'en');
    const translationFilesPath = config.get<string>('translationFilesPath', 'locales/**/*.{json,js,ts}');

    translations = {};
    const files = await vscode.workspace.findFiles(translationFilesPath);
    const filteredFiles = files.filter(file => {
        return file.fsPath.toLowerCase().includes(translationLanguage)
    });
    for (const file of filteredFiles) {
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
                    const exports = Object.values(sandbox.exports).reduce((acc:any, curr:any) => ({ ...acc, ...curr }), {}) as object;
                    translations = { ...translations, ...moduleExports,...exports };
                } catch (error) {
                    console.error(`Failed to load ES Module from file ${file.fsPath}:`, error);
                }
            } else {
                try {
                    const script = new vm.Script(compiledContent);
                    script.runInContext(sandbox);

                    const moduleExports = sandbox.module.exports;
                    const exports = Object.values(sandbox.exports).reduce((acc:any, curr:any) => ({ ...acc, ...curr }), {}) as object;
                    translations = { ...translations, ...moduleExports,...exports };
                    console.log('Loaded CommonJS Module:', exports);
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

function getTranslationFunctionRegex(): RegExp {
    const config = vscode.workspace.getConfiguration();
    const functionNames = config.get<string>('translationFunctionNames', 't') ? config.get<string>('translationFunctionNames', 't').split(',') : ['t'];
    console.log("Loaded function names from settings:",config.get<string>('translationFunctionNames', 't').split(',')); // Logging
    const escapedNames = functionNames.map(fn => `(?<![^\\s])${fn.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s*\\()`);
    const regexString = `(${escapedNames.join('|')})\\s*\\(\\s*['"]([^'"]+)['"]\\s*\\)`;
    console.log("Constructed regex:", regexString); // Logging
    return new RegExp(regexString, 'g');
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
    const regex = getTranslationFunctionRegex();
    let match;

    while ((match = regex.exec(text)) !== null) {
        const key = match[2];
        const translation = getNestedTranslation(key, translations); 
        if (translation) {
            const startPos = editor.document.positionAt(match.index + match[1].length + 2);
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
                hoverMessage: `预览:  ${match[1]?match[1]:'t'}("${key}"->${translation})`
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

    // Listen for changes in the settings (translationFilesPath,translationLanguage and translationFunctionNames)
    vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('translationFilesPath') || e.affectsConfiguration('translationLanguage') || e.affectsConfiguration('translationFunctionNames')) {
            await loadTranslations();
            applyDecorations();
        }
    });

    applyDecorations();
}

export function deactivate() {
    if (decorationType) {
        decorationType.dispose();
    }
}
