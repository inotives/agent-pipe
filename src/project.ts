import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

const projectIdSchema = z.string().regex(/^[a-z0-9_-]+$/, {
  message: "project id must match ^[a-z0-9_-]+$",
});

export function normalizeProjectId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s._]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function validateProjectId(value: string): string {
  return projectIdSchema.parse(value);
}

export function humanizeProjectId(projectId: string): string {
  return projectId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function findParentProjectRoot(startDir: string): string | null {
  let current = path.resolve(startDir);

  while (true) {
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    if (fs.existsSync(path.join(parent, ".agent-pipe"))) {
      return parent;
    }

    current = parent;
  }
}

export function findProjectRoot(startDir: string): string | null {
  let current = path.resolve(startDir);

  while (true) {
    if (fs.existsSync(path.join(current, ".agent-pipe"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}
