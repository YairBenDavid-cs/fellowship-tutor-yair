import { promises as fs } from "node:fs";
import path from "node:path";

export type StarterFile = {
  path: string;
  content: string;
};

export type Lesson = {
  id: string;
  title: string;
  outcomes: string[];
  starterFiles?: StarterFile[];
};

export type Course = {
  id: string;
  title: string;
  description?: string;
  lessons: Lesson[];
};

export type CourseSummary = Pick<Course, "id" | "title" | "description">;

const SYLLABUS_DIR = path.join(process.cwd(), "data", "syllabus");

export async function loadCourse(courseId: string): Promise<Course> {
  const filePath = path.join(SYLLABUS_DIR, `${courseId}.json`);
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as Course;
  if (!parsed.id || !Array.isArray(parsed.lessons)) {
    throw new Error(`Invalid syllabus at ${filePath}`);
  }
  return parsed;
}

export function getLesson(course: Course, lessonId: string): Lesson {
  const lesson = course.lessons.find((l) => l.id === lessonId);
  if (!lesson) {
    throw new Error(`Lesson "${lessonId}" not found in course "${course.id}"`);
  }
  return lesson;
}

export async function listCourseIds(): Promise<string[]> {
  const entries = await fs.readdir(SYLLABUS_DIR);
  return entries
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""));
}

export async function listCourseSummaries(): Promise<CourseSummary[]> {
  const ids = await listCourseIds();
  const courses = await Promise.all(ids.map((id) => loadCourse(id)));
  return courses
    .map(({ id, title, description }) => ({ id, title, description }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
