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

import { FinDeclaration } from "./model";

export interface IndexedDeclaration {
  declaration: FinDeclaration;
  file: string;
}

/**
 * Every exported declaration read from lib/std, keyed by name. A name can be
 * declared by several modules (each has its own `len`), so each key holds a list
 * and hover shows them all rather than silently picking one.
 */
export class DeclarationIndex {
  private readonly byName = new Map<string, IndexedDeclaration[]>();
  private readonly byModule = new Map<string, IndexedDeclaration[]>();
  private count = 0;

  add(declaration: FinDeclaration, file: string): void {
    if (!declaration.exported) {
      return;
    }
    if (declaration.kind === "namespace") {
      return;
    }
    const entry: IndexedDeclaration = { declaration, file };
    const existing = this.byName.get(declaration.name);
    if (existing) {
      existing.push(entry);
    } else {
      this.byName.set(declaration.name, [entry]);
    }
    const modList = this.byModule.get(declaration.module);
    if (modList) {
      modList.push(entry);
    } else {
      this.byModule.set(declaration.module, [entry]);
    }
    this.count += 1;
  }

  get size(): number {
    return this.count;
  }

  lookup(name: string): IndexedDeclaration[] {
    return this.byName.get(name) ?? [];
  }

  module(name: string): IndexedDeclaration[] {
    return this.byModule.get(name) ?? [];
  }

  /** Every name in the index, for a bare-name completion list. */
  names(): string[] {
    return [...this.byName.keys()].sort();
  }

  all(): IndexedDeclaration[] {
    const result: IndexedDeclaration[] = [];
    for (const entries of this.byName.values()) {
      for (const entry of entries) {
        result.push(entry);
      }
    }
    return result;
  }
}

export function indexDeclarations(): DeclarationIndex {
  return new DeclarationIndex();
}
