# Model Picker

[English](../README.md)｜简体中文

> Model Picker 能自动发现并导入 OpenAI 兼容接口中的模型，让你在 UI 界面管理 VSCode 第三方模型配置，免于手动查找和抄写模型参数的痛苦 `:-D`

<!-- 发布后在这里添加 Marketplace、版本、许可证和构建状态徽章。 -->

## 功能特性

+ 编辑模型提供商
  + 从模型提供商自动读取完整模型列表
  + 多选列表批量编辑或导入已有 Provider 中的模型。
  + 补全上下文、最大输出、视觉、工具调用和推理能力信息。
+ 添加模型
  + 从 OpenRouter 搜索并导入单个模型配置片段。
  + 自动补全上下文、最大输出、视觉、工具调用和推理能力信息。

## 使用方法

### 编辑已有 Provider

<!--
![编辑已有 Provider](../assets/demos/edit-provider.gif)
-->

打开命令面板 -> 运行`Model Picker: Edit Model Provider` -> 选择 Provider
-> 勾选模型 -> 生成配置片段。

> [!warning]
> 使用前请确保 `chatLanguageModels.json` 中至少有一个自定义模型 Provider。

> [!tip]
> VSCode 不允许第三方插件读取内置的 `${input:chat.lm.secret.*}`，首次编辑 Provider 还请手动输入一次 API Key，后续编辑无需再次输入。此 API 将安全的保存在 VS Code Secret Storage 中。

### 从 OpenRouter 导入模型

<!--
![导入模型](../assets/demos/import-model.gif)
-->

打开命令面板 -> 运行`Model Picker: Import Model` -> 搜索并选择模型 ->
生成配置片段。

## 命令

| 命令                                | 用途                                   |
| ----------------------------------- | -------------------------------------- |
| `Model Picker: Edit Model Provider` | 发现并管理已有自定义 Provider 的模型。 |
| `Model Picker: Import Model`        | 搜索并插入单个模型配置片段。           |

## 已知限制

+ 模型信息通过 OpenRouter API 获取，可能出现冲突或不准确的情况。请在导入后仔细检查模型配置片段。
+ VSCode 不允许第三方插件读取或修改内置的 `${input:chat.lm.secret.*}`。目前该插件无法直接创建Provider，首次编辑 Provider 还请手动输入一次 API Key。此 API 将安全的保存在 VS Code Secret Storage 中。

## 致谢

模型数据由 [OpenRouter](https://openrouter.ai/models)提供。
