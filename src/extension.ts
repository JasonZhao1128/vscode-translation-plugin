import * as vscode from 'vscode';

let translations: any = {};
let decorationType: vscode.TextEditorDecorationType | undefined;

async function loadTranslations() {
    const config = vscode.workspace.getConfiguration();
    const translationFilesPath = config.get<string>('translationFilesPath', 'locales/*.json');

    translations = {};
    const files = await vscode.workspace.findFiles(translationFilesPath);

    for (const file of files) {
        const data = await vscode.workspace.fs.readFile(file);
        const json = JSON.parse(data.toString());
        translations = { ...translations, ...json };
    }
    console.log('Loaded translations:', translations); // 调试输出
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
        const translationFilesPath = config.get<string>('translationFilesPath', 'locales/*.json');
        
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
