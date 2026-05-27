import { promises as fs } from "node:fs";
import path from "node:path";
import type { Course, Lesson } from "./syllabus";

const PROMPT_PATH = path.join(process.cwd(), "data", "prompt.md");

/** Truncate large files to keep the system prompt size manageable */
const MAX_FILE_CONTENT_CHARS = 8_000;

type ProjectFileContext = {
  path: string;
  content: string;
  language: string;
};

export async function buildSystemPrompt(args: {
  course: Course;
  lesson: Lesson;
  projectFiles?: ProjectFileContext[];
  activeFilePath?: string;
}): Promise<string> {
  const template = await fs.readFile(PROMPT_PATH, "utf8");
  const outcomes = args.lesson.outcomes
    .map((o, i) => `${i + 1}. ${o}`)
    .join("\n");

  let prompt = template
    .replaceAll("{{courseTitle}}", args.course.title)
    .replaceAll("{{lessonTitle}}", args.lesson.title)
    .replaceAll("{{lessonOutcomes}}", outcomes);

  // Inject project files if the student has any code open
  if (args.projectFiles && args.projectFiles.length > 0) {
    const fileBlocks = args.projectFiles
      .map((file) => {
        const isActive = file.path === args.activeFilePath;
        const content =
          file.content.length > MAX_FILE_CONTENT_CHARS
            ? file.content.slice(0, MAX_FILE_CONTENT_CHARS) +
              "\n... [truncated — file too long to show in full]"
            : file.content;
        return `\`${file.path}\`${isActive ? " ← currently open" : ""}\n\`\`\`${file.language}\n${content}\n\`\`\``;
      })
      .join("\n\n");

    prompt += `\n\n## Student's Current Project (Monaco Editor)\n\nThe student is writing code in a Monaco Editor (like VS Code) embedded in the tutor. Here are all their project files:\n\n${fileBlocks}\n\nUse this context to:\n- Reference specific file names and line numbers in your responses\n- Spot errors or misconceptions in their code before they mention them — ask a guiding question rather than just telling them\n- Celebrate when their code correctly demonstrates a mastery outcome\n- Use their actual code as the basis for examples and questions\n\nYou can create new files with the \`create_file\` tool and update existing files with the \`update_file\` tool.`;
  }

  return prompt;
}
