import * as vscode from "vscode";

type Model = {
    id: string;
    name?: string;
    context_length?: number | null;
    architecture?: { modality?: string | null } | null;
    top_provider?: {
        context_length?: number | null;
        max_completion_tokens?: number | null;
    } | null;
    supported_parameters?: string[] | null;
    reasoning?: {
        mandatory?: boolean | null;
        supported_efforts?: string[] | null;
    } | null;
};

type Item = vscode.QuickPickItem & { model: Model };

const modelsUrl = "https://openrouter.ai/api/v1/models";
let modelsCache: Promise<Model[]> | undefined;

export async function importModel() {
    try {
        const selected = await vscode.window.showQuickPick(
            (await fetchModels()).map(toItem),
            {
                title: "Model Picker: Import Model",
                placeHolder: "Search for a model",
                matchOnDescription: true,
                matchOnDetail: true,
            },
        );

        if (selected) {
            await openJson(selected.model);
        }
    } catch (error) {
        vscode.window.showErrorMessage(
            `Model Picker failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

async function fetchModels(): Promise<Model[]> {
    modelsCache ??= fetch(modelsUrl)
        .then(async (response) => {
            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`);
            }

            const body = (await response.json()) as unknown;
            const models = Array.isArray(body)
                ? body
                : (body as { data?: unknown })?.data;
            if (!Array.isArray(models)) {
                throw new Error("OpenRouter returned an unexpected response.");
            }

            return models as Model[];
        })
        .catch((error) => {
            modelsCache = undefined;
            throw error;
        });

    return modelsCache;
}

function toItem(model: Model): Item {
    const efforts = model.reasoning?.supported_efforts?.filter(Boolean) ?? [];
    const tools = model.supported_parameters?.includes("tools") ?? false;
    const vision = model.architecture?.modality?.includes("image") ?? false;
    const reasoning = Boolean(model.reasoning?.mandatory || efforts.length);

    return {
        label: nameOf(model),
        description: `tools ${mark(tools)} | vision ${mark(vision)} | reasoning ${mark(reasoning)}`,
        detail: `${model.id} | context: ${fmt(inputTokens(model))} | output: ${fmt(outputTokens(model))}`,
        model,
    };
}

async function openJson(model: Model) {
    const settings = vscode.workspace.getConfiguration("modelPicker");
    const provider = settings.get("defaultProvider", "customendpoint");
    const config = modelConfig(
        model,
        settings.get("defaultBaseUrl", "http://localhost:23333"),
        provider,
    );
    const document = await vscode.workspace.openTextDocument({
        language: "json",
        content: `${JSON.stringify(config, null, 4)}\n`,
    });

    await vscode.window.showTextDocument(document, { preview: false });
}

function modelConfig(model: Model, url: string, provider: string) {
    const efforts = model.reasoning?.supported_efforts?.filter(Boolean) ?? [];
    const config: Record<string, unknown> = {
        id:
            provider.toLowerCase() === "customendpoint"
                ? `openrouter:${model.id.replaceAll("/", ":")}`
                : model.id,
        name: nameOf(model),
        maxInputTokens: inputTokens(model),
        maxOutputTokens: outputTokens(model),
        toolCalling: model.supported_parameters?.includes("tools") ?? false,
        url,
        vendor: provider,
        vision: model.architecture?.modality?.includes("image") ?? false,
        apiType: "chat-completions",
    };

    if (model.reasoning?.mandatory) {
        config.thinking = true;
    } else if (efforts.length) {
        config.reasoningEffortFormat = "chat-completions";
        config.supportsReasoningEffort = efforts;
        config.thinking = true;
    }

    return config;
}

function nameOf(model: Model): string {
    return model.name?.split(": ").pop()?.trim() || model.id;
}

function inputTokens(model: Model): number {
    return model.context_length ?? model.top_provider?.context_length ?? 0;
}

function outputTokens(model: Model): number {
    return model.top_provider?.max_completion_tokens ?? 16000;
}

function mark(value: boolean): string {
    return value ? "✓" : "✕";
}

function fmt(value: number): string {
    return new Intl.NumberFormat().format(value);
}
