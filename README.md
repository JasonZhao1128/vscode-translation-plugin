# tFuntionTranslation

A VS Code extension for translating i18n text.

## Features

- Translate i18n text keys to their corresponding values.
- Display translations inline within the editor.

## Installation

1. Install the extension from the VS Code Marketplace.
2. Configure the translation files path in the settings.

## Usage

- Use `t("key")` to see the translated text.
- 
## demo
- for example, `en.js`,`en.ts` or `en.json`
  ```
    const aa = {
        'xxx':'hello'
	  }
	  export default aa
  ```
  `en.json` 
   ```
    {
        "xxx":"hello"
    }
  ``` 
  `text.tsx` 
  ```t("xxx")``` result is: ```t("xxx"```*hello* ```)```

## Configuration

- Set the path to your translation files in the VS Code settings:
  "translationFilesPath": "locales/**/*.{json,js,ts}"
  "translationLanguage": "zh",
  "translationFunctionNames": "t,$t",

## Build
```
vsce package --no-dependencies
```