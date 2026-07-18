import * as vscode from "vscode";
import {
    capabilities,
    configuredModel,
    fetchOpenRouterModels,
    fetchProviderModels,
    inputTokens,
    isAuthError,
    type Item,
    type Model,
    modelName,
    toModelsEndpoint,
    outputTokens,
    type Provider,
    providerItems,
    toItem,
} from "./models";

type Credential = { apiKey: string; fromConfig: boolean; secretKey: string };

const OPEN_MODELS_FILE = "workbench.action.openLanguageModelsJson";
const SECRET_REFERENCE = /^\$\{input:chat\.lm\.secret\.[^}]+\}$/;

/** Let the user choose an OpenRouter model and insert its configuration snippet. */
export async function importModel() {
    const picker = createPicker(
        "Model Picker: Import Model",
        "Loading model list…",
    );
    try {
        picker.show();
        picker.items = (await fetchOpenRouterModels()).map(toItem);
        picker.placeholder = "Search for a model";
        picker.busy = false;
        const selected = (await acceptPicker(picker))?.[0];
        if (selected) {
            await openSnippet(selected.model);
        }
    } catch (error) {
        showError(error);
    } finally {
        picker.dispose();
    }
}

/** Edit the selected provider's configured models in chatLanguageModels.json. */
export async function editModelProvider(context: vscode.ExtensionContext) {
    try {
        const document = await getModelsDocument();
        const providers = parseProviders(document);
        if (!providers.length) {
            vscode.window.showWarningMessage(
                "No model providers are configured in chatLanguageModels.json. Add a provider first, then try again.",
            );
            return;
        }
        const provider = await selectProvider(providers);
        if (!provider) {
            return;
        }

        const modelUrl = await selectModelUrl(provider);
        if (!modelUrl) {
            return;
        }
        const credential = await getCredential(
            context,
            document.uri,
            provider,
            modelUrl,
        );
        if (!credential) {
            return;
        }

        const picker = createPicker(
            `Edit Model Provider: ${providerName(provider)}`,
            "Loading provider and model list…",
        );
        picker.canSelectMany = true;
        picker.show();
        try {
            const loaded = await loadModels(
                context,
                provider,
                modelUrl,
                credential,
                picker,
            );
            if (!loaded) {
                return;
            }

            const items = providerItems(provider, ...loaded);
            picker.items = items;
            picker.selectedItems = items.filter((item) => item.configured);
            picker.placeholder = "Select models to keep or import";
            picker.busy = false;

            const selected = await acceptPicker(picker);
            if (!selected) {
                return;
            }
            provider.models = selected.map((item) => ({
                ...configuredModel(item.model, modelUrl, provider.apiType),
                ...item.configured,
            }));
            await saveProviders(document, providers);
            vscode.window.showInformationMessage(
                `Updated ${providerName(provider)} with ${selected.length} models.`,
            );
        } finally {
            picker.dispose();
        }
    } catch (error) {
        showError(error);
    }
}

