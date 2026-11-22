const browsers = [
  ["Edge", /Edg\//],
  ["Firefox", /Firefox\//],
  ["Chrome", /Chrome\/|CriOS\//],
  ["Safari", /Safari\//],
] as const;

// Android before Linux and iPhone before Mac: their user agents name both.
const systems = [
  ["iPhone", /iPhone/],
  ["iPad", /iPad/],
  ["Android", /Android/],
  ["Mac", /Macintosh/],
  ["Windows", /Windows/],
  ["Linux", /Linux/],
] as const;

/** A name like "Safari on iPhone", so a User can recognise the device. */
export function deviceNameFor(userAgent: string): string {
  const browser = browsers.find(([, pattern]) => pattern.test(userAgent))?.[0];
  const system = systems.find(([, pattern]) => pattern.test(userAgent))?.[0];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Browser";
}
