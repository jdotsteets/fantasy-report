import { revalidatePath } from "next/cache";
import { AdminNav } from "@/components/admin/AdminNav";
import { dbQueryRows } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Project = { id: number; name: string; area: string; status: string };
type Task = {
  id: number;
  title: string;
  category: string;
  status: string;
  priority: number;
  due_date: string | null;
  project_name: string | null;
  created_at: string;
};

async function addProject(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  const area = String(formData.get("area") ?? "general").trim() || "general";
  if (!name) return;
  await dbQueryRows(`insert into exec.projects (name, area) values ($1,$2)`, [name, area]);
  revalidatePath("/admin/execution");
}

async function addTask(formData: FormData) {
  "use server";
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const category = String(formData.get("category") ?? "general").trim() || "general";
  const dueDate = String(formData.get("due_date") ?? "").trim() || null;
  const projectRaw = String(formData.get("project_id") ?? "").trim();
  const projectId = projectRaw ? Number(projectRaw) : null;
  await dbQueryRows(
    `insert into exec.tasks (title, category, status, due_date, project_id) values ($1,$2,'inbox',$3,$4)`,
    [title, category, dueDate, Number.isFinite(projectId) ? projectId : null]
  );
  revalidatePath("/admin/execution");
}

export default async function ExecutionPage() {
  const [projects, tasks] = await Promise.all([
    dbQueryRows<Project>(`select id, name, area, status from exec.projects order by created_at desc`),
    dbQueryRows<Task>(`select id, title, category, status, priority, due_date::text, project_name, created_at::text from exec.task_rollup order by created_at desc limit 200`),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <AdminNav active="execution" />
      <h1 className="text-2xl font-semibold mb-4">Execution Dashboard</h1>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <form action={addTask} className="rounded border p-4 space-y-2">
          <h2 className="font-medium">Quick Add Task</h2>
          <input name="title" placeholder="Random todo..." className="w-full rounded border px-3 py-2" required />
          <div className="grid grid-cols-2 gap-2">
            <input name="category" placeholder="category (family, fantasy, work...)" className="rounded border px-3 py-2" />
            <input name="due_date" type="date" className="rounded border px-3 py-2" />
          </div>
          <select name="project_id" className="w-full rounded border px-3 py-2" defaultValue="">
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button className="rounded bg-emerald-600 text-white px-3 py-2">Add Task</button>
        </form>

        <form action={addProject} className="rounded border p-4 space-y-2">
          <h2 className="font-medium">Add Project</h2>
          <input name="name" placeholder="Project name" className="w-full rounded border px-3 py-2" required />
          <input name="area" placeholder="area (business, family, personal)" className="w-full rounded border px-3 py-2" />
          <button className="rounded bg-zinc-800 text-white px-3 py-2">Add Project</button>
        </form>
      </div>

      <div className="rounded border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left">
            <tr>
              <th className="p-2">Task</th><th className="p-2">Category</th><th className="p-2">Status</th><th className="p-2">Project</th><th className="p-2">Due</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="p-2">{t.title}</td>
                <td className="p-2">{t.category}</td>
                <td className="p-2">{t.status}</td>
                <td className="p-2">{t.project_name ?? "—"}</td>
                <td className="p-2">{t.due_date ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
