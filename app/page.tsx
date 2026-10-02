import OrganizerConsole from "@/components/OrganizerConsole";
import OrganizerLogin from "@/components/OrganizerLogin";
import { currentUser } from "@/lib/video-auth";

export const dynamic = "force-dynamic";

// Gestione delle videochiamate (solo organizzatori): avvio, programmazione, link, sala d'attesa
export default async function Home() {
  const user = await currentUser();
  if (!user?.organizer) return <OrganizerLogin />;
  return <OrganizerConsole name={user.name} />;
}
