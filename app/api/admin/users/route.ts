import { NextResponse } from "next/server";
import { currentUser, deleteUser, listUsers, saveUser } from "@/lib/video-auth";

export const dynamic = "force-dynamic";

// Utenti che possono organizzare le videochiamate: li vedono, creano ed eliminano solo gli amministratori
// (chi è in VIDEO_ORGANIZERS)
async function requireAdmin() {
  const u = await currentUser();
  return u?.admin ? u : null;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const list = await listUsers();
  if (list.error) return NextResponse.json({ error: list.error }, { status: 500 });
  return NextResponse.json({ admins: list.admins, users: list.users }, { headers: { "Cache-Control": "no-store" } });
}

// { action: "save", username, password } crea l'utente (o gli cambia la password); { action: "delete", username } lo elimina
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  let result: { error?: string; status?: number };
  if (body.action === "save") result = await saveUser(body.username, body.password);
  else if (body.action === "delete") result = await deleteUser(body.username);
  else return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
  return NextResponse.json({ ok: true });
}
