import * as vscode from "vscode";
import { importModel } from "./picker";

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("modelPicker.importModel", importModel),
    );
}

export function deactivate() {}
