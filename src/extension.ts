import * as vscode from 'vscode';
import * as path from 'path';
import * as vm from 'vm';
import { URL, pathToFileURL } from 'url';

let translations: any = {};
let decorationType: vscode.TextEditorDecorationType | undefined;

async function loadTranslations() {
    const config = vscode.workspace.getConfiguration();
    const translationFilesPath = config.get<string>('translationFilesPath', 'locales/*.{json,js}');

    translations = {};
    const files = await vscode.workspace.findFiles(translationFilesPath);

    for (const file of files) {
        const fileExtension = path.extname(file.fsPath);
        
        if (fileExtension === '.json') {
            const data = await vscode.workspace.fs.readFile(file);
            const json = JSON.parse(data.toString());
            translations = { ...translations, ...json };
        } else if (fileExtension === '.js') {
            const fileContent = await vscode.workspace.fs.readFile(file);
            const scriptContent = fileContent.toString();
            const sandbox = { module: { exports: {} }, exports: {}, require, console };
            vm.createContext(sandbox);

            if (isESModule(scriptContent)) {
                // 如果是 ES Modules，使用动态 import
                try {
                    // 手动处理 export 语法
                    const scriptWithExportHandling = handleESModuleExports(scriptContent);
                    const script = new vm.Script(scriptWithExportHandling);
                    script.runInContext(sandbox);
                    const moduleExports = sandbox.module.exports;
                    translations = { ...translations, ...moduleExports };
                    console.log('Loaded ES Module:', moduleExports);
                } catch (error) {
                    console.error(`Failed to load ES Module from file ${file.fsPath}:`, error);
                }
            } else {
                // 如果是 CommonJS，使用 vm.Script
                try {
                    const script = new vm.Script(scriptContent);
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
// 处理 ES Module 的导出，将 `export` 语句替换为 `exports` 赋值
function handleESModuleExports(scriptContent: string): string {
    return scriptContent.replace(/export\s+default\s+/g, 'module.exports = ')
                        .replace(/export\s+const\s+(\w+)\s*=\s*/g, 'exports.$1 = ');
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
        const translation = getNestedTranslation(key, translations); // 获取嵌套翻译文本
        if (translation) {
            const startPos = editor.document.positionAt(match.index + 2); // t( 之后的位置
            const endPos = editor.document.positionAt(match.index + match[0].length - 1); // " 之前的位置
            const range = new vscode.Range(startPos, endPos);

            const decoration: vscode.DecorationOptions = {
                range: range,
                renderOptions: {
                    before: { contentText: '', textDecoration: 'none' },
                    after: { 
                        contentText: translation, 
                        textDecoration: 'none',
                        color: '#9f9fa3', // 设置字体颜色
                        fontStyle: 'italic' // 设置斜体
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
        const translationFilesPath = config.get<string>('translationFilesPath', 'locales/*.{json,js}');
        
        // 仅当保存的文件是翻译文件时重新加载翻译
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
