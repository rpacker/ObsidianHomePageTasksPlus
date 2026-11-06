// Minimal stand-ins for the Obsidian APIs the pure modules touch.
export function normalizePath(p) {
  return String(p).replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}
export const moment = () => { throw new Error("moment not needed in these tests"); };
export class App {}
export class Modal {}
export class Notice {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class ItemView {}
export class TFile {}
export class TFolder {}
export class WorkspaceLeaf {}
export class Menu {}
export class FileSystemAdapter {}
export function setIcon() {}
export function debounce(fn) { return fn; }
