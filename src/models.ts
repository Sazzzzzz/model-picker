import * as vscode from "vscode";

const OPENROUTER_MODELS = "https://openrouter.ai/api/v1/models";
let openRouterCache: Promise<Model[]> | undefined;

export type Model = {
    id: string;
    name?: string;
    provider_model_id?: string | null;
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
    metadataIssue?: "missing" | "ambiguous";
};

type VSCModel = Record<string, unknown> & {
    id: string;
    name?: string;
    url?: string;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    toolCalling?: boolean;
    vision?: boolean;
    thinking?: boolean;
    supportsReasoningEffort?: string[];
};

export type Provider = Record<string, unknown> & {
    name?: string;
    vendor?: string;
    apiKey?: string;
    apiType?: string;
    models?: VSCModel[];
};

export type Item = vscode.QuickPickItem & {
    model: Model;
    configured?: VSCModel;
};

type ModelsPage = { models: Model[]; total?: number; limit?: number };

/** Fetch and cache the OpenRouter model catalog for the current extension session. */
export async function fetchOpenRouterModels(): Promise<Model[]> {
    openRouterCache ??= fetchModelsPage(OPENROUTER_MODELS)
        .then((page) => page.models)
        .catch((error) => {
            openRouterCache = undefined;
            throw error;
        });
    return openRouterCache;
}

/** Fetch every model exposed by an OpenAI-compatible provider. */
export async function fetchProviderModels(
    endpoint: string,
    apiKey: string,
): Promise<Model[]> {
    let page = await fetchModelsPage(endpoint, apiKey);
    // Some providers (e.g. cherry studio api server) return a paged response
    if (
        page.limit !== undefined &&
        page.total !== undefined &&
        page.models.length < page.total
    ) {
        const url = new URL(endpoint);
        url.searchParams.set("offset", "0");
        url.searchParams.set("limit", String(page.total));
        page = await fetchModelsPage(url.toString(), apiKey);
    }
    return page.models;
}

async function fetchModelsPage(
    endpoint: string,
    apiKey = "",
): Promise<ModelsPage> {
    // Accept both the OpenAI { data: [...] } shape and a bare model array.
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await fetch(endpoint, { headers });
    if (!response.ok) {
        throw new HttpError(
            response.status,
            `${endpoint} returned ${response.status} ${response.statusText}`,
        );
    }

    const body = (await response.json()) as unknown;
    const object =
        body && typeof body === "object"
            ? (body as Record<string, unknown>)
            : undefined;
    const data = Array.isArray(body) ? body : object?.data;
    if (!Array.isArray(data)) {
        throw new Error(`${endpoint} returned an unexpected models response.`);
    }
    return {
        models: data.filter(isModel),
        total: finiteNumber(object?.total),
        limit: finiteNumber(object?.limit),
    };
}

class HttpError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

/** Return whether a failed model request was rejected for authentication. */
export function isAuthError(error: unknown) {
    return error instanceof HttpError && [401, 403].includes(error.status);
}
// todo: `modelUrl` is guaranteed to be a pure url without v1/completions or v1/responses suffix, so we can remove the regex check and just append /v1/models to the end of the url.
/** Convert a model inference URL or base URL into its /v1/models endpoint. */
export function toModelsEndpoint(modelUrl: string): string {
    const url = new URL(modelUrl);
    let path = url.pathname.replace(/\/+$/, "");
    if (/\/v1\/(?:chat\/completions|responses|messages)$/i.test(path)) {
        path = path.replace(
            /\/v1\/(?:chat\/completions|responses|messages)$/i,
            "/v1/models",
        );
    } else if (/\/(?:chat\/completions|responses)$/i.test(path)) {
        path = path.replace(
            /\/(?:chat\/completions|responses)$/i,
            "/v1/models",
        );
    } else {
        path += /\/v1$/i.test(path) ? "/models" : "/v1/models";
    }
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url.toString();
}

/** Build picker entries by merging provider models, existing config, and OpenRouter metadata. */
export function providerItems(
    provider: Provider,
    providerModels: Model[],
    openRouterModels: Model[],
): Item[] {
    const existing = new Map(
        (provider.models ?? []).map((model) => [model.id, model]),
    );
    const available = new Map(
        providerModels.map((model) => [
            model.id,
            mergeModel(
                withOpenRouterMetadata(model, openRouterModels),
                existing.has(model.id)
                    ? fromConfig(existing.get(model.id)!)
                    : undefined,
            ),
        ]),
    );
    for (const configured of provider.models ?? []) {
        if (!available.has(configured.id)) {
            available.set(
                configured.id,
                withOpenRouterMetadata(
                    fromConfig(configured),
                    openRouterModels,
                ),
            );
        }
    }
    return [...available.values()].map((model) => ({
        ...toItem(model),
        configured: existing.get(model.id),
    }));
}

// Add metadata only when the provider model has one unique OpenRouter match.
function withOpenRouterMetadata(
    model: Model,
    openRouterModels: Model[],
): Model {
    const candidates = modelCandidates(model);
    const exact = openRouterModels.filter((item) =>
        candidates.includes(item.id),
    );
    const matches = exact.length
        ? exact
        : openRouterModels.filter((item) =>
              candidates.some((candidate) => item.id.endsWith(`/${candidate}`)),
          );
    return matches.length === 1
        ? mergeModel(model, matches[0])
        : { ...model, metadataIssue: matches.length ? "ambiguous" : "missing" };
}

