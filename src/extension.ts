import * as vscode from "vscode";
import { editModelProvider, importModel } from "./picker";

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("modelPicker.importModel", importModel),
        vscode.commands.registerCommand("modelPicker.editModelProvider", () =>
            editModelProvider(context),
        ),
    );
}

export function deactivate() {}
