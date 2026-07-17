import * as vscode from "vscode";
import { editModelProvider, importModel } from "./picker";

/** Register the commands contributed by Model Picker. */
export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("modelPicker.importModel", importModel),
        vscode.commands.registerCommand("modelPicker.editModelProvider", () =>
            editModelProvider(context),
        ),
    );
}

/** Deactivate the extension; command disposables are managed by VS Code. */
export function deactivate() {}
