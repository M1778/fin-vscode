// =============================================================================
// Fin Programming Language
//
// Made with ❤️ for someone special.
//
// This project is genuinely built on love and dedication, a way to express your love can be done through Fin.
// Fin is a semi-object-orientated programming language that specialized in control, giving so much control to the user while asking for the bare minimum.
// Fin is the name of the Angel from BlackNightmare-Stories not yet published.
// “Love is the reason this project exists”
// -----------------------------------------------------------------------------
// Author: M1778
// Repository: https://github.com/M1778/fin-vscode
// Profile: https://github.com/M1778M/
// -----------------------------------------------------------------------------
// Copyright (C) 2027 M1778
//
// This file is part of fin-vscode, a project for the Fin Programming Language.
//
// Licensed under the MIT License. See LICENSE in the repository root.
//
// SPDX-License-Identifier: MIT
// =============================================================================

import * as vscode from "vscode";
import { TraceLevel } from "./log";

export type NotificationLevel = "info" | "warning" | "error";

export interface Notification {
  level: NotificationLevel;
  message: string;
  at: number;
}

let channel: vscode.LogOutputChannel | undefined;
const recent: Notification[] = [];
const RECENT_LIMIT = 200;

/**
 * The **Fin** output channel. `LogOutputChannel` gives levels and timestamps, so
 * `fin.trace` maps onto them: `off` writes only problems, `messages` adds one line
 * per tool invocation, `verbose` adds the raw protocol.
 */
export function output(): vscode.LogOutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Fin", { log: true });
  }
  return channel;
}

export function disposeOutput(): void {
  channel?.dispose();
  channel = undefined;
}

function record(level: NotificationLevel, message: string): void {
  recent.push({ level, message, at: Date.now() });
  if (recent.length > RECENT_LIMIT) {
    recent.shift();
  }
}

/**
 * Every user-facing message this session produced, newest last.
 *
 * This is what makes "the failure was visible" testable: the assertion is about the
 * message the user would see, not about a log nobody reads.
 */
export function recentNotifications(): readonly Notification[] {
  return recent;
}

export function clearRecentNotifications(): void {
  recent.length = 0;
}

export function traceInfo(level: TraceLevel, message: string): void {
  if (level === "off") {
    return;
  }
  output().info(message);
}

export function traceVerbose(level: TraceLevel, message: string): void {
  if (level !== "verbose") {
    return;
  }
  output().debug(message);
}

export function showInfo(message: string): void {
  record("info", message);
  output().info(message);
}

export function showWarning(message: string): void {
  record("warning", message);
  output().warn(message);
}

export function showError(message: string): void {
  record("error", message);
  output().error(message);
}
