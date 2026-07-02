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
    const picker = vscode.window.createQuickPick<Item>();
    picker.title = "Model Picker: Import Model";
    picker.placeholder = "Loading OpenRouter models…";
    picker.busy = true;
    picker.matchOnDescription = true;
    picker.matchOnDetail = true;
    picker.show();

    try {
        const models = await fetchModels();
        picker.items = models.map(toItem);
        picker.placeholder = "Search for a model";
        picker.busy = false;

        const [selected] = await new Promise<readonly Item[]>((resolve) => {
            const sub = picker.onDidAccept(() => {
                sub.dispose();
                resolve(picker.selectedItems);
            });
            picker.onDidHide(() => {
                sub.dispose();
                resolve([]);
            });
        });

        if (selected) {
            await openJson(selected.model);
        }
    } catch (error) {
        picker.hide();
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
    const baseUrl = settings.get("defaultBaseUrl", "http://localhost:23333");
    const snippet = buildSnippet(model, baseUrl, provider);

    const active = vscode.window.activeTextEditor;
    if (
        active &&
        /chatLanguageModels\.json?$/i.test(active.document.fileName)
    ) {
        await active.insertSnippet(new vscode.SnippetString(snippet));
        return;
    }

    const doc = await vscode.workspace.openTextDocument({
        language: "json",
        content: "",
    });
    const editor = await vscode.window.showTextDocument(doc, {
        preview: false,
    });
    await editor.insertSnippet(new vscode.SnippetString(snippet));
}

function buildSnippet(model: Model, baseUrl: string, provider: string): string {
    const id =
        provider.toLowerCase() === "customendpoint"
            ? `openrouter:\${1:${model.id.replaceAll("/", ":")}}`
            : `\${1:${model.id}}`;
    const name = `\${2:${nameOf(model)}}`;
    const input = `\${3:${inputTokens(model)}}`;
    const output = `\${4:${outputTokens(model)}}`;
    const tools = model.supported_parameters?.includes("tools") ?? false;
    const hasVision = model.architecture?.modality?.includes("image") ?? false;
    const efforts = model.reasoning?.supported_efforts?.filter(Boolean) ?? [];
    const mandatory = model.reasoning?.mandatory === true;

    const lines = [
        "{",
        `    "id": "${id}",`,
        `    "name": "${name}",`,
        `    "maxInputTokens": ${input},`,
        `    "maxOutputTokens": ${output},`,
        `    "toolCalling": \${5:${tools}},`,
        `    "url": "\${6:${baseUrl}}",`,
        `    "vendor": "\${7:${provider}}",`,
        `    "vision": \${8:${hasVision}},`,
        `    "apiType": "chat-completions"`,
    ];

    if (mandatory) {
        lines.push(`,    "thinking": true`);
    } else if (efforts.length) {
        const effortList = efforts
            .map((e, i) => `"\${${9 + i}:${e}}"`)
            .join(", ");
        lines.push(`,`);
        lines.push(`    "reasoningEffortFormat": "chat-completions",`);
        lines.push(`    "supportsReasoningEffort": [${effortList}],`);
        lines.push(`    "thinking": true`);
    }

    lines.push("\n}");
    return lines.join("\n");
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
