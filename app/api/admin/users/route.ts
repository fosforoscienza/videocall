import { NextResponse } from "next/server";
import { currentUser, deleteUser, listUsers, saveUser, setUserAdmin } from "@/lib/video-auth";

export const dynamic = "force-dynamic";

// Utenti che possono organizzare le videochiamate: li vedono, creano ed eliminano solo gli amministratori
// (chi è in VIDEO_ORGANIZERS e gli utenti creati come amministratori)
async function requireAdmin() {
  const u = await currentUser();
  return u?.admin ? u : null;
}

export async function GET() {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const list = await listUsers(me.id);
  if (list.error) return NextResponse.json({ error: list.error }, { status: 500 });
  return NextResponse.json({ admins: list.admins, users: list.users }, { headers: { "Cache-Control": "no-store" } });
}

// { action: "save", username, password, admin? } crea l'utente (o gli cambia la password);
// { action: "admin", username, admin } dà o toglie il ruolo di amministratore; { action: "delete", username } lo elimina
export async function POST(req: Request) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  let result: { error?: string; status?: number };
  if (body.action === "save") result = await saveUser(body.username, body.password, body.admin === true);
  else if (body.action === "admin" && typeof body.admin === "boolean") result = await setUserAdmin(body.username, body.admin, me.id);
  else if (body.action === "delete") result = await deleteUser(body.username, me.id);
  else return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
  return NextResponse.json({ ok: true });
}
