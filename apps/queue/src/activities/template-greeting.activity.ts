export async function formatGreeting(name: string): Promise<string> {
  return `Hello, ${name}. This came from a Temporal activity.`;
}