function createPicker(title: string, placeholder: string) {
    const picker = vscode.window.createQuickPick<Item>();
    Object.assign(picker, {
        title,
        placeholder,
        busy: true,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    return picker;
}

function acceptPicker(
    picker: vscode.QuickPick<Item>,
): Promise<readonly Item[] | undefined> {
    // Resolve with the accepted selection, or undefined when the picker is dismissed.
    return new Promise((resolve) => {
        let done = false;
        const subscriptions: vscode.Disposable[] = [];
        const finish = (items?: readonly Item[]) => {
            if (done) {
                return;
            }
            done = true;
            subscriptions.forEach((subscription) => subscription.dispose());
            resolve(items);
        };
        subscriptions.push(
            picker.onDidAccept(() => {
                finish(picker.selectedItems);
                picker.hide();
            }),
            picker.onDidHide(() => finish()),
        );
    });
}

function parseProviders(document: vscode.TextDocument): Provider[] {
    const text = document.getText().trim();
    const value = text ? (JSON.parse(text) as unknown) : [];
    if (!Array.isArray(value)) {
        throw new Error(
            "chatLanguageModels.json must contain a top-level array.",
        );
    }
    if (value.some((provider) => !isProvider(provider))) {
        throw new Error(
            "chatLanguageModels.json contains an invalid provider.",
        );
    }
    return value;
}

function isProvider(value: unknown): value is Provider {
    if (!value || typeof value !== "object") {
        return false;
    }
    const models = (value as Provider).models;
    return (
        models === undefined ||
        (Array.isArray(models) &&
            models.every((model) => typeof model?.id === "string"))
    );
}

async function selectProvider(
    providers: Provider[],
): Promise<Provider | undefined> {
    const item = await vscode.window.showQuickPick(
        providers.map((provider, index) => ({
            label: provider.name || provider.vendor || `Provider ${index + 1}`,
            description: provider.vendor,
            detail: `${provider.models?.length ?? 0} configured models`,
            provider,
        })),
        { title: "Edit Model Provider", placeHolder: "Select a provider" },
    );
    return item?.provider;
}

async function selectModelUrl(provider: Provider): Promise<string | undefined> {
    const urls = [
        ...new Set(
            (provider.models ?? [])
                .map((model) => model.url)
                .filter((url): url is string => Boolean(url)),
        ),
    ];
    if (urls.length === 1) {
        return urls[0];
    }
    if (urls.length > 1) {
        return vscode.window.showQuickPick(urls, {
            title: "Edit Model Provider",
            placeHolder: "Select the endpoint whose models you want to edit",
        });
    }
    return vscode.window.showInputBox({
        title: "Edit Model Provider",
        prompt: "Model endpoint or base URL",
        placeHolder: "http://localhost:8317",
        ignoreFocusOut: true,
        validateInput: validateUrl,
    });
}

async function getCredential(
    context: vscode.ExtensionContext,
    documentUri: vscode.Uri,
    provider: Provider,
    modelUrl: string,
): Promise<Credential | undefined> {
    // VS Code's built-in secret references are unreadable to extensions, so keep our own copy.
    const secretKey = providerSecretKey(documentUri, provider, modelUrl);
    if (provider.apiKey && !SECRET_REFERENCE.test(provider.apiKey)) {
        return { apiKey: provider.apiKey, fromConfig: true, secretKey };
    }
    const stored = await context.secrets.get(secretKey);
    if (stored !== undefined || !provider.apiKey) {
        return { apiKey: stored ?? "", fromConfig: false, secretKey };
    }
    const apiKey = await promptForApiKey(provider);
    if (apiKey !== undefined) {
        await context.secrets.store(secretKey, apiKey);
        return { apiKey, fromConfig: false, secretKey };
    }
}

async function loadModels(
    context: vscode.ExtensionContext,
    provider: Provider,
    modelUrl: string,
    credential: Credential,
    picker: vscode.QuickPick<Item>,
): Promise<[Model[], Model[]] | undefined> {
    // Retry once with a newly entered key when our stored credential is rejected.
    const endpoint = toModelsEndpoint(modelUrl);
    const request = (apiKey: string) =>
        Promise.all([
            fetchProviderModels(endpoint, apiKey),
            fetchOpenRouterModels(),
        ]) as Promise<[Model[], Model[]]>;
    try {
        return await request(credential.apiKey);
    } catch (error) {
        if (!isAuthError(error) || credential.fromConfig) {
            throw error;
        }
        picker.hide();
        const apiKey = await promptForApiKey(provider, true);
        if (apiKey === undefined) {
            return undefined;
        }
        await context.secrets.store(credential.secretKey, apiKey);
        picker.show();
        return request(apiKey);
    }
}

function promptForApiKey(provider: Provider, rejected = false) {
    return vscode.window.showInputBox({
        title: `Edit Model Provider: ${providerName(provider)}`,
        prompt: rejected
            ? "The saved API key was rejected. Enter the current API key."
            : "Enter the API key for model discovery. It is stored securely by Model Picker and used only for fetching the list of models.",
        password: true,
        ignoreFocusOut: true,
    });
}

function providerSecretKey(
    documentUri: vscode.Uri,
    provider: Provider,
    modelUrl: string,
) {
    // Scope the stored key to one config file, provider, and endpoint without exposing them.
    const value = `${documentUri}\0${provider.vendor}\0${provider.name}\0${modelUrl}`;
    let hash = 0;
    for (const character of value) {
        hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
    }
    return `providerApiKey.${hash.toString(16)}`;
}

async function openSnippet(model: Model) {
    const settings = vscode.workspace.getConfiguration("modelPicker");
    const snippet = buildSnippet(
        model,
        settings.get("defaultBaseUrl", "http://localhost"),
    );
    let editor = vscode.window.activeTextEditor;
    if (!editor || !isModelsFile(editor.document)) {
        const document = await vscode.workspace.openTextDocument({
            language: "json",
            content: "",
        });
        editor = await vscode.window.showTextDocument(document, {
            preview: false,
        });
    }
    await editor.insertSnippet(new vscode.SnippetString(snippet));
}

function buildSnippet(model: Model, baseUrl: string): string {
    const { tools, vision, efforts } = capabilities(model);
    const id = `\${1:${model.id.replaceAll("/", ":")}}`;
    const reasoning = model.reasoning?.mandatory
        ? ['    "thinking": true']
        : efforts.length
          ? // todo: Add support for non `chat-completions` endpoints
            [
                '    "reasoningEffortFormat": "chat-completions",',
                `    \"supportsReasoningEffort\": [${efforts
                    .map((effort, index) => `\"\${${8 + index}:${effort}}\"`)
                    .join(", ")}],`,
                '    "thinking": true',
            ]
          : [];
    return [
        "{",
        `    \"id\": \"${id}\",`,
        `    \"name\": \"\${2:${modelName(model)}}\",`,
        `    \"url\": \"\${3:${baseUrl}}\",`,
        `    \"maxInputTokens\": \${4:${inputTokens(model)}},`,
        `    \"maxOutputTokens\": \${5:${outputTokens(model)}},`,
        `    \"toolCalling\": \${6:${tools}},`,
        `    \"vision\": \${7:${vision}}${reasoning.length ? "," : ""}`,
        ...reasoning,
        "}",
    ].join("\n");
}

