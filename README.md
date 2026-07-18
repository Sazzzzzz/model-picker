# Model Picker

English | [简体中文](docs/README.zh-CN.md)

> A simple extension to discover, manage, and configure custom model providers for GitHub Copilot, freeing you from the hassle of manual configuration editing `:-D`

<!-- Add Marketplace, version, license, and build badges here after publishing. -->

## Features

- Edit model providers
  - Automatically retrieve the complete model list from a provider.
  - Add, remove, or edit multiple models in an existing provider at once.
  - Fill in context window, maximum output, vision, tool-calling, and reasoning
    capability information.
- Add models
  - Search OpenRouter and import an individual model configuration snippet.
  - Automatically fill in context window, maximum output, vision, tool-calling,
    and reasoning capability information.

## Usage

### Edit an Existing Provider

<!--
![Edit an existing provider](assets/demos/edit-provider.gif)
-->

Open the Command Palette -> run `Model Picker: Edit Model Provider` -> select a
provider -> select the models -> generate the configuration.

> [!WARNING]
> Before using this command, make sure `chatLanguageModels.json` contains at
> least one custom model provider.

> [!TIP]
> VS Code does not allow third-party extensions to read its built-in
> `${input:chat.lm.secret.*}` values. The first time you edit a provider, you
> will need to enter its API key manually. Model Picker stores the key securely
> in VS Code Secret Storage, so you will not need to enter it again later.

### Import a Model from OpenRouter

<!--
![Import a model](assets/demos/import-model.gif)
-->

Open the Command Palette -> run `Model Picker: Import Model` -> search for and
select a model -> generate the configuration snippet.

## Commands

| Command                             | Description                                                      |
| ----------------------------------- | ---------------------------------------------------------------- |
| `Model Picker: Edit Model Provider` | Discover and manage models for an existing custom provider.      |
| `Model Picker: Import Model`        | Search for and insert an individual model configuration snippet. |

## Known Limitations

- Model metadata is retrieved through the OpenRouter API and may occasionally
  conflict with the provider's data or be inaccurate. Carefully review the
  model configuration after importing it.
- VS Code does not allow third-party extensions to read or modify its built-in
  `${input:chat.lm.secret.*}` values. Model Picker therefore cannot create a
  provider directly. The first time you edit a provider, you will need to enter
  its API key manually; the key is then stored securely in VS Code Secret
  Storage.

## Acknowledgements

Model metadata is provided by [OpenRouter](https://openrouter.ai/models).
