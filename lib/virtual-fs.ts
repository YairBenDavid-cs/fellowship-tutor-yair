/**
 * Virtual File System
 * Manages in-browser project files with localStorage persistence.
 * All mutations are immutable — always return new Project objects.
 */

export type ProjectFile = {
  path: string; // e.g. "src/App.tsx", "main.py"
  content: string;
  language: string; // Monaco language ID: "typescript", "python", etc.
};

export type Project = {
  files: ProjectFile[];
  activeFilePath: string;
};

export type StarterFile = {
  path: string;
  content: string;
};

// ─── Language detection ───────────────────────────────────────────────────────

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  css: "css",
  html: "html",
  json: "json",
  md: "markdown",
  txt: "plaintext",
  sh: "shell",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
};

export function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "plaintext";
}

// ─── Project helpers (immutable) ──────────────────────────────────────────────

export function createProject(starterFiles: StarterFile[]): Project {
  if (starterFiles.length === 0) {
    // Fallback: empty file
    return {
      files: [{ path: "main.py", content: "# Start coding here\n", language: "python" }],
      activeFilePath: "main.py",
    };
  }
  return {
    files: starterFiles.map((f) => ({
      path: f.path,
      content: f.content,
      language: detectLanguage(f.path),
    })),
    activeFilePath: starterFiles[0].path,
  };
}

export function updateFileContent(
  project: Project,
  filePath: string,
  newContent: string
): Project {
  return {
    ...project,
    files: project.files.map((f) =>
      f.path === filePath ? { ...f, content: newContent } : f
    ),
  };
}

export function setActiveFile(project: Project, filePath: string): Project {
  // If file doesn't exist in project, don't change active
  const exists = project.files.some((f) => f.path === filePath);
  if (!exists) return project;
  return { ...project, activeFilePath: filePath };
}

export function addOrReplaceFile(
  project: Project,
  filePath: string,
  content: string
): Project {
  const exists = project.files.some((f) => f.path === filePath);
  const newFile: ProjectFile = {
    path: filePath,
    content,
    language: detectLanguage(filePath),
  };
  return {
    files: exists
      ? project.files.map((f) => (f.path === filePath ? newFile : f))
      : [...project.files, newFile],
    activeFilePath: filePath,
  };
}

export function removeFile(project: Project, filePath: string): Project {
  const remaining = project.files.filter((f) => f.path !== filePath);
  if (remaining.length === 0) return project; // never remove last file
  const newActive =
    project.activeFilePath === filePath
      ? (remaining[0]?.path ?? project.activeFilePath)
      : project.activeFilePath;
  return { files: remaining, activeFilePath: newActive };
}

/** Remove all files whose paths are inside folderPath (including .gitkeep). */
export function removeFolder(project: Project, folderPath: string): Project {
  const prefix = `${folderPath}/`;
  const remaining = project.files.filter(
    (f) => !f.path.startsWith(prefix) && f.path !== folderPath
  );
  if (remaining.length === 0) return project; // never leave project empty
  const activeGone = project.activeFilePath.startsWith(prefix);
  return {
    files: remaining,
    activeFilePath: activeGone
      ? (remaining[0]?.path ?? project.activeFilePath)
      : project.activeFilePath,
  };
}

export function getActiveFile(project: Project): ProjectFile | undefined {
  return project.files.find((f) => f.path === project.activeFilePath);
}

// ─── localStorage persistence ─────────────────────────────────────────────────

function storageKey(courseId: string, lessonId: string): string {
  return `fellowship-tutor:project:${courseId}:${lessonId}`;
}

export function saveProjectToStorage(
  courseId: string,
  lessonId: string,
  project: Project
): void {
  try {
    localStorage.setItem(storageKey(courseId, lessonId), JSON.stringify(project));
  } catch {
    // Ignore storage errors (private browsing, full storage, etc.)
  }
}

export function loadProjectFromStorage(
  courseId: string,
  lessonId: string
): Project | null {
  try {
    const raw = localStorage.getItem(storageKey(courseId, lessonId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Project;
    // Basic validation
    if (!Array.isArray(parsed.files) || !parsed.activeFilePath) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── File tree helpers ────────────────────────────────────────────────────────

export type FileTreeNode =
  | { kind: "file"; path: string; name: string }
  | { kind: "dir"; path: string; name: string; children: FileTreeNode[] };

export function buildFileTree(files: ProjectFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;
    let pathSoFar = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;

      if (i === parts.length - 1) {
        // Leaf: file
        current.push({ kind: "file", path: file.path, name: part });
      } else {
        // Intermediate: directory
        let dir = current.find(
          (n): n is Extract<FileTreeNode, { kind: "dir" }> =>
            n.kind === "dir" && n.name === part
        );
        if (!dir) {
          dir = { kind: "dir", path: pathSoFar, name: part, children: [] };
          current.push(dir);
        }
        current = dir.children;
      }
    }
  }

  return root;
}