// Try provider IDs before looser aliases such as the colon suffix and display name.
function modelCandidates(model: Model): string[] {
    const colon = model.id.indexOf(":");
    return [
        ...new Set(
            [
                model.provider_model_id,
                model.id,
                colon > 0 ? model.id.slice(colon + 1) : undefined,
                model.name,
            ].filter((value): value is string => Boolean(value?.trim())),
        ),
    ];
}

function mergeModel(model: Model, fallback?: Model): Model {
    // Provider values win; fallback metadata fills only fields the provider omitted.
    if (!fallback) {
        return model;
    }
    return {
        ...fallback,
        ...model,
        name: model.name ?? fallback.name,
        context_length: model.context_length ?? fallback.context_length,
        architecture: model.architecture ?? fallback.architecture,
        top_provider: model.top_provider ?? fallback.top_provider,
        supported_parameters:
            model.supported_parameters ?? fallback.supported_parameters,
        reasoning: model.reasoning ?? fallback.reasoning,
    };
}

/** Convert a model into the metadata-rich Quick Pick entry shown to the user. */
export function toItem(model: Model): Item {
    const { tools, vision, reasoning } = capabilities(model);
    const warning =
        model.metadataIssue === "missing"
            ? " | OpenRouter metadata not found"
            : model.metadataIssue === "ambiguous"
              ? " | OpenRouter match ambiguous"
              : "";
    return {
        label: modelName(model),
        description: `tools ${mark(tools)} | vision ${mark(vision)} | reasoning ${mark(reasoning)}${warning}`,
        detail: `${model.id} | context: ${contextTokens(model).toLocaleString()} | output: ${outputTokens(model).toLocaleString()}`,
        iconPath: warning ? new vscode.ThemeIcon("warning") : undefined,
        model,
    };
}

function fromConfig(config: VSCModel): Model {
    // Normalize an existing VS Code model entry into the provider model shape.
    const input =
        typeof config.maxInputTokens === "number"
            ? config.maxInputTokens
            : tokenSetting("defaultMaxInputTokens", 16000);
    const output =
        typeof config.maxOutputTokens === "number"
            ? config.maxOutputTokens
            : tokenSetting("defaultMaxOutputTokens", 128000);
    const efforts = Array.isArray(config.supportsReasoningEffort)
        ? config.supportsReasoningEffort
        : [];
    return {
        id: config.id,
        name: config.name,
        context_length: input + output,
        architecture: {
            modality: config.vision ? "text+image->text" : "text->text",
        },
        top_provider: {
            context_length: input + output,
            max_completion_tokens: output,
        },
        supported_parameters: config.toolCalling ? ["tools"] : [],
        reasoning: config.thinking
            ? { mandatory: !efforts.length, supported_efforts: efforts }
            : undefined,
    };
}

/** Convert a discovered model into a chatLanguageModels.json model entry. */
export function configuredModel(
    model: Model,
    modelUrl: string,
    apiType = "chat-completions",
): VSCModel {
    const output = outputTokens(model);
    const { tools, vision, reasoning, efforts } = capabilities(model);
    const config: VSCModel = {
        id: model.id,
        name: modelName(model),
        url: modelUrl,
        toolCalling: tools,
        vision,
        maxInputTokens: inputTokens(model),
        maxOutputTokens: output,
    };
    if (reasoning) {
        config.thinking = true;
    }
    if (efforts.length) {
        config.supportsReasoningEffort = efforts;
        if (["chat-completions", "responses"].includes(apiType)) {
            config.reasoningEffortFormat = apiType;
        }
    }
    return config;
}

/** Derive tool, vision, and reasoning support from model metadata. */
export function capabilities(model: Model) {
    const efforts = model.reasoning?.supported_efforts?.filter(Boolean) ?? [];
    return {
        efforts,
        tools: model.supported_parameters?.includes("tools") ?? false,
        vision: model.architecture?.modality?.includes("image") ?? false,
        reasoning: Boolean(model.reasoning?.mandatory || efforts.length),
    };
}

/** Return the model's display name, falling back to its ID. */
export function modelName(model: Model) {
    return model.name?.split(": ").pop()?.trim() || model.id;
}

/** Return the model's total context window, or zero when unknown. */
export function contextTokens(model: Model) {
    return model.context_length ?? model.top_provider?.context_length ?? 0;
}

/** Return the usable input-token limit, applying the configured fallback when unknown. */
export function inputTokens(model: Model) {
    const context = contextTokens(model);
    return context
        ? Math.max(context - outputTokens(model), 0)
        : tokenSetting("defaultMaxInputTokens", 16000);
}

/** Return the output-token limit, applying the configured fallback when unknown. */
export function outputTokens(model: Model) {
    return (
        model.top_provider?.max_completion_tokens ??
        tokenSetting("defaultMaxOutputTokens", 128000)
    );
}

function tokenSetting(name: string, fallback: number) {
    return vscode.workspace.getConfiguration("modelPicker").get(name, fallback);
}

function isModel(value: unknown): value is Model {
    return Boolean(
        value &&
        typeof value === "object" &&
        typeof (value as { id?: unknown }).id === "string",
    );
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}

function mark(value: boolean) {
    return value ? "✓" : "✕";
}
