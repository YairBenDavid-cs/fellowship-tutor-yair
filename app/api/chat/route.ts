import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { buildSystemPrompt } from "@/lib/prompt";
import { markComplete } from "@/lib/progress";
import { getLesson, loadCourse } from "@/lib/syllabus";

export const runtime = "nodejs";
export const maxDuration = 60;

// ─── Request types ────────────────────────────────────────────────────────────

type ProjectFileContext = {
  path: string;
  content: string;
  language: string;
};

type ChatRequestBody = {
  messages: UIMessage[];
  courseId: string;
  lessonId: string;
  /** All project files from the in-browser Monaco editor */
  projectFiles?: ProjectFileContext[];
  /** Which file is currently open/active */
  activeFilePath?: string;
};

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as ChatRequestBody;
  const { messages, courseId, lessonId, projectFiles, activeFilePath } = body;

  if (!courseId || !lessonId) {
    return new Response("Missing courseId or lessonId", { status: 400 });
  }

  const course = await loadCourse(courseId);
  const lesson = getLesson(course, lessonId);
  const system = await buildSystemPrompt({
    course,
    lesson,
    projectFiles,
    activeFilePath,
  });

  const result = streamText({
    model: openai("gpt-5.5"),
    system,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(4),
    tools: {
      // ── Existing tool ─────────────────────────────────────────────────────
      complete_lesson: tool({
        description:
          "Mark the current lesson complete. Only call this after the learner has demonstrably met every mastery outcome for the lesson — ideally with working code in the editor as evidence.",
        inputSchema: z.object({
          lessonId: z
            .string()
            .describe(
              "The id of the lesson being completed. Must equal the active lesson id."
            ),
          reason: z
            .string()
            .describe(
              "A single sentence naming the specific behaviours (and ideally the specific code) that convinced you the learner reached mastery."
            ),
        }),
        execute: async ({ lessonId: completedLessonId, reason }) => {
          if (completedLessonId !== lesson.id) {
            return {
              ok: false as const,
              error: `Tried to complete "${completedLessonId}" but the active lesson is "${lesson.id}".`,
            };
          }
          const next = await markComplete(courseId, lesson.id);
          return {
            ok: true as const,
            lessonId: lesson.id,
            lessonTitle: lesson.title,
            courseId: course.id,
            reason,
            completedLessonIds: next.completedLessonIds,
          };
        },
      }),

      // ── New: create a file in the student's editor ────────────────────────
      create_file: tool({
        description:
          "Create a new file in the student's Monaco editor project. Use this to scaffold starter code, create a component skeleton the student should implement, or add a new module. Always explain to the student what you created and why before or after calling this tool.",
        inputSchema: z.object({
          path: z
            .string()
            .describe(
              "File path relative to the project root, e.g. 'src/components/Card.tsx' or 'utils/helpers.py'."
            ),
          content: z
            .string()
            .describe(
              "Full content of the new file. Include helpful comments and TODO markers for the student to fill in."
            ),
          reason: z
            .string()
            .describe(
              "One sentence explaining to the student why you are creating this file."
            ),
        }),
        execute: async ({ path, content, reason }) => {
          // Client applies this mutation to the virtual filesystem.
          return { ok: true as const, path, content, reason };
        },
      }),

      // ── New: update a file in the student's editor ────────────────────────
      update_file: tool({
        description:
          "Update (replace) the content of an existing file in the student's Monaco editor. Use this SPARINGLY — only after the student has genuinely tried and needs a correction or a worked example. Always guide them to the answer first before showing it. After updating, ask the student to explain what changed.",
        inputSchema: z.object({
          path: z
            .string()
            .describe("Path of the file to update, relative to project root."),
          content: z
            .string()
            .describe(
              "Complete new file content. This replaces the entire file."
            ),
          reason: z
            .string()
            .describe(
              "One sentence explaining what changed and why, shown to the student."
            ),
        }),
        execute: async ({ path, content, reason }) => {
          return { ok: true as const, path, content, reason };
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
