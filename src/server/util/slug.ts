/** Claude Code project-dir slug: every non-alphanumeric char becomes '-'. */
export function cwdToSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}