async function getModelsDocument(): Promise<vscode.TextDocument> {
    // Use VS Code's built-in command so the active profile's file is selected correctly.
    const active = vscode.window.activeTextEditor?.document;
    if (active && isModelsFile(active)) {
        return active;
    }
    if (!(await vscode.commands.getCommands(true)).includes(OPEN_MODELS_FILE)) {
        throw new Error(
            "Current VS Code version does not support opening Language Models JSON automatically. Please open the file manually and try again.",
        );
    }
    await vscode.commands.executeCommand(OPEN_MODELS_FILE);
    const document = vscode.window.activeTextEditor?.document;
    if (!document || !isModelsFile(document)) {
        throw new Error("Failed to open chatLanguageModels.json.");
    }
    return document;
}

async function saveProviders(
    document: vscode.TextDocument,
    providers: Provider[],
) {
    const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const content =
        JSON.stringify(providers, null, 4).replaceAll("\n", eol) + eol;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
        document.uri,
        new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length),
        ),
        content,
    );
    if (!(await vscode.workspace.applyEdit(edit)) || !(await document.save())) {
        throw new Error("VS Code could not save chatLanguageModels.json.");
    }
}

function validateUrl(value: string): string | undefined {
    try {
        return /^https?:$/.test(new URL(value.trim()).protocol)
            ? undefined
            : "Use an http:// or https:// URL";
    } catch {
        return "Enter a valid URL";
    }
}

function isModelsFile(document: vscode.TextDocument) {
    return /chatLanguageModels\.json$/i.test(document.fileName);
}

function providerName(provider: Provider) {
    return provider.name ?? provider.vendor ?? "provider";
}

function showError(error: unknown) {
    vscode.window.showErrorMessage(
        `Model Picker failed: ${error instanceof Error ? error.message : String(error)}`,
    );
}
