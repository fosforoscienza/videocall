import OrganizerConsole from "@/components/OrganizerConsole";
import OrganizerLogin from "@/components/OrganizerLogin";
import { DEMO_ORGANIZER, isDemo } from "@/lib/local-db";
import { env } from "@/lib/env";
import { currentUser } from "@/lib/video-auth";

export const dynamic = "force-dynamic";

// Gestione delle videochiamate (solo organizzatori): avvio, programmazione, link, sala d'attesa
export default async function Home() {
  const user = await currentUser();
  if (!user?.organizer) return <OrganizerLogin demo={isDemo() && !env("VIDEO_ORGANIZERS") ? DEMO_ORGANIZER : undefined} />;
  return <OrganizerConsole name={user.name} admin={!!user.admin} />;
}
