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
        return file.fsPath.toLowerCase().includes(translationLanguage);
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
             // 自定义 require 函数
            const customRequire =async (modulePath: string) => {
                const basePath = path.resolve(path.dirname(file.fsPath), modulePath).replace(/\\/g, '/').split('/');

                // 模糊搜索可能的文件路径，支持常见扩展名
                const searchPattern =  `${basePath[basePath.length-2]}/${basePath[basePath.length-1]}.{js,ts}`;
            
                // 使用 vscode.workspace.findFiles 查找匹配文件
                const files = await vscode.workspace.findFiles(searchPattern);
                
                if (files.length > 0) {
                    const fileUri = files[0]; // 使用找到的第一个文件
                    return loadModule(fileUri); // 加载模块
                } else {
                    throw new Error(`Module not found: ${modulePath}`);
                }
            };
            const compiledContent = compileTypeScript(scriptContent, file.fsPath,  ts.ModuleKind.CommonJS);
            const sandbox = { module: { exports: {} }, exports: {}, require:customRequire, console };
            vm.createContext(sandbox);
            try {
                const script = new vm.Script(compiledContent);
                script.runInContext(sandbox);
                Object.values(sandbox).forEach(async (i:any)=>{
                    if (i instanceof Promise) {
                        const res = await i;
                        const moduleExports = res.module.exports;
                        const exports = Object.values(res.exports).reduce((acc: any, curr: any) => ({ ...acc, ...curr }), {}) as object;
                        translations = { ...translations, ...moduleExports, ...exports };
                        // 防止promise完成，部分key没有翻译
                        applyDecorations();
                    }
                });
                const moduleExports = sandbox.module.exports;
                const exports = Object.values(sandbox.exports).reduce((acc: any, curr: any) => ({ ...acc, ...curr }), {}) as object;
                translations = { ...translations, ...moduleExports, ...exports };
            } catch (error) {
                console.error(`Failed to execute CommonJS script in file ${file.fsPath}:`, error);
            }
        }
    }
}

// 自定义模块加载函数
async function loadModule(fileUri: vscode.Uri): Promise<any> {
    const fileContent = await vscode.workspace.fs.readFile(fileUri);
    const scriptContent = fileContent.toString();
    const sandbox = { module: { exports: {} }, exports: {}, require: undefined, console };
    vm.createContext(sandbox);
    
    try {
        const compiledContent = compileTypeScript(scriptContent, '',  ts.ModuleKind.CommonJS);
        const script = new vm.Script(compiledContent);
        script.runInContext(sandbox);
        return sandbox
    } catch (error) {
        console.error(`Failed to load module from file ${fileUri.fsPath}:`, error);
        return {};
    }
}

// TypeScript compiler
function compileTypeScript(source: string, fileName: string, targetModuleKind: ts.ModuleKind): string {
    const result = ts.transpileModule(source, {
        compilerOptions: { module: targetModuleKind }, // 动态选择模块类型
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
    const escapedNames = functionNames.map(fn => `\\b${fn.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const regexString = `(${escapedNames.join('|')})\\(['"]([^'"]+)['"]\\)`;
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
