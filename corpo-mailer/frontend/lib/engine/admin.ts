/**
 * Who may change the team's settings (the AI keys, the event wording, the team's people, backups).
 * Everyone else can use the dashboard and see "Your account" in Settings.
 *
 * This is a switch in the screens, not a lock: anyone who can edit the shared Drive file could still
 * change its contents directly in Drive. It keeps the controls out of reach in the app.
 */
export const DEFAULT_ADMINS = ["odwitiyo.dutta@gmail.com", "aims@dtu.ac.in"];

/** The admin addresses: `NEXT_PUBLIC_ADMIN_EMAILS` (comma or space separated) if set, else the defaults. */
export function adminList(raw: string | undefined = process.env.NEXT_PUBLIC_ADMIN_EMAILS): string[] {
  const list = (raw ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : DEFAULT_ADMINS;
}

export function isAdmin(email: string | null | undefined, list: string[] = adminList()): boolean {
  return !!email && list.includes(email.trim().toLowerCase());
}
